import type { StatutCommandeStockHub } from '@/app/generated/prisma/enums';

// Source unique pour l'ordre, les libellés et le formatage des commandes de
// stock des hubs (§ /admin/comptabilite, carte "Commandes d'inventaire") —
// même convention que lib/finance.ts.

export const STATUTS_COMMANDE_STOCK_HUB: StatutCommandeStockHub[] = ['en_attente', 'livre', 'annulee'];

export const LABELS_STATUT_COMMANDE_STOCK_HUB: Record<StatutCommandeStockHub, string> = {
  en_attente: 'En attente',
  livre: 'Livré',
  annulee: 'Annulée',
};

export function formatNumeroCommandeStockHub(numero: number): string {
  return `BC-${numero}`;
}

export function formatMontantCommandeStockHub(montant: number | string): string {
  return `- ${Math.abs(Number(montant)).toFixed(2)} DH`;
}
