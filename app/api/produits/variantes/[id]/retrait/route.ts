import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { notifierStockBas } from '@/lib/notifications';
import { stockReelUnite } from '@/lib/stock-colis';

// Équivalent de /api/produits/[id]/retrait mais au niveau d'une variante.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();
    const quantite = Math.trunc(Number(body.quantite));

    if (!Number.isFinite(quantite) || quantite <= 0) {
      throw new ApiError(400, 'quantite doit être un nombre positif');
    }

    const variante = await prisma.produitVariante.findUnique({ where: { id }, include: { produit: true } });
    if (!variante) throw new ApiError(404, 'Variante introuvable');
    if (variante.produit.statutReception !== 'recu') {
      throw new ApiError(400, 'Marquez le produit comme « Reçu » avant de retirer une quantité');
    }

    // Mouvement et trace dans la même transaction : un compteur modifié sans
    // sa ligne d'historique serait un écart que personne ne peut expliquer.
    const mouvement = await prisma.$transaction(async (tx) => {
      const resultat = await tx.produitVariante.updateMany({
        where: { id, quantiteRecue: { gte: quantite } },
        data: { quantiteRecue: { decrement: quantite } },
      });
      if (resultat.count === 0) {
        throw new ApiError(409, 'Quantité reçue insuffisante pour ce retrait');
      }

      await tx.historiqueProduit.create({
        data: {
          produitId: variante.produitId,
          texte: `${quantite}, ${variante.nom} a été retiré`,
          utilisateurId: session.sub,
        },
      });

      const apres = await stockReelUnite(tx, 'variante', id);
      return { unite: { type: 'variante' as const, id }, produitId: variante.produitId, avant: apres + quantite, apres };
    });

    // Sans `sauf` : l'alerte dit l'état du stock, pas l'action.
    await notifierStockBas([mouvement]);

    const varianteMiseAJour = await prisma.produitVariante.findUnique({ where: { id } });
    return NextResponse.json(varianteMiseAJour);
  } catch (error) {
    return jsonError(error);
  }
}
