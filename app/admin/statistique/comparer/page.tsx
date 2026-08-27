import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
  LABELS_PRESET,
  PRESETS_PERIODE,
  filtrePeriode,
  formatDirhams,
  formatNombre,
  formatTaux,
  getCodEncaisse,
  getCompteurs,
  periodePrecedenteEquivalente,
  resoudrePeriode,
  tauxAnnulation,
  tauxLivraison,
  tauxRetour,
  variation,
  type Compteurs,
  type Periode,
} from '@/lib/statistiques';

// Période B : soit un preset explicite, soit « la précédente équivalente », qui
// est le seul choix honnête par défaut. Comparer « 30 derniers jours » à « mois
// en cours » mettrait face à face deux durées différentes et produirait des
// écarts qui ne disent rien.
const DEFAUT_CONTRE = 'precedente';

interface Mesure {
  label: string;
  valeurA: string;
  valeurB: string;
  variation: number | null;
  hausseEstBonne: boolean;
}

function construireMesures(
  a: { compteurs: Compteurs; cod: number },
  b: { compteurs: Compteurs; cod: number }
): Mesure[] {
  const tauxLivA = tauxLivraison(a.compteurs);
  const tauxLivB = tauxLivraison(b.compteurs);
  const tauxRetA = tauxRetour(a.compteurs);
  const tauxRetB = tauxRetour(b.compteurs);
  const tauxAnnA = tauxAnnulation(a.compteurs);
  const tauxAnnB = tauxAnnulation(b.compteurs);

  return [
    {
      label: 'Colis pris en charge',
      valeurA: formatNombre(a.compteurs.total),
      valeurB: formatNombre(b.compteurs.total),
      variation: variation(a.compteurs.total, b.compteurs.total),
      hausseEstBonne: true,
    },
    {
      label: 'Colis livrés',
      valeurA: formatNombre(a.compteurs.livres),
      valeurB: formatNombre(b.compteurs.livres),
      variation: variation(a.compteurs.livres, b.compteurs.livres),
      hausseEstBonne: true,
    },
    {
      label: 'Colis retournés',
      valeurA: formatNombre(a.compteurs.retournes),
      valeurB: formatNombre(b.compteurs.retournes),
      variation: variation(a.compteurs.retournes, b.compteurs.retournes),
      hausseEstBonne: false,
    },
    {
      label: 'Taux de livraison',
      valeurA: formatTaux(tauxLivA),
      valeurB: formatTaux(tauxLivB),
      // Variation en POINTS de pourcentage relatifs : passer de 80 % à 84 %,
      // c'est « +5 % » de taux, pas « +4 % ». Les deux lectures existent ; on
      // garde la relative pour rester cohérent avec les autres lignes.
      variation: tauxLivA !== null && tauxLivB !== null ? variation(tauxLivA, tauxLivB) : null,
      hausseEstBonne: true,
    },
    {
      label: 'Taux de retour',
      valeurA: formatTaux(tauxRetA),
      valeurB: formatTaux(tauxRetB),
      variation: tauxRetA !== null && tauxRetB !== null ? variation(tauxRetA, tauxRetB) : null,
      hausseEstBonne: false,
    },
    {
      label: "Taux d'annulation",
      valeurA: formatTaux(tauxAnnA),
      valeurB: formatTaux(tauxAnnB),
      variation: tauxAnnA !== null && tauxAnnB !== null ? variation(tauxAnnA, tauxAnnB) : null,
      hausseEstBonne: false,
    },
    {
      label: 'COD encaissé',
      valeurA: formatDirhams(a.cod),
      valeurB: formatDirhams(b.cod),
      variation: variation(a.cod, b.cod),
      hausseEstBonne: true,
    },
  ];
}

