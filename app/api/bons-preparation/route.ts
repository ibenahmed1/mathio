import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { nextBonPreparationNumero } from '@/lib/codes';
import type { Commande } from '@/app/generated/prisma/client';

export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20));

    const [data, total] = await Promise.all([
      prisma.bonDePreparation.findMany({
        include: { marchand: { select: { nomBoutique: true } } },
        orderBy: { dateGeneration: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bonDePreparation.count(),
    ]);

    return NextResponse.json({ data, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}

// § Gestion de stock (/admin/stock/prets) : regroupe les colis stock
// sélectionnés (statut pret_pour_preparation, pas encore rattachés à un bon)
// en un Bon de Préparation par marchand — même principe que
// creerBonDeLivraison (app/marchand/bons-livraison/actions.ts), y compris la
// transition de statut des colis vers "attente_de_ramassage" dès qu'ils
// rejoignent un bon (le BPR suit ensuite le même cycle qu'un Bon de
// Livraison, cf. POST /api/bons-preparation/[id]/bien-recu). Peut générer
// plusieurs bons d'un coup quand la sélection couvre plusieurs marchands.
export async function POST(request: NextRequest) {
  try {
    const session = await requireUser(['admin']);
    const body = await request.json();

    const ids = parseStringIdArray(body.colisIds);
    if (ids.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    const colis = await prisma.commande.findMany({
      where: { id: { in: ids }, enStock: true, statut: 'pret_pour_preparation', bonPreparationId: null },
    });
    if (colis.length !== ids.length) {
      throw new ApiError(400, "Un ou plusieurs colis sélectionnés ne sont plus disponibles (déjà groupés dans un bon ou hors statut « prêt pour préparation »)");
    }

    const parMarchand = new Map<string, Commande[]>();
    for (const c of colis) {
      const liste = parMarchand.get(c.marchandId) ?? [];
      liste.push(c);
      parMarchand.set(c.marchandId, liste);
    }

    const bons = await prisma.$transaction(async (tx) => {
      const crees = [];
      for (const [marchandId, lignes] of parMarchand) {
        const numero = await nextBonPreparationNumero(tx);
        const bon = await tx.bonDePreparation.create({
          data: { numero, marchandId, nbColis: lignes.length },
        });
        await tx.commande.updateMany({
          where: { id: { in: lignes.map((c) => c.id) } },
          data: { bonPreparationId: bon.id, statut: 'attente_de_ramassage' },
        });
        await tx.historiqueStatutCommande.createMany({
          data: lignes.map((c) => ({
            commandeId: c.id,
            ancienStatut: 'pret_pour_preparation' as const,
            nouveauStatut: 'attente_de_ramassage' as const,
            utilisateurId: session.sub,
          })),
        });
        crees.push(bon);
      }
      return crees;
    });

    return NextResponse.json({ data: bons }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
