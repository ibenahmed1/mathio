import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';

// § Gestion de stock (/admin/stock/nouveaux) : fait avancer des colis stock
// (enStock=true) tout juste arrivés au Hub depuis "nouveau_colis" vers
// "pret_pour_preparation" — ces colis ne passant pas par le Bon de Livraison
// marchand classique (cf. commentaire Commande.enStock), c'est cette action
// admin qui joue le rôle de "prise en charge" pour le pipeline stock, avant
// leur regroupement en Bon de Préparation (/admin/stock/prets).
//
// C'est également ici que le stock réel (Produit.quantiteRecue) est
// décrémenté (décision produit du 2026-08-10) : dès que l'admin marque ces
// colis "prêts pour la préparation", la quantité est réservée, avant même
// leur regroupement en Bon de Préparation. Tout-ou-rien : si le stock réel
// d'un produit est insuffisant pour couvrir la somme des quantités demandées
// par cette sélection, rien n'est décrémenté ni fait avancer.
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
    });
    if (colis.length !== ids.length) {
      throw new ApiError(400, "Un ou plusieurs colis sélectionnés ne sont plus éligibles (déjà pris en charge ou hors stock)");
    }

    // Un même produit peut être demandé par plusieurs colis de la sélection —
    // on décrémente la somme en une seule opération atomique par produit
    // plutôt que colis par colis.
    const besoinsParProduit = new Map<string, number>();
    for (const c of colis) {
      if (!c.produitId) continue;
      besoinsParProduit.set(c.produitId, (besoinsParProduit.get(c.produitId) ?? 0) + c.quantite);
    }

    await prisma.$transaction(async (tx) => {
      for (const [produitId, quantiteNecessaire] of besoinsParProduit) {
        const resultat = await tx.produit.updateMany({
          where: { id: produitId, quantiteRecue: { gte: quantiteNecessaire } },
          data: { quantiteRecue: { decrement: quantiteNecessaire } },
        });
        if (resultat.count === 0) {
          const produit = await tx.produit.findUnique({ where: { id: produitId } });
          throw new ApiError(409, `Stock réel insuffisant pour « ${produit?.nom ?? produitId} » (besoin : ${quantiteNecessaire})`);
        }
      }

      if (besoinsParProduit.size > 0) {
        await tx.historiqueProduit.createMany({
          data: Array.from(besoinsParProduit.entries()).map(([produitId, quantite]) => ({
            produitId,
            texte: `${quantite} retiré(s) — passage en préparation`,
            utilisateurId: session.sub,
          })),
        });
      }

      await tx.commande.updateMany({
        where: { id: { in: ids } },
        data: { statut: 'pret_pour_preparation' },
      });
      await tx.historiqueStatutCommande.createMany({
        data: colis.map((c) => ({
          commandeId: c.id,
          ancienStatut: 'nouveau_colis' as const,
          nouveauStatut: 'pret_pour_preparation' as const,
          utilisateurId: session.sub,
        })),
      });
    });

    return NextResponse.json({ updated: colis.length });
  } catch (error) {
    return jsonError(error);
  }
}
