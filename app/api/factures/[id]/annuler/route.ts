import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const ROLES_FACTURATION = ['admin', 'responsable'] as const;

// Annulation d'une facture BROUILLON ou EMISE : les lignes sont supprimées et
// les colis repassent `non_paye`, donc de nouveau facturables. Sans cette
// libération, les colis resteraient à jamais infacturables — c'est tout
// l'objet de l'annulation.
//
// La facture elle-même est CONSERVÉE avec son numéro et ses totaux, au statut
// `annulee` : c'est la trace de ce qui a été émis puis retiré. Les frais
// annexes y restent attachés pour la même raison — le document doit rester
// lisible tel qu'il a été présenté.
//
// Une facture DÉJÀ RÉGLÉE ne s'annule pas ici : l'argent est sorti, et le
// principe d'immuabilité du journal comptable (cf. Transaction.estAnnulee)
// veut qu'on la neutralise par une écriture de compensation depuis
// /admin/comptabilite, pas qu'on efface l'historique. Même règle que le bon de
// paiement livreur. Refuser explicitement vaut mieux que de laisser croire que
// l'annulation a défait le paiement.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLES_FACTURATION]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const facture = await prisma.facture.findUnique({ where: { id }, select: { id: true, statut: true } });
    if (!facture) throw new ApiError(404, 'Facture introuvable');
    if (facture.statut === 'annulee') throw new ApiError(409, 'Cette facture est déjà annulée');
    if (facture.statut === 'payee') {
      throw new ApiError(
        409,
        "Cette facture est déjà réglée : passez par une écriture d'annulation en comptabilité plutôt que d'annuler la facture."
      );
    }

    // Le motif n'est exigé que sur une facture ÉMISE : elle a été annoncée au
    // marchand, son retrait doit s'expliquer. Un brouillon n'a jamais quitté
    // le back-office — réclamer une justification pour jeter un brouillon
    // serait une friction sans destinataire.
    const motif = typeof body.motif === 'string' ? body.motif.trim() : '';
    if (facture.statut === 'emise' && !motif) {
      throw new ApiError(400, "Le motif d'annulation est obligatoire pour une facture déjà émise");
    }

    const annulee = await prisma.$transaction(async (tx) => {
      await tx.commande.updateMany({
        where: { ligneFacture: { factureId: id } },
        data: { etatPaiement: 'non_paye' },
      });

      // Les lignes disparaissent pour libérer la contrainte d'unicité sur
      // commandeId — sans ça, les colis resteraient à jamais infacturables.
      await tx.ligneFacture.deleteMany({ where: { factureId: id } });

      return tx.facture.update({
        where: { id },
        data: { statut: 'annulee', dateAnnulation: new Date(), motifAnnulation: motif || null },
      });
    });

    return NextResponse.json(annulee);
  } catch (error) {
    return jsonError(error);
  }
}
