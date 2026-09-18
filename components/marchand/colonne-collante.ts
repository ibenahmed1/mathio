// Dernière colonne d'une table marchande (« Actions », « Imprimer ») collée au
// bord droit de son cadre de défilement. Ces tables font de 560 à 1420 px de
// large : sur un téléphone, sans ça, le menu d'actions n'apparaît qu'au bout
// d'un long défilement horizontal.
//
// - `max-xl:` uniquement : à partir de 1280 px la plupart de ces tables tiennent
//   dans la page, et le rendu desktop doit rester celui d'avant.
// - Fond OPAQUE, sinon on lirait sous la cellule les colonnes qui défilent. Il
//   reprend la surface posée sous la table — la carte (.table-card) ou la page
//   nue —, et l'en-tête de .table-basic, translucide (bg-brand/10), retrouve sa
//   teinte par un dégradé plat superposé à ce fond.
// - Survol de ligne par `group-hover` (la <tr> porte `group`) : comme le
//   `hover:` de .table-basic, il n'existe que sur un appareil qui survole
//   vraiment. Un `tr:hover` nu laisserait la cellule teintée après un tap,
//   seule dans sa ligne.
// - Filet et ombre en box-shadow, pas en bordure : en `border-collapse`, les
//   bordures sont peintes par la table et ne suivraient pas la cellule collée.

const COLLANTE =
  'max-xl:sticky max-xl:right-0 max-xl:z-10 max-xl:shadow-[-1px_0_0_var(--mk-line),-10px_0_12px_-10px_rgba(15,23,42,0.25)]';

/** Table posée dans une `.table-card` (fond de carte). */
export const COLONNE_COLLANTE_CARTE: { th: string; td: string } = {
  th: `${COLLANTE} max-xl:bg-[color:var(--mk-card)] max-xl:bg-linear-to-r max-xl:from-brand/[0.10] max-xl:to-brand/[0.10] max-xl:dark:from-white/[0.05] max-xl:dark:to-white/[0.05]`,
  td: `${COLLANTE} max-xl:bg-[color:var(--mk-card)] max-xl:group-hover:bg-linear-to-r max-xl:group-hover:from-brand/[0.09] max-xl:group-hover:to-brand/[0.09]`,
};

/** Table posée directement sur la page, sans carte. */
export const COLONNE_COLLANTE_PAGE: { th: string; td: string } = {
  th: `${COLLANTE} max-xl:bg-[color:var(--mk-page)] max-xl:bg-linear-to-r max-xl:from-brand/[0.10] max-xl:to-brand/[0.10] max-xl:dark:from-white/[0.05] max-xl:dark:to-white/[0.05]`,
  td: `${COLLANTE} max-xl:bg-[color:var(--mk-page)] max-xl:group-hover:bg-linear-to-r max-xl:group-hover:from-brand/[0.09] max-xl:group-hover:to-brand/[0.09]`,
};
