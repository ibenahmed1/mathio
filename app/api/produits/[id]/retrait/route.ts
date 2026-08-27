import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Retrait de stock par l'admin : décrémente la quantité "reçue" (ex. sortie
// d'entrepôt, correction, casse) — indépendant de toute commande précise.
// Réservé aux produits sans variantes (voir /api/produits/variantes/[id]/retrait
// pour le suivi par variante).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();
    const quantite = Math.trunc(Number(body.quantite));

    if (!Number.isFinite(quantite) || quantite <= 0) {
      throw new ApiError(400, 'quantite doit être un nombre positif');
    }

    const produit = await prisma.produit.findUnique({ where: { id } });
    if (!produit) throw new ApiError(404, 'Produit introuvable');
    if (produit.variantesActivees) {
      throw new ApiError(400, 'Ce produit suit ses variantes individuellement — retirez sur chaque variante');
    }
    if (produit.statutReception !== 'recu') {
      throw new ApiError(400, 'Marquez le produit comme « Reçu » avant de retirer une quantité');
    }

    const resultat = await prisma.produit.updateMany({
      where: { id, quantiteRecue: { gte: quantite } },
      data: { quantiteRecue: { decrement: quantite } },
    });
    if (resultat.count === 0) {
      throw new ApiError(409, 'Quantité reçue insuffisante pour ce retrait');
    }

    await prisma.historiqueProduit.create({
      data: { produitId: id, texte: `${quantite}, ${produit.nom} a été retiré`, utilisateurId: session.sub },
    });

    const produitMisAJour = await prisma.produit.findUnique({ where: { id }, include: { variantes: true } });
    return NextResponse.json(produitMisAJour);
  } catch (error) {
    return jsonError(error);
  }
}
