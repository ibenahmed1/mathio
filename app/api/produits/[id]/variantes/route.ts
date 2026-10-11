import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { parseVariante, skuDejaPris } from '@/lib/stock-sku';

// § Gestion de stock — nouvelle variante sur un produit existant (nouvelle
// couleur, nouvelle taille). Réservé aux produits qui suivent déjà leurs
// variantes : convertir un produit simple déplacerait son stock d'un niveau à
// l'autre, ce que rien ne permet de faire proprement. Même règles qu'à la
// création : SKU libre dans tout l'inventaire du marchand, quantité déclarée.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const { id } = await params;
    const marchand = await resolveMarchandForUser(session.sub);
    const produit = await prisma.produit.findUnique({ where: { id } });
    if (!produit || !marchand || produit.marchandId !== marchand.id) {
      throw new ApiError(404, 'Produit introuvable');
    }
    if (!produit.variantesActivees) {
      throw new ApiError(400, 'Ce produit ne suit pas de variantes : créez un nouveau produit');
    }

    const variante = parseVariante(await request.json(), 'Variante');
    const pris = await skuDejaPris(marchand.id, [variante.reference]);
    if (pris) throw new ApiError(409, `Référence déjà utilisée dans votre stock : ${pris}`);

    const creee = await prisma.$transaction(async (tx) => {
      const v = await tx.produitVariante.create({ data: { produitId: id, ...variante } });
      await tx.historiqueProduit.create({
        data: {
          produitId: id,
          texte: `${variante.nom} a été ajouté${variante.quantiteEnCours > 0 ? ` (${variante.quantiteEnCours} déclaré(s))` : ''}`,
          utilisateurId: session.sub,
        },
      });
      return v;
    });

    return NextResponse.json(creee, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
