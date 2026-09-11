import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { appliquerTarifPrestataire } from '@/lib/prestataires';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const data: Prisma.VilleUpdateInput = {};
    if (typeof body.nom === 'string' && body.nom.trim()) {
      data.nom = body.nom.trim();
    }
    if (typeof body.hubId === 'string' && body.hubId.trim()) {
      const hub = await prisma.hub.findUnique({ where: { id: body.hubId.trim() } });
      if (!hub) {
        throw new ApiError(404, 'Hub introuvable');
      }
      data.hub = { connect: { id: body.hubId.trim() } };
    }
    // Le tarif ne vit pas sur la Ville (il dépend du prestataire, cf.
    // TarifPrestataireVille) : il est donc légitime de ne modifier QUE lui.
    const modifieTarif = body.tarif !== undefined;
    if (Object.keys(data).length === 0 && !modifieTarif) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    try {
      const ville =
        Object.keys(data).length > 0
          ? await prisma.ville.update({ where: { id }, data })
          : await prisma.ville.findUniqueOrThrow({ where: { id } });
      if (modifieTarif) {
        // Sur le hub d'arrivée : déplacer une ville d'une agence à une autre
        // et retarifer dans la foulée est le geste courant. L'ancienne ligne
        // tarifaire est conservée volontairement — un prestataire tarifé sur
        // une ville qu'il ne dessert plus, c'est l'offre qu'on garde sous la
        // main pour comparer ou revenir en arrière.
        await appliquerTarifPrestataire(ville.id, ville.hubId, body.tarif, body.tarifRetour);
      }
      return NextResponse.json(ville);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ApiError(409, 'Cette ville existe déjà');
        if (error.code === 'P2025') throw new ApiError(404, 'Ville introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    try {
      await prisma.ville.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'Ville introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
