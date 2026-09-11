import type { StatutCommandeStockHub } from '@/app/generated/prisma/enums';

// Source unique pour l'ordre, les libellés, les transitions et le formatage des
// commandes de stock des hubs (§ /admin/comptabilite, carte « Commandes
// d'inventaire ») — même convention que lib/finance.ts.

// Ordre du cycle de vie, qui est aussi l'ordre d'affichage.
export const STATUTS_COMMANDE_STOCK_HUB: StatutCommandeStockHub[] = ['brouillon', 'commandee', 'recue', 'annulee'];

export const LABELS_STATUT_COMMANDE_STOCK_HUB: Record<StatutCommandeStockHub, string> = {
  brouillon: 'Brouillon',
  commandee: 'Commandée',
  recue: 'Reçue',
  annulee: 'Annulée',
};

// Statut proposé à la création. Doublé par `@default(brouillon)` dans le
// schéma, pour une ligne insérée hors de l'API.
export const STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT: StatutCommandeStockHub = 'brouillon';

// Statuts acceptés à la CRÉATION. « Annulée » en est exclue : créer une
// commande déjà abandonnée n'a pas de sens. « Reçue » reste permise, pour
// saisir après coup un achat déjà livré.
export const STATUTS_CREATION_COMMANDE_STOCK_HUB: StatutCommandeStockHub[] = ['brouillon', 'commandee', 'recue'];

// Transitions autorisées. Le cycle n'avance que dans un sens : une commande
// passée au fournisseur ne redevient pas brouillon, et un brouillon ne saute
// pas directement à « Reçue » — ce serait recevoir un achat jamais passé.
// « Reçue » et « Annulée » sont définitives : revenir dessus effacerait la
// trace de ce qui s'est réellement passé.
const TRANSITIONS_COMMANDE_STOCK_HUB: Record<StatutCommandeStockHub, StatutCommandeStockHub[]> = {
  brouillon: ['commandee', 'annulee'],
  commandee: ['recue', 'annulee'],
  recue: [],
  annulee: [],
};

// Garde de type pour une valeur venue d'un body JSON. Écarte aussi les anciennes
// valeurs (`en_attente`, `livre`) qu'un client resté sur une page ouverte
// avant la migration pourrait encore envoyer.
export function estStatutCommandeStockHub(valeur: unknown): valeur is StatutCommandeStockHub {
  return typeof valeur === 'string' && (STATUTS_COMMANDE_STOCK_HUB as string[]).includes(valeur);
}

// Copie, et non la liste interne : un appelant qui la modifierait changerait
// sinon les règles pour tout le monde.
export function statutsSuivantsCommandeStockHub(statut: StatutCommandeStockHub): StatutCommandeStockHub[] {
  return [...(TRANSITIONS_COMMANDE_STOCK_HUB[statut] ?? [])];
}

export function peutPasserCommandeStockHub(de: StatutCommandeStockHub, vers: StatutCommandeStockHub): boolean {
  return TRANSITIONS_COMMANDE_STOCK_HUB[de]?.includes(vers) ?? false;
}

export function formatNumeroCommandeStockHub(numero: number): string {
  return `BC-${numero}`;
}

export function formatMontantCommandeStockHub(montant: number | string): string {
  return `- ${Math.abs(Number(montant)).toFixed(2)} DH`;
}
