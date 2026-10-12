import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';

// Envois de stock annoncés par les plateformes partenaires (POST
// /api/v1/stock/envois), pour l'écran de réception de l'entrepôt. Par défaut
// les envois encore ouverts ; ?statut=tous pour l'historique.
export async function GET(request: Request) {
  try {
    await requireUser(['admin']);
    const tous = new URL(request.url).searchParams.get('statut') === 'tous';

    const envois = await prisma.envoiStock.findMany({
      where: tous ? undefined : { statut: { not: 'recu' } },
      orderBy: { dateAnnonce: tous ? 'desc' : 'asc' },
      take: 500,
      select: {
        id: true,
        reference: true,
        environnement: true,
        statut: true,
        dateAnnonce: true,
        dateReception: true,
        plateforme: { select: { nom: true } },
        lignes: {
          orderBy: { sku: 'asc' },
          select: {
            id: true,
            sku: true,
            quantiteAnnoncee: true,
            quantiteRecue: true,
            produit: { select: { id: true, nom: true, marchand: { select: { nomBoutique: true } } } },
            variante: { select: { nom: true } },
          },
        },
      },
    });
    return NextResponse.json({ data: envois });
  } catch (error) {
    return jsonError(error);
  }
}
