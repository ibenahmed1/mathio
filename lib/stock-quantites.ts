// § Gestion de stock — quantités d'un produit.
//
// Module volontairement PUR et sans import : il est consommé à la fois par les
// routes API (objets Prisma) et par l'écran d'inventaire, qui est un composant
// client. Y importer prisma ou next/* casserait le second.
//
// Il n'existe que pour une raison : la même règle métier était écrite deux
// fois — une fois côté serveur, une fois côté écran. Deux copies d'une règle
// finissent toujours par diverger, et ici la divergence est invisible :
// l'écran proposerait une action que l'API refuse, ou pire, confirmerait un
// mouvement que l'API applique différemment.

// Forme minimale commune au payload Prisma (`variantes` toujours présent) et
// au type front `Produit` (`variantes` optionnel). Structurelle à dessein :
// les deux la satisfont sans conversion.
export interface ProduitQuantites {
  variantesActivees: boolean;
  quantiteRecue: number;
  quantiteEnCours: number;
  variantes?: { quantiteRecue: number; quantiteEnCours: number }[] | null;
}

// Quantité physiquement validée en entrepôt.
//
// Le piège : sur un produit qui suit ses variantes individuellement, les
// compteurs du produit lui-même restent à 0 — tout vit sur les variantes. Lire
// `produit.quantiteRecue` sans regarder `variantesActivees` renvoie donc 0 sur
// exactement les produits où le chiffre compte le plus.
export function quantiteRecueTotale(produit: ProduitQuantites): number {
  return produit.variantesActivees
    ? (produit.variantes ?? []).reduce((somme, v) => somme + v.quantiteRecue, 0)
    : produit.quantiteRecue;
}

// Reliquat de réception : ce que le marchand a déclaré et que l'entrepôt n'a
// jamais validé. Même piège produit/variantes que ci-dessus.
export function reliquatReception(produit: ProduitQuantites): number {
  return produit.variantesActivees
    ? (produit.variantes ?? []).reduce((somme, v) => somme + v.quantiteEnCours, 0)
    : produit.quantiteEnCours;
}

// ─── Mouvements de stock d'un colis ────────────────────────────────────────
//
// Même raison d'être que ci-dessus : l'écran n'affiche l'action « Réintégrer
// au stock » que là où l'API l'accepte (lib/stock-colis.ts).

// Statuts d'un colis non livré dont la marchandise peut revenir sur l'étagère.
// La réintégration n'est jamais automatique : c'est l'agent qui constate le
// retour physique, comme pour la réception d'un produit.
export const STATUTS_REINTEGRATION_STOCK = [
  'annule',
  'annule_par_vendeur',
  'refuse',
  'retourne',
  'retourne_au_hub',
] as const;

export interface ColisStock {
  enStock: boolean;
  statut: string;
  stockReserveLe: Date | string | null;
  stockReintegreLe: Date | string | null;
}

export function colisReintegrable(colis: ColisStock): boolean {
  return (
    colis.enStock &&
    colis.stockReserveLe != null &&
    colis.stockReintegreLe == null &&
    (STATUTS_REINTEGRATION_STOCK as readonly string[]).includes(colis.statut)
  );
}

// Tant que le stock d'un colis est réservé (et pas encore réintégré), ce qui
// détermine la quantité réservée — produit, variante, quantité, enStock — ne
// peut plus changer : l'écart ne serait rendu nulle part.
export function stockColisVerrouille(colis: Pick<ColisStock, 'stockReserveLe' | 'stockReintegreLe'>): boolean {
  return colis.stockReserveLe != null && colis.stockReintegreLe == null;
}

export interface ColisBesoin {
  id: string;
  codeSuivi: string;
  quantite: number;
  produitId: string | null;
  varianteId: string | null;
  produit: { nom: string; variantesActivees: boolean } | null;
}

export type UniteStock = { type: 'produit' | 'variante'; id: string };

// Regroupe les quantités demandées par unité de stock (produit simple ou
// variante). Un colis sans unité exploitable n'est pas ignoré : il est
// renvoyé en anomalie, pour que rien ne sorte de l'entrepôt sans être compté.
export function regrouperBesoinsStock(colis: ColisBesoin[]): {
  besoins: Map<string, { unite: UniteStock; quantite: number; produitId: string; codes: string[] }>;
  anomalies: string[];
} {
  const besoins = new Map<string, { unite: UniteStock; quantite: number; produitId: string; codes: string[] }>();
  const anomalies: string[] = [];
  for (const c of colis) {
    if (!c.produitId || !c.produit) {
      anomalies.push(`${c.codeSuivi} : aucun produit du stock rattaché`);
      continue;
    }
    if (c.produit.variantesActivees && !c.varianteId) {
      anomalies.push(`${c.codeSuivi} : choisissez la variante de « ${c.produit.nom} »`);
      continue;
    }
    const unite: UniteStock = c.produit.variantesActivees
      ? { type: 'variante', id: c.varianteId! }
      : { type: 'produit', id: c.produitId };
    const cle = `${unite.type}:${unite.id}`;
    const besoin = besoins.get(cle) ?? { unite, quantite: 0, produitId: c.produitId, codes: [] };
    besoin.quantite += c.quantite;
    besoin.codes.push(c.codeSuivi);
    besoins.set(cle, besoin);
  }
  return { besoins, anomalies };
}
