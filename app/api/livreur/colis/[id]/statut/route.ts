import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { MOTIFS_ANNULATION_LIVREUR, MOTIFS_REPORT_LIVREUR, type ActionLivreur } from '@/lib/types';
import { deciderActionColisLivreur, type OrigineColisLivreur } from '@/lib/comptes-livreur';
import type { StatutCommande } from '@/app/generated/prisma/enums';

const ACTIONS_VALIDES: ActionLivreur[] = ['livre', 'reporte', 'annule'];

// Statut visé par chacune des trois actions. Nécessaire AVANT de décider de
// l'accès : pour un colis confié à un transporteur, c'est la transition
// demandée qui détermine si le geste est recevable (§ deciderActionColisLivreur).
const STATUT_DE_L_ACTION: Record<ActionLivreur, StatutCommande> = {
  livre: 'livre',
  reporte: 'reporte',
  annule: 'annule',
};

// § /livreur/colis : les 3 actions de livraison mobile, distinctes du PATCH
// générique /api/commandes/[id]/statut (back-office, 27 statuts libres sans
// motif imposé) — chacune ne couvre qu'une transition précise, avec ses
// propres champs requis (RG-02 preuve pour "livre", motif fermé pour les 2
// autres). Réservé au livreur assigné : ni un autre livreur, ni le back-office
// ne passent par cet endpoint (ils ont le PATCH générique pour ça).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['livreur']);
    const { id } = await params;
    const body = await request.json();
    const action = body.action as ActionLivreur | undefined;

    if (!action || !ACTIONS_VALIDES.includes(action)) {
      throw new ApiError(400, 'Le champ action est requis (livre, reporte ou annule)');
    }

    const commande = await prisma.commande.findUnique({
      where: { id },
      include: {
        bonDistribution: { select: { numero: true, statut: true } },
        // § Comptes transporteurs : le colis peut venir d'un bon d'envoi
        // confié à la société dont ce compte est le compte humain, et non
        // d'une tournée. Les deux origines mènent au même écran.
        bonEnvoi: { select: { statut: true, prestataire: { select: { compteLivreurId: true } } } },
      },
    });
    if (!commande) {
      throw new ApiError(404, 'Colis introuvable');
    }

    const confie =
      commande.bonEnvoi?.statut === 'recu' && commande.bonEnvoi.prestataire?.compteLivreurId === session.sub;
    const origine: OrigineColisLivreur = confie
      ? 'confie'
      : commande.bonDistribution && commande.bonDistribution.statut !== 'cloture'
        ? 'tournee'
        : 'aucune';

    // La décision vit dans lib/ (§ deciderActionColisLivreur) : elle porte
    // deux régimes — la tournée interne et la sous-traitance — et la seconde
    // réutilise la règle de transition déjà appliquée par l'API des
    // prestataires, pour qu'un même colis n'ait pas deux vérités selon le
    // canal par lequel on le déclare.
    const decision = deciderActionColisLivreur(
      {
        livreurId: commande.livreurId,
        statut: commande.statut,
        origine,
        tourneeNumero: commande.bonDistribution?.numero ?? null,
      },
      session.sub,
      STATUT_DE_L_ACTION[action]
    );
    if (decision.issue === 'refuse') {
      throw new ApiError(decision.status, decision.message);
    }
    // Rejeu : le colis porte déjà ce statut. On répond succès sans rien
    // réécrire — une seconde ligne d'historique laisserait croire à une
    // seconde tentative de livraison.
    if (decision.issue === 'inchange') {
      return NextResponse.json({ issue: 'inchange', statut: commande.statut });
    }

    let nouveauStatut: 'livre' | 'reporte' | 'annule';
    let motifRetour: string | null = null;
    let dateNouvelleLivraison: Date | null = null;
    let photoPreuveUrl: string | undefined;
    let signatureUrl: string | undefined;
    let note: string | null = null;

    if (action === 'livre') {
      nouveauStatut = 'livre';
      photoPreuveUrl = typeof body.photoPreuveUrl === 'string' ? body.photoPreuveUrl : undefined;
      signatureUrl = typeof body.signatureUrl === 'string' ? body.signatureUrl : undefined;
      if (!photoPreuveUrl && !signatureUrl) {
        throw new ApiError(400, 'Une preuve de livraison (photo ou signature) est requise'); // RG-02
      }
    } else if (action === 'reporte') {
      nouveauStatut = 'reporte';
      const motif = body.motif as string | undefined;
      if (!motif || !MOTIFS_REPORT_LIVREUR.includes(motif as (typeof MOTIFS_REPORT_LIVREUR)[number])) {
        throw new ApiError(400, `Un motif est requis parmi : ${MOTIFS_REPORT_LIVREUR.join(', ')}`);
      }
      const dateRaw = typeof body.dateNouvelleLivraison === 'string' ? new Date(body.dateNouvelleLivraison) : null;
      if (!dateRaw || Number.isNaN(dateRaw.getTime())) {
        throw new ApiError(400, 'Une date de nouvelle livraison valide est requise');
      }
      motifRetour = motif;
      dateNouvelleLivraison = dateRaw;
      note = `Reporté — ${motif} — nouvelle tentative prévue le ${dateRaw.toLocaleDateString('fr-FR')}`;
    } else {
      nouveauStatut = 'annule';
      const motif = body.motif as string | undefined;
      if (!motif || !MOTIFS_ANNULATION_LIVREUR.includes(motif as (typeof MOTIFS_ANNULATION_LIVREUR)[number])) {
        throw new ApiError(400, `Un motif est requis parmi : ${MOTIFS_ANNULATION_LIVREUR.join(', ')}`);
      }
      motifRetour = motif;
      note = `Annulé — ${motif}`;
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id },
        data: {
          statut: nouveauStatut,
          ...(nouveauStatut === 'livre' && { dateLivraison: now, photoPreuveUrl, signatureUrl }),
          ...(nouveauStatut === 'reporte' && { motifRetour, dateNouvelleLivraison }),
          ...(nouveauStatut === 'annule' && { motifRetour }),
        },
      });

      // RG-10 : historisation de chaque changement de statut.
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: id,
          ancienStatut: commande.statut,
          nouveauStatut,
          utilisateurId: session.sub,
          note,
        },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
