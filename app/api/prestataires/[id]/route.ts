import { NextResponse } from 'next/server';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const data: Prisma.PrestataireUpdateInput = {};
    if (typeof body.nom === 'string' && body.nom.trim()) {
      data.nom = body.nom.trim();
    }
    for (const champ of ['contact', 'telephone', 'email'] as const) {
      if (body[champ] !== undefined) {
        data[champ] = typeof body[champ] === 'string' && body[champ].trim() ? body[champ].trim() : null;
      }
    }
    if (typeof body.actif === 'boolean') {
      data.actif = body.actif;
    }
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucune modification fournie');
    }

    try {
      const prestataire = await prisma.prestataire.update({ where: { id }, data });
      return NextResponse.json(prestataire);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ApiError(409, 'Ce prestataire existe déjà');
        if (error.code === 'P2025') throw new ApiError(404, 'Prestataire introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression réservée au prestataire qui n'a jamais servi : dès qu'une agence
// lui est rattachée, on désactive (PATCH actif:false) plutôt que de supprimer,
// pour ne pas perdre l'historique tarifaire des colis déjà livrés. Les tarifs
// eux-mêmes tombent en cascade (cf. TarifPrestataireVille).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const nbAgences = await prisma.hub.count({ where: { prestataireId: id } });
    if (nbAgences > 0) {
      throw new ApiError(
        409,
        `Ce prestataire a ${nbAgences} agence(s) rattachée(s) : détachez-les d'abord, ou désactivez le prestataire.`
      );
    }

    try {
      await prisma.prestataire.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'Prestataire introuvable');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
