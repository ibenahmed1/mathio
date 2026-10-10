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

// SKU proposé pour une variante : SKU du produit suivi du nom de la variante,
// en majuscules sans accents (« Rouge foncé » → PRD-XXXX-ROUGE-FONCE). Simple
// proposition, comme genererReferenceProduit : le marchand peut la modifier.
export function referenceVariante(referenceProduit: string, nomVariante: string): string {
  const slug = nomVariante
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${referenceProduit}-${slug}` : '';
}
