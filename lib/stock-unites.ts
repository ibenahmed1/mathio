// § Gestion de stock — unités de stock sélectionnables d'un inventaire.
//
// Module PUR (consommé par des composants client) : une unité est ce qu'un
// colis "stock" consomme, donc une variante quand le produit suit ses
// variantes, le produit lui-même sinon. Un produit à variantes n'est jamais
// une unité à lui seul : le choisir ne dirait pas quoi décrémenter.

interface ProduitAvecVariantes {
  id: string;
  nom: string;
  reference: string;
  photoUrl?: string | null;
  quantiteRecue: number;
  variantesActivees: boolean;
  variantes?: { id: string; nom: string; reference: string; quantiteRecue: number }[] | null;
}

export interface UniteStockOption<P extends ProduitAvecVariantes = ProduitAvecVariantes> {
  produit: P;
  variante: NonNullable<P['variantes']>[number] | null;
  reference: string;
  libelle: string;
  // Stock réellement disponible en entrepôt (validé, pas seulement déclaré).
  disponible: number;
}

export function unitesStock<P extends ProduitAvecVariantes>(produits: P[]): UniteStockOption<P>[] {
  return produits.flatMap((produit) =>
    produit.variantesActivees
      ? (produit.variantes ?? []).map((variante) => ({
          produit,
          variante,
          reference: variante.reference,
          libelle: `${produit.nom} — ${variante.nom}`,
          disponible: variante.quantiteRecue,
        }))
      : [{ produit, variante: null, reference: produit.reference, libelle: produit.nom, disponible: produit.quantiteRecue }]
  );
}

// Même règle que lib/stock-sku.ts côté serveur : comparaison sans casse.
export function trouverUniteParSku<P extends ProduitAvecVariantes>(unites: UniteStockOption<P>[], sku: string) {
  const cle = sku.trim().toLowerCase();
  return unites.find((u) => u.reference.toLowerCase() === cle) ?? null;
}
