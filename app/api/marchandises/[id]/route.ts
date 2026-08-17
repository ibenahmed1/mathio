import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

async function findOwnMarchandise(id: string, utilisateurId: string) {
  const marchand = await resolveMarchandForUser(utilisateurId);
  const marchandise = await prisma.marchandise.findUnique({ where: { id } });
  if (!marchandise || !marchand || marchandise.marchandId !== marchand.id) {
    throw new ApiError(404, 'Marchandise introuvable');
  }
  return marchandise;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const { id } = await params;
    await findOwnMarchandise(id, session.sub);
    const body = await request.json();

    const data: { nom?: string; qteStock?: number; prix?: number } = {};

    if (typeof body.nom === 'string' && body.nom.trim()) data.nom = body.nom.trim();
    if (body.qteStock !== undefined) {
      const qteStock = Number(body.qteStock);
      if (!Number.isFinite(qteStock) || qteStock < 0) throw new ApiError(400, 'qteStock doit être un nombre positif ou nul');
      data.qteStock = Math.trunc(qteStock);
    }
    if (body.prix !== undefined) {
      const prix = Number(body.prix);
      if (!Number.isFinite(prix) || prix < 0) throw new ApiError(400, 'prix doit être un nombre positif ou nul');
      data.prix = prix;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucun champ modifiable fourni');
    }

    const updated = await prisma.marchandise.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const { id } = await params;
    await findOwnMarchandise(id, session.sub);
    await prisma.marchandise.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
