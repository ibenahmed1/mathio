import type { StatutCommandeStockHub } from '@/app/generated/prisma/enums';
import {
  analyserDate,
  analyserMontant,
  analyserPreuveModifiee,
  analyserTitre,
  texteFacultatif,
  type ResultatAnalyse,
} from '@/lib/finance';

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

// Ce qu'un PATCH /api/commandes-stock-hub/[id] peut changer. Le STATUT n'en
// fait pas partie : il suit son cycle par sa propre route (…/[id]/statut),
// sous `comptabilite:write`, là où réécrire la commande demande
// `comptabilite:edit`. Toute clé absente = inchangée.
export interface ModificationCommandeStockHub {
  titre?: string;
  sousTitre?: string | null;
  montant?: number;
  modePaiement?: string;
  dateCommande?: Date;
  // `null` = retirer la catégorie : elle est facultative sur une commande.
  categorieId?: string | null;
  preuveUrl?: string | null;
}

export function analyserModificationCommandeStockHub(
  body: unknown
): ResultatAnalyse<ModificationCommandeStockHub> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { statut: 'refus', message: 'Corps de requête invalide' };
  }
  const corps = body as Record<string, unknown>;
  if ('statut' in corps) {
    return { statut: 'refus', message: 'Le statut se change depuis son propre menu, pas en modifiant la commande' };
  }

  const champs: ModificationCommandeStockHub = {};

  if ('titre' in corps) {
    const r = analyserTitre(corps.titre);
    if (r.statut === 'refus') return r;
    champs.titre = r.valeur;
  }
  if ('sousTitre' in corps) champs.sousTitre = texteFacultatif(corps.sousTitre);
  if ('montant' in corps) {
    const r = analyserMontant(corps.montant);
    if (r.statut === 'refus') return r;
    champs.montant = r.valeur;
  }
  if ('modePaiement' in corps) {
    const mode = texteFacultatif(corps.modePaiement);
    if (!mode) return { statut: 'refus', message: 'Le mode de paiement est requis' };
    champs.modePaiement = mode;
  }
  if ('dateCommande' in corps) {
    const r = analyserDate(corps.dateCommande, 'Date de commande');
    if (r.statut === 'refus') return r;
    champs.dateCommande = r.valeur;
  }
  if ('categorieId' in corps) {
    if (corps.categorieId === null || corps.categorieId === '') {
      champs.categorieId = null;
    } else if (typeof corps.categorieId === 'string' && corps.categorieId.trim()) {
      champs.categorieId = corps.categorieId.trim();
    } else {
      return { statut: 'refus', message: 'Catégorie invalide' };
    }
  }
  if ('preuveUrl' in corps) {
    const r = analyserPreuveModifiee(corps.preuveUrl);
    if (r.statut === 'refus') return r;
    champs.preuveUrl = r.valeur;
  }

  if (Object.keys(champs).length === 0) return { statut: 'refus', message: 'Aucun champ à modifier' };
  return { statut: 'ok', valeur: champs };
}
