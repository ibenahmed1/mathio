import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import { estColisARecuperer, resolveBonDistributionAutorise } from '@/lib/bon-distribution';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';

// § Clôture de tournée : le Planner scanne un par un les colis non livrés que
// le livreur ramène au dépôt. Le scan fait basculer le colis de son état
// TERRAIN (refuse / reporte / annule / mise_en_distribution s'il n'a même pas
// été tenté) vers son état PHYSIQUE au dépôt : retourne_au_hub. Le motif
// terrain n'est pas écrasé (Commande.motifRetour est conservé) et reste
// lisible dans l'historique — le scan ne dit que "ce colis est de nouveau au
// hub X", il ne réinterprète pas la tentative de livraison.
//
// Idempotent : rescanner un colis déjà rentré renvoie 200 sans recréer
// d'entrée d'historique (même convention que POST /api/commandes/scan-reception).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const { id } = await params;
    const body = await request.json();

    const bon = await resolveBonDistributionAutorise(session, id);
    if (bon.statut === 'cloture') {
      throw new ApiError(409, 'Cette tournée est déjà clôturée : plus aucun retour ne peut y être enregistré');
    }

    const qrPayload = typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '';
    let codeSuivi = typeof body.codeSuivi === 'string' ? body.codeSuivi.trim().toUpperCase() : '';

    if (qrPayload) {
      const result = validateQrPayload(qrPayload);
      if (!result.valid || result.parcelId === undefined) {
        throw new ApiError(400, result.reason ?? 'QR code invalide');
      }
      codeSuivi = `PD-${String(result.parcelId).padStart(6, '0')}`;
    }

    if (!codeSuivi) {
      throw new ApiError(400, 'codeSuivi ou qrPayload est requis');
    }

    const commande = await prisma.commande.findUnique({ where: { codeSuivi } });
    if (!commande) {
      throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
    }
    // Un colis ne peut rentrer que dans la tournée qui l'a emporté : scanner
    // au retour un colis d'une autre tournée fausserait les deux décomptes.
    if (commande.bonDistributionId !== bon.id) {
      throw new ApiError(409, `Ce colis n'appartient pas à la tournée ${bon.numero}.`);
    }
    if (commande.statut === 'retourne_au_hub') {
      return NextResponse.json({ commande, dejaScanne: true });
    }
    if (!estColisARecuperer(commande.statut)) {
      throw new ApiError(
        409,
        `Ce colis est au statut "${LABELS_STATUT_COMMANDE[commande.statut]}" : seul un colis non livré revient au dépôt.`
      );
    }

    const planner = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: { nomComplet: true },
    });
    const auteur = planner?.nomComplet ?? 'Planificateur';
    const motifTerrain = commande.motifRetour ? ` (motif terrain : ${commande.motifRetour})` : '';

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id: commande.id },
        data: {
          statut: 'retourne_au_hub',
          hubActuelId: bon.hubId,
          dateReceptionHub: new Date(),
        },
      });

      // RG-10 : l'historique porte le hub, l'auteur du scan et l'état terrain
      // d'origine — "Retourné et scanné au Hub par [Planner]".
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: commande.id,
          ancienStatut: commande.statut,
          nouveauStatut: 'retourne_au_hub',
          utilisateurId: session.sub,
          hubId: bon.hubId,
          note: `Retour de tournée ${bon.numero} scanné au Hub ${bon.hub.nom} par ${auteur}${motifTerrain}`,
        },
      });

      return result;
    });

    return NextResponse.json({ commande: updated, dejaScanne: false });
  } catch (error) {
    return jsonError(error);
  }
}
