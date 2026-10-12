import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import type { EnvironnementApi, ProvenanceStock } from '@/app/generated/prisma/enums';

// § Gestion de stock — SKU d'un marchand (et du stock commun d'une plateforme).
//
// Un SKU désigne UNE unité de stock : soit un produit simple, soit une
// variante. Les deux vivent dans deux tables, mais pour le marchand (et pour
// son fichier d'import) ce sont les mêmes étiquettes : `SKU-NOIR-M` doit
// désigner une seule chose dans tout son inventaire. Les @@unique du schéma
// ne couvrent que chaque table séparément, et en respectant la casse — d'où
// cette vérification applicative, qui fait foi.

type Client = Pick<typeof prisma, 'produit' | 'produitVariante' | 'compteMarchandExterne'>;

// § Stock commun d'une plateforme (12/10/2026) : un produit appartient soit à
// un marchand, soit à une plateforme dans un environnement. Un « propriétaire »
// est l'un ou l'autre ; les recherches de SKU portent sur une LISTE de
// propriétaires, pour couvrir l'univers d'une plateforme d'un seul coup.
export type ProprietaireStock =
  | { marchandId: string }
  | { plateformeId: string; environnementPlateforme: EnvironnementApi };

// Stocks communs auxquels un marchand a accès : ceux des plateformes qui l'ont
// synchronisé, chacune dans l'environnement du lien.
async function stocksCommunsDuMarchand(marchandId: string, client: Client): Promise<ProprietaireStock[]> {
  const liens = await client.compteMarchandExterne.findMany({
    where: { marchandId },
    select: { plateformeId: true, environnement: true },
  });
  return liens.map((l) => ({ plateformeId: l.plateformeId, environnementPlateforme: l.environnement }));
}

// Premier SKU de `references` déjà porté par l'un des `proprietaires`
// (produit ou variante, sans tenir compte de la casse), ou null.
async function skuPrisChez(
  proprietaires: ProprietaireStock[],
  references: string[],
  client: Client
): Promise<string | null> {
  const refs = references.map((r) => r.trim()).filter(Boolean);
  if (refs.length === 0 || proprietaires.length === 0) return null;
  const filtres = refs.map((r) => ({ reference: { equals: r, mode: 'insensitive' as const } }));

  const [produit, variante] = await Promise.all([
    client.produit.findFirst({ where: { AND: [{ OR: proprietaires }, { OR: filtres }] }, select: { reference: true } }),
    client.produitVariante.findFirst({
      where: { AND: [{ produit: { OR: proprietaires } }, { OR: filtres }] },
      select: { reference: true },
    }),
  ]);
  const pris = produit?.reference ?? variante?.reference ?? null;
  if (!pris) return null;
  return refs.find((r) => r.toLowerCase() === pris.toLowerCase()) ?? pris;
}

// Renvoie le premier SKU de `references` déjà utilisé chez ce marchand — ou
// dans le stock commun d'une plateforme qui l'a synchronisé : un SKU est
// unique dans tout l'univers d'une plateforme (décision du 12/10/2026), sans
// quoi un colis ne saurait pas quelle étagère désigne son SKU.
export async function skuDejaPris(
  marchandId: string,
  references: string[],
  client: Client = prisma
): Promise<string | null> {
  const proprietaires: ProprietaireStock[] = [{ marchandId }, ...(await stocksCommunsDuMarchand(marchandId, client))];
  return skuPrisChez(proprietaires, references, client);
}

// Même contrôle pour un produit COMMUN d'une plateforme : son stock commun et
// le stock personnel de chacun de ses marchands dans cet environnement.
export async function skuDejaPrisPlateforme(
  plateformeId: string,
  environnement: EnvironnementApi,
  references: string[],
  client: Client = prisma
): Promise<string | null> {
  const liens = await client.compteMarchandExterne.findMany({
    where: { plateformeId, environnement },
    select: { marchandId: true },
  });
  const proprietaires: ProprietaireStock[] = [
    { plateformeId, environnementPlateforme: environnement },
    ...liens.map((l) => ({ marchandId: l.marchandId })),
  ];
  return skuPrisChez(proprietaires, references, client);
}

export interface SkuResolu {
  produit: { id: string; nom: string; reference: string; variantesActivees: boolean };
  variante: { id: string; nom: string; reference: string } | null;
}

async function resoudreSkuChez(
  proprietaire: ProprietaireStock,
  reference: string,
  client: Client
): Promise<SkuResolu | null> {
  const ref = reference.trim();
  if (!ref) return null;
  const filtre = { equals: ref, mode: 'insensitive' as const };

  const variante = await client.produitVariante.findFirst({
    where: { reference: filtre, produit: proprietaire },
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
    where: { ...proprietaire, reference: filtre },
    select: { id: true, nom: true, reference: true, variantesActivees: true },
  });
  return produit ? { produit, variante: null } : null;
}

// Résout un SKU saisi (formulaire, colonne Ref d'un import) vers l'unité de
// stock qu'il désigne dans le stock PERSONNEL du marchand, sans tenir compte
// de la casse. Une variante l'emporte : c'est l'unité la plus précise. Le SKU
// d'un produit à variantes est résolu vers le produit seul (variante null) —
// le colis garde sa photo, mais ne pourra pas passer en préparation tant
// qu'une variante n'est pas choisie.
export async function resoudreSku(marchandId: string, reference: string, client: Client = prisma): Promise<SkuResolu | null> {
  return resoudreSkuChez({ marchandId }, reference, client);
}

// Pour un colis de plateforme : le stock personnel du vendeur d'abord, puis le
// stock commun de la plateforme dans l'environnement de la clé. Les SKU étant
// uniques dans cet univers, au plus l'un des deux répond.
export async function resoudreSkuPourVendeur(
  marchandId: string,
  plateformeId: string,
  environnement: EnvironnementApi,
  reference: string,
  client: Client = prisma
): Promise<(SkuResolu & { provenance: ProvenanceStock }) | null> {
  const personnel = await resoudreSkuChez({ marchandId }, reference, client);
  if (personnel) return { ...personnel, provenance: 'stock_marchand' };
  const commun = await resoudreSkuChez({ plateformeId, environnementPlateforme: environnement }, reference, client);
  return commun ? { ...commun, provenance: 'stock_plateforme' } : null;
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
