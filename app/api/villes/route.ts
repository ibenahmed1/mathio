import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { appliquerTarifPrestataire } from '@/lib/prestataires';

// La lecture se fait via /api/hubs (villes imbriquées sous chaque hub) — cet
// endpoint ne sert qu'à la création.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const hubId = typeof body.hubId === 'string' ? body.hubId.trim() : '';

    if (!nom || !hubId) {
      throw new ApiError(400, 'nom et hubId sont requis');
    }

    const hub = await prisma.hub.findUnique({ where: { id: hubId } });
    if (!hub) {
      throw new ApiError(404, 'Hub introuvable');
    }

    try {
      const ville = await prisma.ville.create({ data: { nom, hubId } });
      // Sans effet si le hub est interne (cf. appliquerTarifPrestataire).
      if (body.tarif !== undefined) {
        await appliquerTarifPrestataire(ville.id, hubId, body.tarif, body.tarifRetour);
      }
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
