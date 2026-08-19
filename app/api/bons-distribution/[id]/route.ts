import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveUserHub } from '@/lib/hub-envoi';

const bonDistributionInclude = {
  livreur: { select: { nomComplet: true, telephone: true } },
  hub: { select: { nom: true, ville: true } },
  planner: { select: { nomComplet: true } },
  cloturePar: { select: { nomComplet: true } },
  commandes: { include: { marchand: { select: { nomBoutique: true } } }, orderBy: { codeSuivi: 'asc' as const } },
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const { id } = await params;

    const bon = await prisma.bonDistribution.findUnique({ where: { id }, include: bonDistributionInclude });
    if (!bon) throw new ApiError(404, 'Bon de distribution introuvable');

    // Même garde que resolveBonDistributionAutorise (lib/bon-distribution.ts) :
    // un planner ne consulte que les tournées de son propre hub.
    if (session.role === 'planner') {
      const hub = await resolveUserHub(session.sub);
      if (bon.hubId !== hub.id) {
        throw new ApiError(403, 'Cette tournée ne relève pas de votre hub');
      }
    }

    return NextResponse.json(bon);
  } catch (error) {
    return jsonError(error);
  }
}
