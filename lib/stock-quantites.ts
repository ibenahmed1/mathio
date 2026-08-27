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
