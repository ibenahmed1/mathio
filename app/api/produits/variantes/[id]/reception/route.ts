import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Équivalent de /api/produits/[id]/reception mais au niveau d'une variante
// (couleur/taille…), pour les produits où variantesActivees est vrai.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();
    const quantite = Math.trunc(Number(body.quantite));

    if (!Number.isFinite(quantite) || quantite <= 0) {
      throw new ApiError(400, 'quantite doit être un nombre positif');
    }

    const variante = await prisma.produitVariante.findUnique({ where: { id }, include: { produit: true } });
    if (!variante) throw new ApiError(404, 'Variante introuvable');
    if (variante.produit.statutReception !== 'recu') {
      throw new ApiError(400, 'Marquez le produit comme « Reçu » avant de valider une quantité');
    }

    const resultat = await prisma.produitVariante.updateMany({
      where: { id, quantiteEnCours: { gte: quantite } },
      data: { quantiteEnCours: { decrement: quantite }, quantiteRecue: { increment: quantite } },
    });
    if (resultat.count === 0) {
      throw new ApiError(409, 'Quantité en cours insuffisante (a peut-être déjà été validée entre-temps)');
    }

    await prisma.historiqueProduit.create({
      data: { produitId: variante.produitId, texte: `${quantite}, ${variante.nom} a été reçu` },
    });

    const varianteMiseAJour = await prisma.produitVariante.findUnique({ where: { id } });
    return NextResponse.json(varianteMiseAJour);
  } catch (error) {
    return jsonError(error);
  }
}
