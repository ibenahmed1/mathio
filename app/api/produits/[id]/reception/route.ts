import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { receptionnerUnite } from '@/lib/stock-reception';
import { servirColisEnAttente } from '@/lib/stock-reservation';

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

    // Compteurs, historique, journal et envois servis dans la même
    // transaction (§ lib/stock-reception.ts).
    await prisma.$transaction((tx) =>
      receptionnerUnite(tx, { produitId: id, varianteId: null, nom: produit.nom, quantite, utilisateurId: session.sub })
    );

    // Du stock vient d'entrer : les colis de plateforme qui l'attendaient
    // sont servis, dans leur ordre d'arrivée (§ lib/stock-reservation.ts).
    await servirColisEnAttente([id], session.sub);

    const produitMisAJour = await prisma.produit.findUnique({ where: { id }, include: { variantes: true } });
    return NextResponse.json(produitMisAJour);
  } catch (error) {
    return jsonError(error);
  }
}
