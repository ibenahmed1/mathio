import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; tarifId: string }> }
) {
  try {
    await requireUser(['admin']);
    const { id, tarifId } = await params;
    const body = await request.json();

    const data: Prisma.TarifLivreurVilleUpdateInput = {};
    if (body.fraisLivraison !== undefined) data.fraisLivraison = Number(body.fraisLivraison);
    if (body.fraisRefus !== undefined) data.fraisRefus = Number(body.fraisRefus);
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    const tarif = await prisma.tarifLivreurVille.findUnique({ where: { id: tarifId } });
    if (!tarif || tarif.utilisateurId !== id) {
      throw new ApiError(404, 'Tarif introuvable pour cet utilisateur');
    }

    const updated = await prisma.tarifLivreurVille.update({
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

    const tarif = await prisma.tarifLivreurVille.findUnique({ where: { id: tarifId } });
    if (!tarif || tarif.utilisateurId !== id) {
      throw new ApiError(404, 'Tarif introuvable pour cet utilisateur');
    }

    await prisma.tarifLivreurVille.delete({ where: { id: tarifId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
