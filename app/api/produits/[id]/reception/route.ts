import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Validation de réception par l'admin : déplace tout ou partie de la
// quantité "en cours" (saisie par le marchand) vers "reçue" (vérifiée
// physiquement). Réservé aux produits sans variantes — quand
// variantesActivees est vrai, le suivi se fait par variante (voir
// /api/produits/variantes/[id]/reception).
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
      throw new ApiError(400, 'Ce produit suit ses variantes individuellement — validez chaque variante');
    }
    if (produit.statutReception !== 'recu') {
      throw new ApiError(400, 'Marquez le produit comme « Reçu » avant de valider une quantité');
    }

    const resultat = await prisma.produit.updateMany({
      where: { id, quantiteEnCours: { gte: quantite } },
      data: { quantiteEnCours: { decrement: quantite }, quantiteRecue: { increment: quantite } },
    });
    if (resultat.count === 0) {
      throw new ApiError(409, 'Quantité en cours insuffisante (a peut-être déjà été validée entre-temps)');
    }

    await prisma.historiqueProduit.create({
      data: { produitId: id, texte: `${quantite}, ${produit.nom} a été reçu`, utilisateurId: session.sub },
    });

    const produitMisAJour = await prisma.produit.findUnique({ where: { id }, include: { variantes: true } });
    return NextResponse.json(produitMisAJour);
  } catch (error) {
    return jsonError(error);
  }
}
