import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';

// § Gestion de stock — SKU d'un marchand.
//
// Un SKU désigne UNE unité de stock : soit un produit simple, soit une
// variante. Les deux vivent dans deux tables, mais pour le marchand (et pour
// son fichier d'import) ce sont les mêmes étiquettes : `SKU-NOIR-M` doit
// désigner une seule chose dans tout son inventaire. Les @@unique du schéma
// ne couvrent que chaque table séparément, et en respectant la casse — d'où
// cette vérification applicative, qui fait foi.

type Client = Pick<typeof prisma, 'produit' | 'produitVariante'>;

// Renvoie le premier SKU de `references` déjà utilisé chez ce marchand (produit
// ou variante, sans tenir compte de la casse), ou null s'ils sont tous libres.
export async function skuDejaPris(
  marchandId: string,
  references: string[],
  client: Client = prisma
): Promise<string | null> {
  const refs = references.map((r) => r.trim()).filter(Boolean);
  if (refs.length === 0) return null;
  const filtres = refs.map((r) => ({ reference: { equals: r, mode: 'insensitive' as const } }));

  const [produit, variante] = await Promise.all([
    client.produit.findFirst({ where: { marchandId, OR: filtres }, select: { reference: true } }),
    client.produitVariante.findFirst({ where: { produit: { marchandId }, OR: filtres }, select: { reference: true } }),
  ]);
  const pris = produit?.reference ?? variante?.reference ?? null;
  if (!pris) return null;
  return refs.find((r) => r.toLowerCase() === pris.toLowerCase()) ?? pris;
}

export interface SkuResolu {
  produit: { id: string; nom: string; reference: string; variantesActivees: boolean };
  variante: { id: string; nom: string; reference: string } | null;
}

// Résout un SKU saisi (formulaire, colonne Ref d'un import) vers l'unité de
// stock qu'il désigne, sans tenir compte de la casse. Une variante l'emporte :
// c'est l'unité la plus précise. Le SKU d'un produit à variantes est résolu
// vers le produit seul (variante null) — le colis garde sa photo, mais ne
// pourra pas passer en préparation tant qu'une variante n'est pas choisie.
export async function resoudreSku(marchandId: string, reference: string, client: Client = prisma): Promise<SkuResolu | null> {
  const ref = reference.trim();
  if (!ref) return null;
  const filtre = { equals: ref, mode: 'insensitive' as const };

  const variante = await client.produitVariante.findFirst({
    where: { reference: filtre, produit: { marchandId } },
    select: {
      id: true,
      nom: true,
      reference: true,
      produit: { select: { id: true, nom: true, reference: true, variantesActivees: true } },
    },
  });
  if (variante) {
    const { produit, ...reste } = variante;
    return { produit, variante: reste };
  }

  const produit = await client.produit.findFirst({
    where: { marchandId, reference: filtre },
    select: { id: true, nom: true, reference: true, variantesActivees: true },
  });
  return produit ? { produit, variante: null } : null;
}

// Libellé lisible d'une unité de stock, repris dans la description du colis.
export function libelleSku({ produit, variante }: SkuResolu): string {
  return variante ? `${produit.nom} — ${variante.nom} (${variante.reference})` : `${produit.nom} (${produit.reference})`;
}

// Saisie d'une variante (création du produit, ajout ultérieur) : nom, SKU et
// quantité déclarée. L'unicité du SKU se vérifie à part (skuDejaPris).
export type VarianteInput = { nom: string; reference: string; quantiteEnCours: number };

export function parseVariante(raw: unknown, libelle: string): VarianteInput {
  const v = (raw ?? {}) as { nom?: unknown; reference?: unknown; quantiteEnCours?: unknown };
  const nom = typeof v.nom === 'string' ? v.nom.trim() : '';
  const reference = typeof v.reference === 'string' ? v.reference.trim() : '';
  const quantiteEnCours = Number(v.quantiteEnCours);
  if (!nom) throw new ApiError(400, `${libelle} : nom requis`);
  if (!reference) throw new ApiError(400, `${libelle} : référence requise`);
  if (!Number.isFinite(quantiteEnCours) || quantiteEnCours < 0) {
    throw new ApiError(400, `${libelle} : quantité invalide`);
  }
  return { nom, reference, quantiteEnCours: Math.trunc(quantiteEnCours) };
}
