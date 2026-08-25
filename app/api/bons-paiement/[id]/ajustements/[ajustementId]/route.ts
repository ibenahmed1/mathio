import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { recalculerTotaux } from '@/lib/bon-paiement';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

// Retire une ligne d'ajustement d'un bon en BROUILLON. Une suppression franche
// plutôt qu'un marquage « annulé » : tant que le bon n'est pas validé, rien
// n'a encore été arrêté ni communiqué au livreur — il n'y a pas d'historique à
// préserver, seulement un brouillon qu'on corrige.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; ajustementId: string }> }
) {
  try {
    await requireUser([...ROLES_PAIEMENT]);
    const { id, ajustementId } = await params;

    const bon = await prisma.bonPaiement.findUnique({ where: { id }, select: { statut: true } });
    if (!bon) throw new ApiError(404, 'Bon de paiement introuvable');
    if (bon.statut !== 'brouillon') {
      throw new ApiError(409, `Un bon ${bon.statut} ne se modifie plus.`);
    }

    // Le filtre porte sur les DEUX identifiants : sans le bonPaiementId, une
    // requête forgée retirerait une ligne d'un autre bon, encore en brouillon
    // lui aussi, dont les totaux ne seraient alors jamais recalculés.
    const ajustement = await prisma.ajustementBonPaiement.findFirst({
      where: { id: ajustementId, bonPaiementId: id },
      select: { id: true },
    });
    if (!ajustement) throw new ApiError(404, 'Ajustement introuvable sur ce bon');

    const majour = await prisma.$transaction(async (tx) => {
      await tx.ajustementBonPaiement.delete({ where: { id: ajustementId } });
      return recalculerTotaux(tx, id);
    });

    return NextResponse.json(majour);
  } catch (error) {
    return jsonError(error);
  }
}
