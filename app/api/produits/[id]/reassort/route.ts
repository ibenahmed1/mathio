import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

// § Gestion de stock — réassort déclaré par le marchand.
//
// Un nouvel envoi de marchandise vers l'entrepôt pour un produit qui existe
// déjà : la quantité s'ajoute à "en cours" (déclaré, pas encore vérifié),
// exactement comme à la création. L'entrepôt la fait ensuite passer en
// "reçu" par les routes de réception habituelles — un réassort ne touche
// jamais au stock réel. `varianteId` est exigé sur un produit à variantes,
// interdit sinon : le stock ne vit qu'à un seul de ces deux niveaux.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const { id } = await params;
    const marchand = await resolveMarchandForUser(session.sub);
    const produit = await prisma.produit.findUnique({ where: { id }, include: { variantes: true } });
    if (!produit || !marchand || produit.marchandId !== marchand.id) {
      throw new ApiError(404, 'Produit introuvable');
    }

    const body = await request.json();
    const quantite = Math.trunc(Number(body.quantite));
    if (!Number.isFinite(quantite) || quantite <= 0) {
      throw new ApiError(400, 'quantite doit être un nombre positif');
    }

    const varianteId = typeof body.varianteId === 'string' && body.varianteId ? body.varianteId : null;
    let libelle = produit.nom;

    await prisma.$transaction(async (tx) => {
      if (produit.variantesActivees) {
        const variante = produit.variantes.find((v) => v.id === varianteId);
        if (!variante) throw new ApiError(400, 'Choisissez la variante réassortie');
        libelle = `${produit.nom} — ${variante.nom}`;
        await tx.produitVariante.update({ where: { id: variante.id }, data: { quantiteEnCours: { increment: quantite } } });
      } else {
        if (varianteId) throw new ApiError(400, 'Ce produit ne suit pas de variantes');
        await tx.produit.update({ where: { id }, data: { quantiteEnCours: { increment: quantite } } });
      }
      await tx.historiqueProduit.create({
        data: { produitId: id, texte: `${quantite}, ${libelle} déclaré(s) — réassort`, utilisateurId: session.sub },
      });
    });

    const produitMisAJour = await prisma.produit.findUnique({ where: { id }, include: { variantes: true } });
    return NextResponse.json(produitMisAJour);
  } catch (error) {
    return jsonError(error);
  }
}
