import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';

export async function GET() {
  try {
    const session = await requireUser();

    const user = await prisma.utilisateur.findUnique({
      where: { id: session.sub },
      select: {
        id: true,
        nomComplet: true,
        telephone: true,
        email: true,
        role: true,
        actif: true,
        marchand: { select: { id: true, nomBoutique: true } },
        hub: { select: { id: true, nom: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    return jsonError(error);
  }
}
