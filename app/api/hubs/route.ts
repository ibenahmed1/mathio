import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Référentiel géographique plat (Hub ↔ Ville) : gestion admin uniquement.
export async function GET() {
  try {
    await requireUser(['admin']);

    const hubs = await prisma.hub.findMany({
      orderBy: { nom: 'asc' },
      include: {
        villes: { orderBy: { nom: 'asc' } },
      },
    });

    const hubsAvecCompteur = await Promise.all(
      hubs.map(async (hub) => {
        const nbColisDepot = await prisma.commande.count({
          where: { hubActuelId: hub.id, statut: 'recu_au_hub' },
        });
        return { ...hub, nbColisDepot };
      })
    );

    return NextResponse.json({ data: hubsAvecCompteur });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const ville = typeof body.ville === 'string' ? body.ville.trim() : '';
    const adresse = typeof body.adresse === 'string' && body.adresse.trim() ? body.adresse.trim() : null;
    const telephone = typeof body.telephone === 'string' && body.telephone.trim() ? body.telephone.trim() : null;
    const isCentral = body.isCentral === true;

    if (!nom || !ville) {
      throw new ApiError(400, 'nom et ville sont requis');
    }

    try {
      const hub = await prisma.hub.create({ data: { nom, ville, adresse, telephone, isCentral } });
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
