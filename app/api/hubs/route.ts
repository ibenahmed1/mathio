import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// La lecture se fait via /api/zones (hubs imbriqués) — cet endpoint ne sert
// qu'à la création.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const zoneId = typeof body.zoneId === 'string' ? body.zoneId.trim() : '';

    if (!nom || !zoneId) {
      throw new ApiError(400, 'nom et zoneId sont requis');
    }

    const zone = await prisma.zoneLogistique.findUnique({ where: { id: zoneId } });
    if (!zone) {
      throw new ApiError(404, 'Zone introuvable');
    }

    try {
      const hub = await prisma.hubRegional.create({ data: { nom, zoneId } });
      return NextResponse.json(hub, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Ce nom de hub existe déjà');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
