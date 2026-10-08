import type { Devise } from '@/lib/simulateur-rentabilite';

// Formatage commun au simulateur et à la vue de comparaison. Toute valeur
// absente ou non finie s'affiche « — » : jamais « NaN » ni « Infinity ».

export function formateurMonnaie(devise: Devise) {
  const f = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: devise,
    maximumFractionDigits: 2,
  });
  return (n: number | null) => (n === null || !Number.isFinite(n) ? '—' : f.format(n));
}
export const nombre = (n: number, dec = 0) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: dec }).format(n);
export const pourcent = (f: number | null, dec = 1) =>
  f === null || !Number.isFinite(f) ? '—' : `${nombre(f * 100, dec)} %`;
export const formatCompact = new Intl.NumberFormat('fr-FR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
export const compact = (n: number) => (Number.isFinite(n) ? formatCompact.format(n) : '');
export const ratio = (n: number | null) => (n === null || !Number.isFinite(n) ? '—' : `${nombre(n, 2)}×`);
