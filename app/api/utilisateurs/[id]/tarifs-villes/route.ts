import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Surcharge des frais de livraison/refus d'un livreur pour une ville donnée
// (maquette "Ajouter Utilisateur" : Frais de livraison (Agadir), etc.) — les
// villes sans ligne ici utilisent Utilisateur.fraisLivraison/fraisRefus.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const tarifs = await prisma.tarifLivreurVille.findMany({
      where: { utilisateurId: id },
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
    if (!villeId || body.fraisLivraison === undefined || body.fraisRefus === undefined) {
      throw new ApiError(400, 'villeId, fraisLivraison et fraisRefus sont requis');
    }

    const livreur = await prisma.utilisateur.findUnique({ where: { id } });
    if (!livreur) throw new ApiError(404, 'Utilisateur introuvable');
    if (livreur.role !== 'livreur') {
      throw new ApiError(400, 'Les tarifs par ville ne concernent que les comptes livreur');
    }

    const ville = await prisma.ville.findUnique({ where: { id: villeId } });
    if (!ville) throw new ApiError(404, 'Ville introuvable');

    try {
      const tarif = await prisma.tarifLivreurVille.create({
        data: {
          utilisateurId: id,
          villeId,
          fraisLivraison: Number(body.fraisLivraison),
          fraisRefus: Number(body.fraisRefus),
        },
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
