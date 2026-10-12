import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

// BROUILLON → VALIDE : le responsable arrête le montant. Après ce passage,
// plus aucun ajustement n'est accepté (cf. POST .../ajustements) : c'est
// précisément ce que « validé » veut dire, et sans ce verrou la validation ne
// serait qu'une étiquette.
//
// Aucune écriture comptable ici : valider n'est pas décaisser. L'argent ne
// sort qu'au passage `paye`.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_PAIEMENT]);
    const { id } = await params;

    const bon = await prisma.bonPaiement.findUnique({
      where: { id },
      select: { id: true, statut: true, montantTotal: true },
    });
    if (!bon) throw new ApiError(404, 'Bon de paiement introuvable');
    if (bon.statut !== 'brouillon') {
      throw new ApiError(409, `Seul un bon en brouillon peut être validé (statut actuel : ${bon.statut})`);
    }
    // Un net négatif (pénalités supérieures aux commissions) n'est pas un bon
    // de paiement : il n'y a rien à verser, et l'écriture comptable qui en
    // découlerait serait une dépense négative. Le cas se règle par une retenue
    // sur le mois suivant, pas par un bon.
    if (Number(bon.montantTotal) < 0) {
      throw new ApiError(
        409,
        'Le net de ce bon est négatif : retirez des pénalités ou reportez-les sur la période suivante.'
      );
    }

    // Conditionné au brouillon : une validation croisée avec une annulation
    // rendait payable un bon dont les tournées venaient d'être libérées.
    const verrou = await prisma.bonPaiement.updateMany({
      where: { id, statut: 'brouillon' },
      data: { statut: 'valide', dateValidation: new Date(), valideParId: session.sub },
    });
    if (verrou.count !== 1) {
      throw new ApiError(409, 'Ce bon vient de changer de statut — rechargez la page');
    }
    const valide = await prisma.bonPaiement.findUniqueOrThrow({
      where: { id },
      include: { livreur: { select: { nomComplet: true } } },
    });

    return NextResponse.json(valide);
  } catch (error) {
    return jsonError(error);
  }
}
