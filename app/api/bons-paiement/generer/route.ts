import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { bonExistantSurPeriode, creerBonPaiement, getLivreursARegler, periodeMensuelle } from '@/lib/bon-paiement';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

// Génération mensuelle en un clic (§ /admin/bon-paiement) : un bon BROUILLON
// par livreur ayant des tournées non réglées sur la période. C'est le geste
// normal du 1er du mois — l'émission unitaire (POST /api/bons-paiement) reste
// là pour les rattrapages et les assiettes partielles.
//
// Cette route est aussi le point d'entrée d'une éventuelle planification
// (cron du 1er à 6h) : elle est idempotente par construction — un livreur qui
// a déjà un bon vivant sur la période est ignoré, pas dupliqué.
//
// `hubId` restreint le lot à une zone, pour un responsable qui ne paie que son
// périmètre.
export async function POST(request: Request) {
  try {
    const session = await requireUser([...ROLES_PAIEMENT]);
    const body = await request.json().catch(() => ({}));

    if (typeof body.annee !== 'number' || typeof body.mois !== 'number') {
      throw new ApiError(400, 'annee et mois sont requis');
    }
    const periode = periodeMensuelle(body.annee, body.mois);
    const hubId = typeof body.hubId === 'string' && body.hubId ? body.hubId : null;

    // Une période encore ouverte se génère quand même (le comptable peut
    // vouloir un acompte), mais l'appelant doit l'avoir demandé explicitement :
    // générer août le 12 août fige des commissions incomplètes, et le reliquat
    // partirait alors en septembre sans que personne ne le remarque.
    if (periode.fin > new Date() && body.autoriserPeriodeOuverte !== true) {
      throw new ApiError(
        409,
        "Cette période de paie n'est pas terminée. Confirmez pour générer malgré tout : les tournées clôturées d'ici la fin du mois ne seront pas incluses."
      );
    }

    const candidats = await getLivreursARegler(hubId, periode);
    if (candidats.length === 0) {
      return NextResponse.json({ generes: [], ignores: [], total: 0 });
    }

    // Une transaction par livreur plutôt qu'une seule pour tout le lot : sur
    // une trentaine de livreurs, une erreur isolée (tournée réglée en
    // concurrence) ne doit pas annuler les vingt-neuf bons déjà corrects.
    // Chaque bon est un document indépendant, il n'y a rien à rendre atomique
    // entre eux.
    const generes: { livreurId: string; nomComplet: string; numero: string; montant: number }[] = [];
    const ignores: { livreurId: string; nomComplet: string; raison: string }[] = [];

    for (const candidat of candidats) {
      try {
        const bon = await prisma.$transaction(async (tx) => {
          const existant = await bonExistantSurPeriode(tx, candidat.id, periode);
          if (existant) throw new ApiError(409, `Bon ${existant.numero} déjà émis sur cette période`);

          return creerBonPaiement(tx, {
            livreurId: candidat.id,
            periode,
            emisParId: session.sub,
            hubParDefaut: candidat.hubId,
          });
        });

        if (bon) {
          generes.push({
            livreurId: candidat.id,
            nomComplet: candidat.nomComplet,
            numero: bon.numero,
            montant: Number(bon.montantTotal),
          });
        } else {
          ignores.push({ livreurId: candidat.id, nomComplet: candidat.nomComplet, raison: 'Aucune tournée à régler' });
        }
      } catch (error) {
        ignores.push({
          livreurId: candidat.id,
          nomComplet: candidat.nomComplet,
          raison: error instanceof Error ? error.message : 'Erreur inconnue',
        });
      }
    }

    return NextResponse.json({ generes, ignores, total: generes.length });
  } catch (error) {
    return jsonError(error);
  }
}
