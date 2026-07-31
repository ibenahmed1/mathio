import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

async function getOwnMarchand(utilisateurId: string) {
  const marchand = await resolveMarchandForUser(utilisateurId);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return marchand;
}

export async function GET() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    const adresses = await prisma.adresseMarchand.findMany({
      where: { marchandId: marchand.id },
      orderBy: { estParDefaut: 'desc' },
    });
    return NextResponse.json({ data: adresses });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    const body = await request.json();

    const libelle = typeof body.libelle === 'string' ? body.libelle.trim() : '';
    const adresseComplete = typeof body.adresseComplete === 'string' ? body.adresseComplete.trim() : '';

    if (!libelle || !adresseComplete) {
      throw new ApiError(400, 'libelle et adresseComplete sont requis');
    }

    const adresse = await prisma.adresseMarchand.create({
      data: {
        marchandId: marchand.id,
        libelle,
        adresseComplete,
        estParDefaut: Boolean(body.estParDefaut),
      },
    });

    return NextResponse.json(adresse, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
