// Génère une référence produit par défaut, proposée à l'ouverture du
// formulaire "Ajouter Produit" — le marchand peut l'effacer et saisir son
// propre SKU interne (l'unicité réelle est vérifiée côté API, par marchand).
// Alphabet sans caractères ambigus (pas de 0/O ni de 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genererReferenceProduit(): string {
  let suffixe = '';
  for (let i = 0; i < 8; i++) {
    suffixe += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `PRD-${suffixe}`;
}
