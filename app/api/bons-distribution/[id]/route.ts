import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const bonDistributionInclude = {
  livreur: { select: { nomComplet: true, telephone: true } },
  hub: { select: { nom: true } },
  commandes: { include: { marchand: { select: { nomBoutique: true } } }, orderBy: { codeSuivi: 'asc' as const } },
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonDistribution.findUnique({ where: { id }, include: bonDistributionInclude });
    if (!bon) throw new ApiError(404, 'Bon de distribution introuvable');

    return NextResponse.json(bon);
  } catch (error) {
    return jsonError(error);
  }
}
