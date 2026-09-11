import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { StatutMarchand } from '@/app/generated/prisma/enums';

const STATUTS_VALIDES: StatutMarchand[] = ['en_attente_validation', 'actif', 'suspendu'];

export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);
    const statutParam = request.nextUrl.searchParams.get('statut');

    if (statutParam && !STATUTS_VALIDES.includes(statutParam as StatutMarchand)) {
      throw new ApiError(400, `Statut invalide : ${statutParam}`);
    }

    const marchands = await prisma.marchand.findMany({
      where: statutParam ? { statut: statutParam as StatutMarchand } : undefined,
      orderBy: { dateCreation: 'desc' },
      include: {
        utilisateur: { select: { nomComplet: true, telephone: true, email: true, actif: true } },
        // § Plateformes partenaires : de quel canal ce marchand nous vient, et
        // dans quel environnement. Sert à SIGNALER les marchands issus d'un bac
        // à sable — l'isolation retenue étant logique, ils vivent dans cette
        // table au milieu des vrais clients, et rien d'autre ne permettrait de
        // les en distinguer avant de les approuver ou de les facturer.
        comptesExternes: {
          select: { environnement: true, plateforme: { select: { code: true, nom: true } } },
        },
      },
    });

    return NextResponse.json({ data: marchands });
  } catch (error) {
    return jsonError(error);
  }
}
