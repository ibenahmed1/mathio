import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const data: Prisma.ZoneLogistiqueUpdateInput = {};
    if (typeof body.nom === 'string' && body.nom.trim()) {
      data.nom = body.nom.trim();
    }
    if (typeof body.code === 'string' && body.code.trim()) {
      data.code = body.code.trim().toLowerCase().replace(/\s+/g, '_');
    }
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    try {
      const zone = await prisma.zoneLogistique.update({ where: { id }, data });
      return NextResponse.json(zone);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ApiError(409, 'Ce code de zone existe déjà');
        if (error.code === 'P2025') throw new ApiError(404, 'Zone introuvable');
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
      await prisma.zoneLogistique.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') throw new ApiError(409, "Supprimez d'abord les hubs de cette zone");
        if (error.code === 'P2025') throw new ApiError(404, 'Zone introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
