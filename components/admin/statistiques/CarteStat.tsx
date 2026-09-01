import { ArrowDownRight, ArrowUpRight, Minus, TriangleAlert } from 'lucide-react';

// Carte de KPI avec variation par rapport à la période précédente.
//
// Distincte de KpiCard (tableau de bord d'accueil), qui affiche un état
// instantané sans notion de période : ici la valeur ne veut rien dire sans son
// évolution — « 1 240 colis » n'est ni bon ni mauvais, « 1 240, +18 % » l'est.
export function CarteStat({
  label,
  valeur,
  variation,
  // Sur un taux de retour ou d'annulation, une hausse est une MAUVAISE
  // nouvelle : la couleur doit s'inverser, sans quoi le rouge et le vert
  // finissent par ne plus rien vouloir dire.
  hausseEstBonne = true,
  precision,
  // Réserve sur la valeur elle-même, affichée EN PLUS de la variation et non à
  // sa place : un chiffre dont on sait qu'il est faux doit le dire au même
  // endroit qu'on le lit. Sert à la marge, dont le coût peut être incomplet.
  alerte,
}: {
  label: string;
  valeur: string;
  variation?: number | null;
  hausseEstBonne?: boolean;
  precision?: string;
  alerte?: string;
}) {
  return (
    <div className="dashboard-card flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-black/55 dark:text-white/55">{label}</p>
      <p className="text-2xl font-black leading-tight tabular-nums text-black dark:text-white">{valeur}</p>
      <Variation valeur={variation} hausseEstBonne={hausseEstBonne} precision={precision} />
      {alerte && (
        <p className="mt-0.5 flex items-start gap-1 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
          {alerte}
        </p>
      )}
    </div>
  );
}

function Variation({
  valeur,
  hausseEstBonne,
  precision,
}: {
  valeur?: number | null;
  hausseEstBonne: boolean;
  precision?: string;
}) {
  if (precision) {
    return <p className="text-xs opacity-55">{precision}</p>;
  }
  // `undefined` = pas de comparaison demandée ; `null` = comparaison
  // impossible (période « depuis le début », ou période précédente vide).
  // Les deux se taisent, mais pour des raisons différentes.
  if (valeur === undefined || valeur === null) {
    return <p className="text-xs opacity-40">Pas de comparaison possible</p>;
  }

  const stable = Math.abs(valeur) < 0.05;
  const bon = valeur > 0 ? hausseEstBonne : !hausseEstBonne;
  const Icone = stable ? Minus : valeur > 0 ? ArrowUpRight : ArrowDownRight;
  const couleur = stable
    ? 'text-black/45 dark:text-white/45'
    : bon
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <p className={`flex items-center gap-1 text-xs font-semibold ${couleur}`}>
      <Icone className="h-3.5 w-3.5" />
      {stable ? 'stable' : `${valeur > 0 ? '+' : ''}${valeur.toFixed(1).replace('.', ',')} %`}
      <span className="font-normal opacity-70">vs période précédente</span>
    </p>
  );
}