function CelluleVariation({ mesure }: { mesure: Mesure }) {
  if (mesure.variation === null) {
    return <span className="text-xs opacity-40">—</span>;
  }
  const stable = Math.abs(mesure.variation) < 0.05;
  const bon = mesure.variation > 0 ? mesure.hausseEstBonne : !mesure.hausseEstBonne;
  const Icone = stable ? Minus : mesure.variation > 0 ? ArrowUpRight : ArrowDownRight;
  const couleur = stable
    ? 'text-black/45 dark:text-white/45'
    : bon
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <span className={`flex items-center justify-end gap-1 text-sm font-semibold tabular-nums ${couleur}`}>
      <Icone className="h-4 w-4" />
      {stable ? 'stable' : `${mesure.variation > 0 ? '+' : ''}${mesure.variation.toFixed(1).replace('.', ',')} %`}
    </span>
  );
}

function libellePeriode(p: Periode): string {
  if (!p.debut) return 'Depuis le début';
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `${fmt(p.debut)} → ${fmt(p.fin)}`;
}

export default async function StatistiqueComparerPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; contre?: string }>;
}) {
  const { periode: brut, contre: brutContre } = await searchParams;
  const periodeA = resoudrePeriode(brut);
  const choixContre = brutContre ?? DEFAUT_CONTRE;

  const periodeB =
    choixContre === DEFAUT_CONTRE ? periodePrecedenteEquivalente(periodeA) : resoudrePeriode(choixContre);

  if (!periodeB) {
    return (
      <div className="table-card">
        <p className="empty-state">
          « Depuis le début » n&apos;a pas de période précédente. Choisissez une période bornée pour comparer.
        </p>
      </div>
    );
  }

  const [compteursA, codA, compteursB, codB] = await Promise.all([
    getCompteurs(filtrePeriode(periodeA)),
    getCodEncaisse(filtrePeriode(periodeA)),
    getCompteurs(filtrePeriode(periodeB)),
    getCodEncaisse(filtrePeriode(periodeB)),
  ]);

  const mesures = construireMesures(
    { compteurs: compteursA, cod: codA },
    { compteurs: compteursB, cod: codB }
  );

  const dureesDifferentes = periodeA.nbJours !== null && periodeB.nbJours !== null && periodeA.nbJours !== periodeB.nbJours;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm opacity-60">Comparer à :</span>
        <Link
          href={`/admin/statistique/comparer?periode=${periodeA.preset}&contre=${DEFAUT_CONTRE}`}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
            choixContre === DEFAUT_CONTRE
              ? 'bg-brand text-brand-foreground'
              : 'text-black/55 hover:bg-black/5 dark:text-white/55 dark:hover:bg-white/10'
          }`}
        >
          Période précédente
        </Link>
        {PRESETS_PERIODE.filter((p) => p !== 'tout').map((p) => (
          <Link
            key={p}
            href={`/admin/statistique/comparer?periode=${periodeA.preset}&contre=${p}`}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              choixContre === p
                ? 'bg-brand text-brand-foreground'
                : 'text-black/55 hover:bg-black/5 dark:text-white/55 dark:hover:bg-white/10'
            }`}
          >
            {LABELS_PRESET[p]}
          </Link>
        ))}
      </div>

      {dureesDifferentes && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Les deux périodes n&apos;ont pas la même durée ({periodeA.nbJours} j contre {periodeB.nbJours} j). Les
          écarts de volume reflètent en partie cette différence — les taux, eux, restent comparables.
        </p>
      )}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[640px]">
            <thead>
              <tr>
                <th></th>
                <th className="text-right">
                  {periodeA.label}
                  <span className="block text-[10px] font-normal normal-case opacity-60">
                    {libellePeriode(periodeA)}
                  </span>
                </th>
                <th className="text-right">
                  {choixContre === DEFAUT_CONTRE ? 'Période précédente' : periodeB.label}
                  <span className="block text-[10px] font-normal normal-case opacity-60">
                    {libellePeriode(periodeB)}
                  </span>
                </th>
                <th className="text-right">Écart</th>
              </tr>
            </thead>
            <tbody>
              {mesures.map((m) => (
                <tr key={m.label}>
                  <td className="font-semibold">{m.label}</td>
                  <td className="text-right tabular-nums">{m.valeurA}</td>
                  <td className="text-right tabular-nums opacity-70">{m.valeurB}</td>
                  <td className="text-right">
                    <CelluleVariation mesure={m} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
