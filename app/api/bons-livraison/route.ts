import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { creerBonsDeLivraison } from '@/lib/bons-livraison';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import type { Prisma } from '@/app/generated/prisma/client';

export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['admin', 'marchand']);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    const where: Prisma.BonDeLivraisonWhereInput = {};

    // RG-07 / RNF-02 : cloisonnement des données par rôle.
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
      where.marchandId = marchand.id;
    }

    const [data, total] = await Promise.all([
      prisma.bonDeLivraison.findMany({
        where,
        include: { marchand: { select: { nomBoutique: true } } },
        orderBy: { dateGeneration: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bonDeLivraison.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

// § /admin/bon-livraison/creer : l'admin regroupe lui-même des colis
// "nouveau_colis" en bons de livraison, pour un marchand qui ne les a pas
// déclarés depuis son espace (dépôt au comptoir, saisie rattrapée après coup).
//
// La sélection peut couvrir plusieurs boutiques : un bon est alors généré par
// marchand représenté — même mécanique que POST /api/bons-preparation. C'est
// ce regroupement côté serveur, et non un `marchandId` reçu du client, qui
// tient l'invariant « un BL, un marchand ».
//
// `requireUser(['admin'])` laisse aussi passer un compte non-admin porteur de
// `bon_livraison:manage`, la permission qui gouverne déjà ce chemin dans
// lib/permission-routes.ts (cf. le second garde-fou de requireUser).
export async function POST(request: NextRequest) {
  try {
    const session = await requireUser(['admin']);
    const body = await request.json();

    const colisIds = parseStringIdArray(body.colisIds);
    if (colisIds.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    const bons = await creerBonsDeLivraison({ colisIds, utilisateurId: session.sub });

    return NextResponse.json({ data: bons }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
