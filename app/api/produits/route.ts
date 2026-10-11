import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { parseVariante, skuDejaPris, type VarianteInput } from '@/lib/stock-sku';

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
// marchand ne voit que son propre inventaire. Un admin peut consulter celui
// d'un marchand précis via ?marchandId=, ou la file de validation réception
// tous marchands confondus si ce paramètre est omis (voir page admin
// /admin/stock/inventaire).
export async function GET(request: Request) {
  try {
    const session = await requireUser(['marchand', 'admin']);

    let where: { marchandId: string } | undefined;
    if (session.role === 'admin') {
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
        ...(session.role === 'admin' ? { marchand: { select: { nomBoutique: true } } } : {}),
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

    const produit = await prisma.produit.create({
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

    return NextResponse.json(produit, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
