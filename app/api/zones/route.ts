import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

export async function GET() {
  try {
    await requireUser(['admin']);

    const zones = await prisma.zoneLogistique.findMany({
      orderBy: { nom: 'asc' },
      include: {
        hubs: {
          orderBy: { nom: 'asc' },
          include: { villes: { orderBy: [{ type: 'asc' }, { nom: 'asc' }] } },
        },
      },
    });

    return NextResponse.json({ data: zones });
  } catch (error) {
    return jsonError(error);
  }
}

// Référentiel géographique (zone → hub → ville, cf. prisma/seed.ts pour le
// découpage initial) : gestion admin uniquement pour l'instant.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase().replace(/\s+/g, '_') : '';

    if (!nom || !code) {
      throw new ApiError(400, 'nom et code sont requis');
    }

    try {
      const zone = await prisma.zoneLogistique.create({ data: { code, nom } });
      return NextResponse.json(zone, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Ce code de zone existe déjà');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
