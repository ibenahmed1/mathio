import type { CleApi } from '@/lib/types';

// Mise en forme partagée par les blocs de l'écran des intégrations. Extraite
// pour que la table des clés, le journal et le panneau de détail affichent
// exactement les mêmes dates — trois `toLocaleString` recopiés finissent
// toujours par diverger d'une option.

export function dateCourte(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function horodatageCourt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * L'état d'une clé se lit d'un coup d'œil ou ne se lit pas : révoquée et
 * expirée mènent au même refus mais ne se corrigent pas pareil (réémettre vs
 * prolonger), donc elles ne partagent pas de badge.
 */
export function badgeCle(cle: CleApi): { classe: string; texte: string } {
  if (cle.revoqueeLe) return { classe: 'badge badge-danger', texte: 'Révoquée' };
  if (cle.expireLe && new Date(cle.expireLe) <= new Date()) {
    return { classe: 'badge badge-danger', texte: 'Expirée' };
  }
  if (cle.expireLe) return { classe: 'badge badge-warn', texte: `Expire le ${dateCourte(cle.expireLe)}` };
  return { classe: 'badge badge-ok', texte: 'Active' };
}
