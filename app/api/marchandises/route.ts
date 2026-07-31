import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

async function getOwnMarchand(utilisateurId: string) {
  const marchand = await resolveMarchandForUser(utilisateurId);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return marchand;
}

// Catalogue "marchandise" — sert à peupler la liste déroulante du formulaire
// colis (RG : un marchand ne choisit que parmi les marchandises qu'il a
// lui-même déjà saisies). Un marchand ne voit que son propre catalogue ; un
// admin peut consulter celui d'un marchand précis (créer/modifier un colis
// en son nom depuis le back-office), en le précisant via ?marchandId=.
export async function GET(request: Request) {
  try {
    const session = await requireUser(['marchand', 'admin']);

    let marchandId: string;
    if (session.role === 'admin') {
      const { searchParams } = new URL(request.url);
      const requested = searchParams.get('marchandId');
      if (!requested) {
        throw new ApiError(400, 'marchandId est requis');
      }
      marchandId = requested;
    } else {
      const marchand = await getOwnMarchand(session.sub);
      marchandId = marchand.id;
    }

    const marchandises = await prisma.marchandise.findMany({
      where: { marchandId },
      orderBy: { nom: 'asc' },
    });
    return NextResponse.json({ data: marchandises });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const qteStock = Number(body.qteStock);
    const prix = Number(body.prix);

    if (!nom) {
      throw new ApiError(400, 'nom est requis');
    }
    if (!Number.isFinite(qteStock) || qteStock < 0) {
      throw new ApiError(400, 'qteStock doit être un nombre positif ou nul');
    }
    if (!Number.isFinite(prix) || prix < 0) {
      throw new ApiError(400, 'prix doit être un nombre positif ou nul');
    }

    const existante = await prisma.marchandise.findUnique({
      where: { marchandId_nom: { marchandId: marchand.id, nom } },
    });
    if (existante) {
      throw new ApiError(409, 'Une marchandise avec ce nom existe déjà dans votre catalogue');
    }

    const marchandise = await prisma.marchandise.create({
      data: { marchandId: marchand.id, nom, qteStock: Math.trunc(qteStock), prix },
    });

    return NextResponse.json(marchandise, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
