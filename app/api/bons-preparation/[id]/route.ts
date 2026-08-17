import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonDePreparation.findUnique({
      where: { id },
      include: {
        marchand: {
          select: { nomBoutique: true, utilisateur: { select: { nomComplet: true, telephone: true } } },
        },
        validateur: { select: { nomComplet: true } },
        commandes: {
          orderBy: { codeSuivi: 'asc' },
          include: { produit: { select: { id: true, nom: true, reference: true, photoUrl: true } } },
        },
      },
    });

    if (!bon) throw new ApiError(404, 'Bon de préparation introuvable');

    return NextResponse.json(bon);
  } catch (error) {
    return jsonError(error);
  }
}
