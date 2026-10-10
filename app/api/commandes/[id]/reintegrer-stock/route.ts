import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { reintegrerStockColis } from '@/lib/stock-colis';
import { colisReintegrable, STATUTS_REINTEGRATION_STOCK } from '@/lib/stock-quantites';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';

// § Gestion de stock — réintégration du stock d'un colis non livré.
//
// Le stock d'un colis "stock" est réservé à son passage en préparation. S'il
// n'est finalement pas livré (annulé, refusé, retourné…), la marchandise doit
// revenir sur l'étagère — mais seulement quand elle y est physiquement de
// retour. Aucun changement de statut ne peut le savoir : d'où une action
// explicite de l'agent, tracée à son nom dans l'historique du produit et dans
// les commentaires du colis, et jamais rejouable (stockReintegreLe).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const motif = typeof body?.motif === 'string' && body.motif.trim() ? body.motif.trim() : null;

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande) throw new ApiError(404, 'Commande introuvable');

    if (!colisReintegrable(commande)) {
      if (!commande.enStock) throw new ApiError(400, 'Ce colis ne sort pas du stock entrepôt');
      if (!commande.stockReserveLe) throw new ApiError(400, 'Le stock de ce colis n’a jamais été réservé : rien à réintégrer');
      if (commande.stockReintegreLe) throw new ApiError(409, 'Le stock de ce colis a déjà été réintégré');
      const autorises = STATUTS_REINTEGRATION_STOCK.map((s) => LABELS_STATUT_COMMANDE[s]).join(', ');
      throw new ApiError(400, `Réintégration possible seulement pour un colis non livré (${autorises})`);
    }

    await prisma.$transaction(async (tx) => {
      await reintegrerStockColis(tx, id, session.sub, motif);
      await tx.commentaireCommande.create({
        data: {
          commandeId: id,
          utilisateurId: session.sub,
          texte: `Stock réintégré : ${commande.quantite} unité(s) remise(s) en entrepôt${motif ? ` — ${motif}` : ''}.`,
        },
      });
    });

    const misAJour = await prisma.commande.findUnique({ where: { id } });
    return NextResponse.json(misAJour);
  } catch (error) {
    return jsonError(error);
  }
}
