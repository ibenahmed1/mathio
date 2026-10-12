import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { receptionnerUnite } from '@/lib/stock-reception';
import { servirColisEnAttente } from '@/lib/stock-reservation';

// Équivalent de /api/produits/[id]/reception mais au niveau d'une variante
// (couleur/taille…), pour les produits où variantesActivees est vrai.
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
      throw new ApiError(400, 'Marquez le produit comme « Reçu » avant de valider une quantité');
    }

    // Compteurs, historique, journal et envois servis dans la même
    // transaction (§ lib/stock-reception.ts).
    await prisma.$transaction((tx) =>
      receptionnerUnite(tx, { produitId: variante.produitId, varianteId: id, nom: variante.nom, quantite, utilisateurId: session.sub })
    );

    // Du stock vient d'entrer : les colis de plateforme qui l'attendaient
    // sont servis, dans leur ordre d'arrivée (§ lib/stock-reservation.ts).
    await servirColisEnAttente([variante.produitId], session.sub);

    const varianteMiseAJour = await prisma.produitVariante.findUnique({ where: { id } });
    return NextResponse.json(varianteMiseAJour);
  } catch (error) {
    return jsonError(error);
  }
}
