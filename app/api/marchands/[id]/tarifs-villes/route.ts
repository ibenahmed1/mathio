import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// § Facturation marchand : grille des frais FACTURÉS au marchand par ville —
// pendant exact de /api/utilisateurs/[id]/tarifs-villes, qui gère les frais
// PAYÉS au livreur. Les villes sans ligne ici retombent sur
// Marchand.fraisLivraison / fraisRetour.
//
// Réservé à l'admin comme la grille livreur : un tarif est une donnée
// contractuelle, pas un paramètre d'exploitation.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'responsable']);
    const { id } = await params;

    const tarifs = await prisma.tarifMarchandVille.findMany({
      where: { marchandId: id },
      include: { ville: { select: { id: true, nom: true } } },
      orderBy: { ville: { nom: 'asc' } },
    });

    return NextResponse.json({ data: tarifs });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const villeId = typeof body.villeId === 'string' ? body.villeId.trim() : '';
    if (!villeId || body.fraisLivraison === undefined || body.fraisRetour === undefined) {
      throw new ApiError(400, 'villeId, fraisLivraison et fraisRetour sont requis');
    }

    const fraisLivraison = Number(body.fraisLivraison);
    const fraisRetour = Number(body.fraisRetour);
    if (!Number.isFinite(fraisLivraison) || fraisLivraison < 0 || !Number.isFinite(fraisRetour) || fraisRetour < 0) {
      throw new ApiError(400, 'Les frais doivent être des montants positifs');
    }

    const marchand = await prisma.marchand.findUnique({ where: { id }, select: { id: true } });
    if (!marchand) throw new ApiError(404, 'Marchand introuvable');

    const ville = await prisma.ville.findUnique({ where: { id: villeId }, select: { id: true } });
    if (!ville) throw new ApiError(404, 'Ville introuvable');

    try {
      const tarif = await prisma.tarifMarchandVille.create({
        data: { marchandId: id, villeId, fraisLivraison, fraisRetour },
        include: { ville: { select: { id: true, nom: true } } },
      });
      return NextResponse.json(tarif, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Un tarif existe déjà pour cette ville — modifiez-le plutôt');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
