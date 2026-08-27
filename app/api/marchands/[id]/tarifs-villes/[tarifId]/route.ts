import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Modifier un tarif ne touche PAS les factures déjà émises : leurs totaux et
// leurs lignes sont figés à l'émission (cf. lib/facturation.ts). Le nouveau
// tarif ne vaut que pour les colis facturés ensuite.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; tarifId: string }> }
) {
  try {
    await requireUser(['admin']);
    const { id, tarifId } = await params;
    const body = await request.json();

    const data: Prisma.TarifMarchandVilleUpdateInput = {};
    if (body.fraisLivraison !== undefined) data.fraisLivraison = Number(body.fraisLivraison);
    if (body.fraisRetour !== undefined) data.fraisRetour = Number(body.fraisRetour);
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    const tarif = await prisma.tarifMarchandVille.findUnique({ where: { id: tarifId } });
    if (!tarif || tarif.marchandId !== id) {
      throw new ApiError(404, 'Tarif introuvable pour ce marchand');
    }

    const updated = await prisma.tarifMarchandVille.update({
      where: { id: tarifId },
      data,
      include: { ville: { select: { id: true, nom: true } } },
    });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; tarifId: string }> }
) {
  try {
    await requireUser(['admin']);
    const { id, tarifId } = await params;

    const tarif = await prisma.tarifMarchandVille.findUnique({ where: { id: tarifId } });
    if (!tarif || tarif.marchandId !== id) {
      throw new ApiError(404, 'Tarif introuvable pour ce marchand');
    }

    await prisma.tarifMarchandVille.delete({ where: { id: tarifId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
