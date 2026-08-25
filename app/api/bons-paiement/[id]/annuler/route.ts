import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

// Annulation d'un bon BROUILLON ou VALIDE : erreur de saisie, contestation du
// livreur, mauvaise assiette. Les tournées rattachées sont LIBÉRÉES —
// `bonPaiementId` et `gainRegleLe` repassent à null — et redeviennent donc
// éligibles à un nouveau bon sur la même période. Sans cette libération, le
// gain du livreur serait perdu à jamais : c'est tout l'objet de l'annulation.
//
// Le bon lui-même est CONSERVÉ avec son numéro et ses totaux, au statut
// `annule` : c'est la trace de ce qui a été émis puis retiré, et c'est aussi
// ce qui exclut sa période du verrou d'unicité (cf. STATUTS_OCCUPANTS).
//
// Un bon DÉJÀ PAYÉ ne s'annule pas ici : l'argent est sorti, et le principe
// d'immuabilité du journal comptable (cf. Transaction.estAnnulee) veut qu'on
// le neutralise par une écriture de compensation depuis /admin/comptabilite,
// pas qu'on efface l'historique. Même règle que la facture marchand
// (cf. POST /api/factures/[id]/annuler). Refuser explicitement vaut mieux que
// de laisser croire que l'annulation a défait le paiement.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLES_PAIEMENT]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const motif = typeof body.motif === 'string' ? body.motif.trim() : '';
    if (!motif) {
      throw new ApiError(400, "Le motif d'annulation est obligatoire");
    }

    const bon = await prisma.bonPaiement.findUnique({
      where: { id },
      select: { id: true, statut: true },
    });
    if (!bon) throw new ApiError(404, 'Bon de paiement introuvable');
    if (bon.statut === 'annule') throw new ApiError(409, 'Ce bon est déjà annulé');
    if (bon.statut === 'paye') {
      throw new ApiError(
        409,
        "Ce bon est déjà payé : passez par une écriture d'annulation en comptabilité plutôt que d'annuler le bon."
      );
    }

    const annule = await prisma.$transaction(async (tx) => {
      await tx.bonDistribution.updateMany({
        where: { bonPaiementId: id },
        data: { bonPaiementId: null, gainRegleLe: null },
      });

      // Les ajustements restent attachés au bon annulé, et ses totaux ne sont
      // pas remis à zéro : le document doit rester lisible tel qu'il a été
      // émis. Ils ne sont PAS reconduits sur le bon régénéré — reprendre une
      // pénalité décidée sur une assiette qui n'existe plus est une décision
      // du comptable, pas du système.
      return tx.bonPaiement.update({
        where: { id },
        data: { statut: 'annule', dateAnnulation: new Date(), motifAnnulation: motif },
      });
    });

    return NextResponse.json(annule);
  } catch (error) {
    return jsonError(error);
  }
}
