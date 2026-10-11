// § Colis multi-produits — le résumé d'un colis tiré de ses lignes.
//
// Module PUR, sans import : il sert aux routes comme aux écrans.
//
// `Commande.quantite` et `Commande.produitDescription` restent en base comme
// RÉSUMÉ du contenu (cf. LigneColis) : c'est ce que lisent les transporteurs
// (une désignation et une quantité par colis), les listes et l'export. Les
// écrire ailleurs qu'ici les ferait diverger des lignes.

// Même borne que la description des commandes Shopify/YouCan : au-delà, le
// texte ne sert plus à personne et dépasse ce qu'acceptent les transporteurs.
export const LONGUEUR_MAX_RESUME = 500;

export interface LigneResumable {
  libelle: string;
  quantite: number;
}

export function quantiteTotale(lignes: LigneResumable[]): number {
  return lignes.reduce((total, l) => total + l.quantite, 0);
}

// Une ligne : son libellé seul, la quantité étant portée à part. Plusieurs :
// « 2 × Robe — Rouge, 1 × Mug », dans l'ordre des lignes.
export function descriptionContenu(lignes: LigneResumable[]): string | null {
  if (lignes.length === 0) return null;
  const texte =
    lignes.length === 1 ? lignes[0].libelle : lignes.map((l) => `${l.quantite} × ${l.libelle}`).join(', ');
  return texte.length > LONGUEUR_MAX_RESUME ? `${texte.slice(0, LONGUEUR_MAX_RESUME - 1)}…` : texte;
}

export function resumerLignes(lignes: LigneResumable[]): { quantite: number; produitDescription: string | null } {
  return { quantite: Math.max(1, quantiteTotale(lignes)), produitDescription: descriptionContenu(lignes) };
}
