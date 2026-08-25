import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { ModeReglementLivreur } from '@/app/generated/prisma/enums';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

const MODES: ModeReglementLivreur[] = ['virement', 'especes', 'cheque'];

// Un virement ou un chèque sans référence n'est pas vérifiable le jour d'une
// contestation : le livreur dit « je n'ai rien reçu », et l'entreprise n'a
// qu'un booléen à opposer. Les espèces font exception — la trace, c'est la
// signature sur le bon papier.
const MODES_AVEC_REFERENCE: ModeReglementLivreur[] = ['virement', 'cheque'];

// VALIDE → PAYE : décaissement effectif. Le bon porte désormais le mode et la
// référence du paiement, chaque tournée reçoit son `gainRegleLe`, et une
// écriture comptable de sortie de caisse est générée en catégorie `salaire`.
//
// Le passage direct depuis BROUILLON est refusé : c'est la validation qui fige
// le montant, et payer un brouillon reviendrait à décaisser une somme encore
// modifiable.
//
// Trois dates volontairement distinctes sur le bon : `dateGeneration` (quand
// le décompte a été arrêté), `dateValidation` (quand le montant a été figé) et
// `dateReglement` (quand l'argent est sorti). Les confondre rendrait
// impossible de mesurer le délai de paiement des livreurs, qui est un sujet
// social autant que comptable.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_PAIEMENT]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const modeReglement = body.modeReglement as ModeReglementLivreur;
    if (!MODES.includes(modeReglement)) {
      throw new ApiError(400, 'Mode de règlement invalide (virement, especes ou cheque)');
    }

    const referenceReglement =
      typeof body.referenceReglement === 'string' ? body.referenceReglement.trim() : '';
    if (MODES_AVEC_REFERENCE.includes(modeReglement) && !referenceReglement) {
      throw new ApiError(400, 'La référence du virement ou du chèque est obligatoire');
    }

    const bon = await prisma.bonPaiement.findUnique({
      where: { id },
      include: { livreur: { select: { nomComplet: true } }, hub: { select: { nom: true } } },
    });
    if (!bon) throw new ApiError(404, 'Bon de paiement introuvable');
    if (bon.statut === 'paye') throw new ApiError(409, 'Ce bon est déjà payé');
    if (bon.statut === 'annule') throw new ApiError(409, 'Ce bon est annulé');
    if (bon.statut === 'brouillon') {
      throw new ApiError(409, 'Validez le bon avant de le payer : un brouillon peut encore être modifié.');
    }

    const now = new Date();
    const periode = bon.periodeDebut.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const paye = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          montant: Number(bon.montantTotal),
          type: 'depense',
          categorie: 'salaire',
          dateEffet: now,
          description: `Paie ${periode} — ${bon.numero} — ${bon.livreur.nomComplet} (${bon.nbTournees} tournée(s), ${bon.nbColisLivres} livré(s)${bon.hub ? `, Hub ${bon.hub.nom}` : ''})`,
          auteurId: session.sub,
        },
      });

      await tx.bonDistribution.updateMany({
        where: { bonPaiementId: id },
        data: { gainRegleLe: now },
      });

      return tx.bonPaiement.update({
        where: { id },
        data: {
          statut: 'paye',
          dateReglement: now,
          modeReglement,
          referenceReglement: referenceReglement || null,
          transactionId: transaction.id,
        },
        include: { livreur: { select: { nomComplet: true } } },
      });
    });

    return NextResponse.json(paye);
  } catch (error) {
    return jsonError(error);
  }
}
