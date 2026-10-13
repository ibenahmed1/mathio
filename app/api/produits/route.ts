import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { parseVariante, skuDejaPris, type VarianteInput } from '@/lib/stock-sku';
import { journaliserMouvements } from '@/lib/stock-mouvements';

async function getOwnMarchand(utilisateurId: string) {
  const marchand = await resolveMarchandForUser(utilisateurId);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return marchand;
}

// `referenceProduit` entre dans le même espace de noms : une variante ne peut
// pas porter le SKU de son propre produit (lib/stock-sku.ts).
function parseVariantes(body: unknown, referenceProduit: string): VarianteInput[] {
  if (!Array.isArray(body)) return [];
  const vues = new Set<string>([referenceProduit.toLowerCase()]);
  return body.map((raw, index) => {
    const variante = parseVariante(raw, `Variante #${index + 1}`);
    const cle = variante.reference.toLowerCase();
    if (vues.has(cle)) throw new ApiError(400, `Référence dupliquée : ${variante.reference}`);
    vues.add(cle);
    return variante;
  });
}

// Catalogue "produit" (gestion inventaire) : distinct de Marchandise. Un
// marchand ne voit que son propre inventaire. Le back-office (admin, ou un
// compte détenant `stock:inventory`, ex. l'agent stock) peut consulter celui
// d'un marchand précis via ?marchandId=, ou la file de validation réception
// tous marchands confondus si ce paramètre est omis (voir page admin
// /admin/stock/inventaire).
export async function GET(request: Request) {
  try {
    const session = await requireUser(['marchand', 'admin']);

    let where: { marchandId: string } | undefined;
    if (session.role !== 'marchand') {
      const { searchParams } = new URL(request.url);
      const requested = searchParams.get('marchandId');
      where = requested ? { marchandId: requested } : undefined;
    } else {
      const marchand = await getOwnMarchand(session.sub);
      where = { marchandId: marchand.id };
    }

    const produits = await prisma.produit.findMany({
      where,
      include: {
        variantes: true,
        // Un produit du stock commun d'une plateforme n'a pas de marchand :
        // l'admin voit à qui il appartient (§ stock commun, 12/10/2026).
        ...(session.role !== 'marchand'
          ? { marchand: { select: { nomBoutique: true } }, plateforme: { select: { nom: true } } }
          : {}),
      },
      orderBy: { dateCreation: 'desc' },
    });
    return NextResponse.json({ data: produits });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await getOwnMarchand(session.sub);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const photoUrl = typeof body.photoUrl === 'string' && body.photoUrl ? body.photoUrl : null;
    const variantesActivees = Boolean(body.variantesActivees);
    const variantes = variantesActivees ? parseVariantes(body.variantes, reference) : [];

    if (!nom) {
      throw new ApiError(400, 'nom est requis');
    }
    if (!reference) {
      throw new ApiError(400, 'référence est requise');
    }
    if (variantesActivees && variantes.length === 0) {
      throw new ApiError(400, 'ajoutez au moins une variante ou désactivez les variantes');
    }

    // Produit à variantes : le stock vit sur les variantes, les compteurs du
    // produit restent à 0 (lib/stock-quantites.ts).
    const quantiteEnCours = variantesActivees ? 0 : Math.trunc(Number(body.quantiteEnCours));
    if (!variantesActivees && (!Number.isFinite(quantiteEnCours) || quantiteEnCours < 0)) {
      throw new ApiError(400, 'quantité doit être un nombre positif ou nul');
    }

    const pris = await skuDejaPris(marchand.id, [reference, ...variantes.map((v) => v.reference)]);
    if (pris) {
      throw new ApiError(409, `Référence déjà utilisée dans votre stock : ${pris}`);
    }

    const produit = await prisma.$transaction(async (tx) => {
    const cree = await tx.produit.create({
      data: {
        marchandId: marchand.id,
        nom,
        reference,
        quantiteEnCours,
        note,
        photoUrl,
        variantesActivees,
        variantes: { create: variantes },
        historique: {
          create: [
            { texte: `${nom} a été ajouté` },
            ...variantes.map((v) => ({ texte: `${v.nom} a été ajouté` })),
          ],
        },
      },
      include: { variantes: true },
    });
    // La quantité saisie est de l'ANNONCÉ : elle ne devient du stock qu'à la
    // réception en entrepôt.
    await journaliserMouvements(tx, [
      { type: 'annonce', produitId: cree.id, quantite: cree.quantiteEnCours, utilisateurId: session.sub },
      ...cree.variantes.map((v) => ({
        type: 'annonce' as const,
        produitId: cree.id,
        varianteId: v.id,
        quantite: v.quantiteEnCours,
        utilisateurId: session.sub,
      })),
    ]);
    return cree;
    });

    return NextResponse.json(produit, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
