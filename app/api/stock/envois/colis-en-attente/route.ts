import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { STATUTS_TERMINAUX } from '@/lib/statuts';

// Colis de plateforme acceptés « en attente de stock » (§ lib/stock-
// reservation.ts) : mêmes critères que ceux que la réception servira, dans le
// même ordre. Chaque ligne porte le stock disponible de son unité, pour que
// l'entrepôt voie ce qui manque.
export async function GET() {
  try {
    await requireUser(['admin']);
    const colis = await prisma.commande.findMany({
      where: { enAttenteStock: true, stockReserveLe: null, statut: { notIn: STATUTS_TERMINAUX } },
      orderBy: { dateCreation: 'asc' },
      take: 500,
      select: {
        id: true,
        codeSuivi: true,
        codeSuiviPartenaire: true,
        dateCreation: true,
        marchand: { select: { nomBoutique: true } },
        lignes: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            sku: true,
            libelle: true,
            quantite: true,
            provenance: true,
            produit: { select: { quantiteRecue: true } },
            variante: { select: { quantiteRecue: true } },
          },
        },
      },
    });

    return NextResponse.json({
      data: colis.map(({ lignes, ...c }) => ({
        ...c,
        lignes: lignes.map(({ produit, variante, ...l }) => ({
          ...l,
          disponible: variante?.quantiteRecue ?? produit?.quantiteRecue ?? null,
        })),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
