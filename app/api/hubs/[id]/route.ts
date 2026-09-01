import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { messageConflitHub } from '@/lib/prestataires';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const data: Prisma.HubUpdateInput = {};
    if (typeof body.nom === 'string' && body.nom.trim()) {
      data.nom = body.nom.trim();
    }
    if (typeof body.ville === 'string' && body.ville.trim()) {
      data.ville = body.ville.trim();
    }
    if (body.adresse !== undefined) {
      data.adresse = typeof body.adresse === 'string' && body.adresse.trim() ? body.adresse.trim() : null;
    }
    if (body.telephone !== undefined) {
      data.telephone = typeof body.telephone === 'string' && body.telephone.trim() ? body.telephone.trim() : null;
    }
    if (typeof body.isCentral === 'boolean') {
      data.isCentral = body.isCentral;
    }
    // Bascule interne ↔ sous-traitance : chaîne vide ou null = on rend le hub
    // à l'exploitation interne (cf. Hub.prestataireId).
    if (body.prestataireId !== undefined) {
      const prestataireId =
        typeof body.prestataireId === 'string' && body.prestataireId.trim() ? body.prestataireId.trim() : null;
      if (prestataireId) {
        if (!(await prisma.prestataire.findUnique({ where: { id: prestataireId } }))) {
          throw new ApiError(404, 'Prestataire introuvable');
        }
        data.prestataire = { connect: { id: prestataireId } };
      } else {
        data.prestataire = { disconnect: true };
      }
    }
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    try {
      const hub = await prisma.hub.update({ where: { id }, data });
      return NextResponse.json(hub);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ApiError(409, messageConflitHub(error));
        if (error.code === 'P2025') throw new ApiError(404, 'Hub introuvable');
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
      await prisma.hub.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') throw new ApiError(409, "Supprimez d'abord les villes/utilisateurs rattachés à ce hub");
        if (error.code === 'P2025') throw new ApiError(404, 'Hub introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
