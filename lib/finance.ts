import type { TypeTransaction, CategorieTransaction } from '@/app/generated/prisma/enums';

// Source unique pour l'ordre, les libellés et le formatage des écritures
// comptables (§ /admin/comptabilite) — même convention que lib/statuts.ts.

export const TYPES_TRANSACTION: TypeTransaction[] = ['revenu', 'depense'];

export const LABELS_TYPE_TRANSACTION: Record<TypeTransaction, string> = {
  revenu: 'Recette',
  depense: 'Dépense',
};

export const CATEGORIES_TRANSACTION: CategorieTransaction[] = [
  'paiement_client',
  'frais_livraison',
  'abonnement_outil',
  'salaire',
  'remboursement',
  'autre',
];

export const LABELS_CATEGORIE_TRANSACTION: Record<CategorieTransaction, string> = {
  paiement_client: 'Paiement client',
  frais_livraison: 'Frais de livraison',
  abonnement_outil: 'Abonnement outil',
  salaire: 'Salaire',
  remboursement: 'Remboursement',
  autre: 'Autre',
};

// Le signe (+/-) est toujours dérivé de `type`, jamais saisi : le montant
// stocké en base reste positif (cf. Transaction.montant côté schema.prisma).
export function formatMontantTransaction(montant: number | string, type: TypeTransaction): string {
  const valeur = Math.abs(Number(montant));
  const signe = type === 'revenu' ? '+' : '-';
  return `${signe} ${valeur.toFixed(2)} DH`;
}

export function formatSolde(solde: number): string {
  const signe = solde < 0 ? '-' : '+';
  return `${signe} ${Math.abs(solde).toFixed(2)} DH`;
}
