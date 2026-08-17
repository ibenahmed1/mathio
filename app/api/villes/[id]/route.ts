import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

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
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    try {
      const ville = await prisma.ville.update({ where: { id }, data });
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
