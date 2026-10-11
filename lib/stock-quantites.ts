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

// ─── Stock bas ──────────────────────────────────────────────────────────────
//
// Une unité de stock (produit simple, ou chaque variante) est « bas » quand
// son stock réel validé tombe à SEUIL_STOCK_BAS ou en dessous : c'est le
// moment de demander au marchand (ou à sa plateforme) de réapprovisionner.
// Seuil unique décidé par l'exploitation le 10/10/2026.
export const SEUIL_STOCK_BAS = 10;

export function estStockBas(quantiteRecue: number): boolean {
  return quantiteRecue <= SEUIL_STOCK_BAS;
}

// L'alerte part au FRANCHISSEMENT du seuil, pas à chaque mouvement sous le
// seuil : 15 → 8 alerte, 8 → 6 n'alerte plus. Un réassort qui repasse
// au-dessus réarme l'alerte pour la fois suivante.
export function franchitSeuilStockBas(avant: number, apres: number): boolean {
  return avant > SEUIL_STOCK_BAS && apres <= SEUIL_STOCK_BAS;
}

// Les unités d'un produit à signaler dans l'inventaire. Un produit que
// l'entrepôt n'a pas encore reçu n'a pas de stock « bas » : il n'en a pas
// encore — le signaler noierait les vraies alertes sous les produits en
// attente de livraison (dont ceux créés à 0 par une plateforme).
export function unitesStockBas(produit: {
  statutReception: string;
  variantesActivees: boolean;
  quantiteRecue: number;
  variantes?: { nom: string; quantiteRecue: number }[] | null;
}): { nom: string | null; quantiteRecue: number }[] {
  if (produit.statutReception !== 'recu') return [];
  if (produit.variantesActivees) {
    return (produit.variantes ?? [])
      .filter((v) => estStockBas(v.quantiteRecue))
      .map((v) => ({ nom: v.nom, quantiteRecue: v.quantiteRecue }));
  }
  return estStockBas(produit.quantiteRecue) ? [{ nom: null, quantiteRecue: produit.quantiteRecue }] : [];
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

// Une ligne du contenu d'un colis, vue du stock (cf. LigneColis).
export interface LigneBesoin {
  libelle: string;
  quantite: number;
  produitId: string | null;
  varianteId: string | null;
  produit: { nom: string; variantesActivees: boolean } | null;
}

export interface ColisBesoin {
  id: string;
  codeSuivi: string;
  lignes: LigneBesoin[];
}

// Forme d'un colis telle que la lit la base pendant la transition vers le
// multi-produits : ses lignes, et l'ancien produit unique porté par le colis.
export interface ColisAvecLignes {
  quantite: number;
  produitId: string | null;
  varianteId: string | null;
  produit: { nom: string; variantesActivees: boolean } | null;
  lignes: LigneBesoin[];
}

// Les lignes qui font foi pour le stock. REPLI TRANSITOIRE : un colis écrit
// par un chemin qui ne connaît pas encore les lignes (formulaire, import…)
// n'a que l'ancien produit unique — on en fait une ligne, plutôt que de le
// déclarer sans contenu. À supprimer avec les colonnes produit_id /
// variante_id de `commandes`.
export function lignesEffectives(colis: ColisAvecLignes): LigneBesoin[] {
  if (colis.lignes.length > 0) return colis.lignes;
  if (!colis.produitId) return [];
  return [
    {
      libelle: colis.produit?.nom ?? 'Produit',
      quantite: colis.quantite,
      produitId: colis.produitId,
      varianteId: colis.varianteId,
      produit: colis.produit,
    },
  ];
}

export type UniteStock = { type: 'produit' | 'variante'; id: string };

// Un mouvement de stock SORTANT tel qu'il vient d'être écrit, avant/après lus
// dans la même transaction : de quoi décider d'une alerte de stock bas sans
// relire la base après coup (où un autre mouvement aurait pu passer).
export interface MouvementStockSortant {
  unite: UniteStock;
  produitId: string;
  avant: number;
  apres: number;
}

// Regroupe les quantités demandées par unité de stock (produit simple ou
// variante), toutes lignes de tous les colis confondues : deux colis — ou
// deux lignes d'un même colis — qui puisent dans la même unité s'additionnent.
// Rien n'est ignoré : un colis sans contenu, ou une ligne qui ne désigne pas
// une unité de stock exploitable, est renvoyé en anomalie, pour que rien ne
// sorte de l'entrepôt sans être compté.
export function regrouperBesoinsStock(colis: ColisBesoin[]): {
  besoins: Map<string, { unite: UniteStock; quantite: number; produitId: string; codes: string[] }>;
  anomalies: string[];
} {
  const besoins = new Map<string, { unite: UniteStock; quantite: number; produitId: string; codes: string[] }>();
  const anomalies: string[] = [];
  for (const c of colis) {
    if (c.lignes.length === 0) {
      anomalies.push(`${c.codeSuivi} : aucun produit du stock rattaché`);
      continue;
    }
    for (const ligne of c.lignes) {
      if (!ligne.produitId || !ligne.produit) {
        anomalies.push(`${c.codeSuivi} : « ${ligne.libelle} » n’est pas un produit du stock`);
        continue;
      }
      if (ligne.produit.variantesActivees && !ligne.varianteId) {
        anomalies.push(`${c.codeSuivi} : choisissez la variante de « ${ligne.produit.nom} »`);
        continue;
      }
      const unite: UniteStock = ligne.produit.variantesActivees
        ? { type: 'variante', id: ligne.varianteId! }
        : { type: 'produit', id: ligne.produitId };
      const cle = `${unite.type}:${unite.id}`;
      const besoin = besoins.get(cle) ?? { unite, quantite: 0, produitId: ligne.produitId, codes: [] };
      besoin.quantite += ligne.quantite;
      if (!besoin.codes.includes(c.codeSuivi)) besoin.codes.push(c.codeSuivi);
      besoins.set(cle, besoin);
    }
  }
  return { besoins, anomalies };
}
