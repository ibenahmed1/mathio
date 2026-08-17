import type { EtatPaiement } from '@/app/generated/prisma/enums';
import { LABELS_ETAT_PAIEMENT } from '@/lib/statuts';

// État de règlement du COD (dimension distincte du statut de livraison) —
// rendu en pastille contourée pour le distinguer visuellement de StatutBadge
// (plein) dans les tableaux qui affichent les deux colonnes côte à côte.
const STYLES: Record<EtatPaiement, string> = {
  non_paye: 'border-pink-500 text-pink-600 dark:text-pink-400',
  facture: 'border-black/40 text-black/70 dark:border-white/40 dark:text-white/70',
  paye: 'border-green-600 text-green-700 dark:text-green-500',
  rembourse: 'border-purple-500 text-purple-600 dark:text-purple-400',
};

export function EtatPaiementBadge({ etat }: { etat: EtatPaiement }) {
  return (
    <span className={`badge border bg-transparent ${STYLES[etat]}`}>{LABELS_ETAT_PAIEMENT[etat]}</span>
  );
}
