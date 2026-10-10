import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { reserverStockColis } from '@/lib/stock-colis';
import { notifierStockBas } from '@/lib/notifications';

// § Gestion de stock (/admin/stock/nouveaux) : fait avancer des colis stock
// (enStock=true) tout juste arrivés au Hub depuis "nouveau_colis" vers
// "pret_pour_preparation" — ces colis ne passant pas par le Bon de Livraison
// marchand classique (cf. commentaire Commande.enStock), c'est cette action
// admin qui joue le rôle de "prise en charge" pour le pipeline stock, avant
// leur regroupement en Bon de Préparation (/admin/stock/prets).
//
// C'est également ici que le stock réel est réservé (décision produit du
// 2026-08-10) : sur la variante quand le produit suit ses variantes, sur le
// produit sinon, pour chaque ligne du colis (lib/stock-colis.ts). Tout-ou-rien : un colis sans produit
// (ou sans variante) rattaché, ou un stock insuffisant, et rien n'est
// décrémenté ni fait avancer — un colis "stock" ne quitte jamais l'entrepôt
// sans avoir été compté.
export async function POST(request: NextRequest) {
  try {
    const session = await requireUser(['admin']);
    const body = await request.json();

    const ids = parseStringIdArray(body.colisIds);
    if (ids.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    const colis = await prisma.commande.findMany({
      where: { id: { in: ids }, enStock: true, statut: 'nouveau_colis' },
      // Le contenu (lignes) est relu par reserverStockColis dans la transaction.
      select: { id: true },
    });
    if (colis.length !== ids.length) {
      throw new ApiError(400, "Un ou plusieurs colis sélectionnés ne sont plus éligibles (déjà pris en charge ou hors stock)");
    }

    const mouvements = await prisma.$transaction(async (tx) => {
      // Garde check-then-act : le statut est re-vérifié dans l'écriture même.
      // Si un autre agent a fait avancer l'un de ces colis entre la lecture et
      // ici, on annule tout plutôt que de réserver son stock une seconde fois.
      const avances = await tx.commande.updateMany({
        where: { id: { in: ids }, enStock: true, statut: 'nouveau_colis' },
        data: { statut: 'pret_pour_preparation' },
      });
      if (avances.count !== ids.length) {
        throw new ApiError(409, 'Un ou plusieurs colis viennent d’être pris en charge par quelqu’un d’autre — rechargez la liste');
      }

      const sortis = await reserverStockColis(tx, colis, session.sub);

      await tx.historiqueStatutCommande.createMany({
        data: colis.map((c) => ({
          commandeId: c.id,
          ancienStatut: 'nouveau_colis' as const,
          nouveauStatut: 'pret_pour_preparation' as const,
          utilisateurId: session.sub,
        })),
      });
      return sortis;
    });

    // Sans `sauf` : l'alerte dit l'état du stock, pas l'action — l'agent qui
    // vient de vider l'étagère doit la recevoir aussi.
    await notifierStockBas(mouvements);
    return NextResponse.json({ updated: colis.length });
  } catch (error) {
    return jsonError(error);
  }
}
