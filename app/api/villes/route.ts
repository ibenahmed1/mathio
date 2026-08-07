import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { TypeVille } from '@/app/generated/prisma/enums';

const TYPES_VILLE: TypeVille[] = ['principale', 'satellite'];

// La lecture se fait via /api/zones (villes imbriquées sous chaque hub) — cet
// endpoint ne sert qu'à la création.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const hubId = typeof body.hubId === 'string' ? body.hubId.trim() : '';
    const type = body.type as TypeVille | undefined;

    if (!nom || !hubId || !type) {
      throw new ApiError(400, 'nom, hubId et type sont requis');
    }
    if (!TYPES_VILLE.includes(type)) {
      throw new ApiError(400, `type invalide. Valeurs possibles : ${TYPES_VILLE.join(', ')}`);
    }

    const hub = await prisma.hubRegional.findUnique({ where: { id: hubId } });
    if (!hub) {
      throw new ApiError(404, 'Hub introuvable');
    }

    try {
      const ville = await prisma.ville.create({ data: { nom, hubId, type } });
      return NextResponse.json(ville, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Cette ville existe déjà');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
