import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';
import { formatNombre, type RepartitionStatut } from '@/lib/statistiques-core';

// Barres en CSS plutôt qu'un camembert recharts, pour trois raisons : le
// composant reste rendu côté serveur (aucun JS envoyé), vingt-huit statuts
// dans un camembert sont illisibles, et la lecture « qui domine » se fait
// mieux sur une liste triée que sur des angles.
export function RepartitionStatuts({ lignes }: { lignes: RepartitionStatut[] }) {
  const total = lignes.reduce((s, l) => s + l.nb, 0);
  if (total === 0) {
    return <p className="empty-state">Aucun colis sur cette période.</p>;
  }

  const max = Math.max(...lignes.map((l) => l.nb));

  return (
    <ul className="flex flex-col gap-1.5">
      {lignes.map((l) => {
        const part = (l.nb / total) * 100;
        const couleur =
          l.statut === 'livre'
            ? 'bg-brand'
            : l.statut === 'retourne'
              ? 'bg-red-500'
              : l.statut === 'annule' || l.statut === 'annule_par_vendeur'
                ? 'bg-black/25 dark:bg-white/25'
                : 'bg-black/40 dark:bg-white/40';
        return (
          <li key={l.statut} className="flex items-center gap-3 text-sm">
            <span className="w-52 shrink-0 truncate" title={LABELS_STATUT_COMMANDE[l.statut]}>
              {LABELS_STATUT_COMMANDE[l.statut]}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
              {/* Largeur relative au statut le PLUS représenté et non au total :
                  sinon, sur un pipeline sain où « livré » pèse 80 %, les vingt
                  autres statuts deviennent des traits invisibles. */}
              <div className={`h-full rounded-full ${couleur}`} style={{ width: `${(l.nb / max) * 100}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{formatNombre(l.nb)}</span>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums opacity-55">
              {part.toFixed(1).replace('.', ',')} %
            </span>
          </li>
        );
      })}
    </ul>
  );
}
