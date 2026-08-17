'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Package, Phone, Truck, XCircle } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Marchand } from '@/lib/types';

interface DashboardData {
  kpiCards: {
    collecte: number;
    colisEnCours: number;
    colisInjoignables: number;
    colisAnnules: number;
  };
  stats: {
    totalColis: number;
    colisLivre: number;
    colisLivreDeltaPct: number;
    tauxLivraison: number;
    tauxLivraisonDeltaPts: number;
  };
  bars: { label: string; livre: number; total: number }[];
  crbt: {
    brut: number;
    rembourse: number;
    aRembourser: number;
  };
  rates: {
    livraison: number;
    collecte: number;
    encaissement: number;
  };
}

// Index = valeur du paramètre `period` attendu par /api/marchands/dashboard.
const PERIODES = [
  { valeur: '0', label: 'Ce mois-ci', delta: 'vs mois dernier' },
  { valeur: '1', label: 'Cette semaine', delta: 'vs semaine dernière' },
  { valeur: '2', label: "Aujourd'hui", delta: 'vs hier' },
];

// Toutes les tuiles KPI partagent désormais la même bordure et la même ombre :
// la couleur ne vit plus que dans la pastille d'icône, ce qui laisse les
// chiffres porter la hiérarchie. Les teintes elles-mêmes sont des classes
// `.kpi-*` (globals.css) pour avoir une contrepartie sombre.
const TEINTES_KPI = ['ambre', 'indigo', 'ardoise', 'rouge'] as const;

// Couleurs de données (graphique + répartition CRBT). L'ambre marque toujours
// ce qui est acquis (livré, remboursé), l'ardoise ce qui ne l'est pas encore.
const SERIE_ACQUIS = '#F2C200';
const SERIE_RESTE = '#CBD5E1';

const CARTE =
  'mk-card-accent rounded-[14px] border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] shadow-[var(--mk-shadow)]';

function KpiTile({
  icon: Icon,
  value,
  label,
  teinte,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  teinte: (typeof TEINTES_KPI)[number];
}) {
  return (
    <div className={`${CARTE} kpi-${teinte} flex flex-col gap-6 p-[18px]`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-[color:var(--mk-muted)]">{label}</span>
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[color:var(--kpi-chip)] text-[color:var(--kpi-icon)]">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {/* Un zéro est atténué : il se lit comme "rien à signaler" plutôt que
          d'attirer l'œil autant qu'un vrai volume. */}
      <div
        className="text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums"
        style={{ color: value === 0 ? 'var(--mk-faint)' : 'var(--mk-ink)' }}
      >
        {value}
      </div>
    </div>
  );
}

function RateBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[color:var(--mk-muted)]">{label}</span>
        <span className="text-[13px] font-semibold tabular-nums text-[color:var(--mk-ink)]">{pct} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--mk-line-soft)]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

// Légende du graphique : sans elle, rien ne dit laquelle des deux barres est
// la part livrée.
function Legende({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--mk-muted)]">
      <span className="h-2 w-2 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function CrbtFigure({
  label,
  montant,
  pastille,
  className,
}: {
  label: string;
  montant: number;
  /** Rappelle la couleur du segment correspondant dans la barre de répartition. */
  pastille?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className="flex items-center gap-1.5">
        {pastille && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: pastille }} />}
        <span className="truncate text-[11px] font-medium text-[color:var(--mk-muted)]">{label}</span>
      </div>
      <div className="mt-1.5 whitespace-nowrap text-[14px] font-semibold tracking-[-0.02em] tabular-nums text-[color:var(--mk-ink)]">
        {fmtDh(montant)}
      </div>
    </div>
  );
}

function fmtDelta(pts: number) {
  return `${pts} %`;
}

function fmtDh(montant: number) {
  return `${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

export default function DashboardPage() {
  const [period, setPeriod] = useState(0);
  const [date, setDate] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [boutique, setBoutique] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // Décale la date d'un jour : les flèches ‹ › ne servent à rien tant qu'aucune
  // date n'est choisie, donc elles partent d'aujourd'hui dans ce cas.
  function decalerDate(jours: number) {
    const base = date ? new Date(date) : new Date();
    base.setDate(base.getDate() + jours);
    setDate(base.toISOString().slice(0, 10));
  }

  useEffect(() => {
    const query = date ? `date=${date}` : `period=${period}`;
    apiGet<DashboardData>(`/api/marchands/dashboard?${query}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [period, date]);

  // Nom affiché dans le message d'accueil — l'échec est silencieux : on retombe
  // sur un "Bonjour" sec plutôt que de bloquer tout le dashboard.
  useEffect(() => {
    apiGet<Marchand>('/api/marchands/me')
      .then((m) => setBoutique(m.nomBoutique))
      .catch(() => setBoutique(null));
  }, []);

  if (error)
    return (
      <div className={`${CARTE} p-6 text-[13px] font-medium text-[color:var(--mk-danger-ink)]`} role="alert">
        {error}
      </div>
    );
  if (!data) return <p className="text-[13px] text-[color:var(--mk-muted)]">Chargement…</p>;

  const periodLabel = date
    ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    : PERIODES[period].label;
  const deltaLabel = date ? 'vs jour précédent' : PERIODES[period].delta;
  // Échelle de l'axe : arrondie au multiple de 4 supérieur pour que les 5
  // graduations (max → 0) restent des entiers, comme le 100/75/50/25/0 du
  // mockup, sans jamais mentir sur la hauteur réelle des barres.
  const maxBar = Math.max(...data.bars.flatMap((b) => [b.livre, b.total]));
  const echelle = Math.max(4, Math.ceil(maxBar / 4) * 4);
  const graduations = [4, 3, 2, 1, 0].map((i) => (echelle / 4) * i);
  const partRembourse = data.crbt.brut > 0 ? Math.round((data.crbt.rembourse / data.crbt.brut) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4 px-0.5 pb-1">
        <div>
          <h1 className="text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-[color:var(--mk-ink)]">
            Dashboard
          </h1>
          <p className="mt-2 text-[13px] font-normal text-[color:var(--mk-muted)]">
            Bonjour <span className="font-semibold text-[color:var(--mk-ink-2)]">{boutique ?? '…'}</span>, bienvenue à
            nouveau
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-[10px] border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] px-1.5 py-1.5 shadow-[var(--mk-shadow)]">
            <button
              onClick={() => decalerDate(-1)}
              aria-label="Jour précédent"
              className="rounded-md p-1 text-[color:var(--mk-faint)] transition-colors hover:text-[color:var(--mk-ink-2)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {/* Le natif <input type="date"> ne s'ouvre au clic que sur son icône :
                on affiche donc notre propre libellé et on déclenche showPicker(),
                l'input restant superposé en repli si le navigateur ne l'expose pas. */}
            <button
              onClick={() => dateRef.current?.showPicker?.()}
              className="relative flex items-center gap-2 px-2 text-[12px] font-medium text-[color:var(--mk-ink-2)]"
            >
              <CalendarDays className="h-4 w-4 text-[color:var(--mk-muted-2)]" />
              {date
                ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
                : 'Choisir une date'}
              <input
                ref={dateRef}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </button>
            <button
              onClick={() => decalerDate(1)}
              aria-label="Jour suivant"
              className="rounded-md p-1 text-[color:var(--mk-faint)] transition-colors hover:text-[color:var(--mk-ink-2)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Visible seulement en mode "date précise" : sans ça, la liste
              déroulante afficherait une période qui n'est pas celle appliquée. */}
          {date && (
            <button
              onClick={() => setDate('')}
              className="px-1 text-[12px] font-normal text-[color:var(--mk-muted-2)] underline underline-offset-2 hover:text-[color:var(--mk-ink-2)]"
            >
              Effacer
            </button>
          )}

          <select
            value={date ? '' : period}
            onChange={(e) => {
              setPeriod(Number(e.target.value));
              setDate('');
            }}
            className="cursor-pointer rounded-[10px] border border-[color:var(--mk-line)] py-[9px] pl-3.5 pr-9 text-[12px] font-medium text-[color:var(--mk-ink-2)] shadow-[var(--mk-shadow)] outline-none focus-visible:border-[color:var(--mk-amber-ink)]"
            style={{
              background:
                // `appearance:none` retire le chevron natif (trop lourd ici) ;
                // on le redessine en data-URI, aligné à droite du libellé.
                "var(--mk-card) url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2364748B' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\") no-repeat right 14px center",
              appearance: 'none',
            }}
          >
            {date && <option value="">{periodLabel}</option>}
            {PERIODES.map((p) => (
              <option key={p.valeur} value={p.valeur}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon={Package} teinte="ambre" value={data.kpiCards.collecte} label="Collecté" />
        <KpiTile icon={Truck} teinte="indigo" value={data.kpiCards.colisEnCours} label="Colis en cours" />
        <KpiTile icon={Phone} teinte="ardoise" value={data.kpiCards.colisInjoignables} label="Colis injoignables" />
        <KpiTile icon={XCircle} teinte="rouge" value={data.kpiCards.colisAnnules} label="Colis annulé" />
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className={`${CARTE} flex flex-col gap-5 p-6 pb-[18px]`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-[color:var(--mk-line-soft)]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6">
                  <path d="M12 2.6 21 7.8 21 17 12 22.2 3 17 3 7.8Z" stroke="#64748B" />
                  <path d="M3 7.8 12 13 21 7.8" stroke="#64748B" />
                  <path d="M12 13 12 22.2" stroke="#64748B" />
                </svg>
              </div>
              <span className="text-[15px] font-semibold text-[color:var(--mk-ink)]">Statistiques des colis</span>
            </div>
            <div className="rounded-[10px] border border-[color:var(--mk-line)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--mk-muted)]">
              {periodLabel}
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-x-8 gap-y-4 sm:gap-x-12">
            <div>
              <div className="text-[13px] font-medium text-[color:var(--mk-muted)]">Colis livré</div>
              <div className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[color:var(--mk-ink)]">
                {data.stats.colisLivre}
              </div>
              <div className="mt-2 text-[11px] font-normal text-[color:var(--mk-muted-2)]">
                {fmtDelta(data.stats.colisLivreDeltaPct)} {deltaLabel}
              </div>
            </div>
            <div className="border-l border-[color:var(--mk-line)] pl-8 sm:pl-12">
              <div className="text-[13px] font-medium text-[color:var(--mk-muted)]">Taux de livraison</div>
              <div className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[color:var(--mk-ink)]">
                {data.stats.tauxLivraison} %
              </div>
              <div className="mt-2 text-[11px] font-normal text-[color:var(--mk-muted-2)]">
                {fmtDelta(data.stats.tauxLivraisonDeltaPts)} {deltaLabel}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-4 pt-1">
              <Legende color={SERIE_ACQUIS} label="Livrés" />
              <Legende color={SERIE_RESTE} label="Total créés" />
            </div>
          </div>

          <div className="flex flex-1 gap-3.5" style={{ minHeight: 230 }}>
            <div className="flex flex-col justify-between pb-[26px] text-[11px] font-normal tabular-nums text-[color:var(--mk-muted-2)]">
              {graduations.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
            <div className="relative flex flex-1 items-end justify-around gap-2.5 border-l border-[color:var(--mk-line-soft)]">
              {/* Chaque colonne est plafonnée : avec deux ou trois mois de
                  données seulement, des colonnes en `flex-1` pur donnaient des
                  barres démesurément épaisses par rapport aux mois voisins. */}
              {data.bars.map((b) => (
                <div key={b.label} className="flex h-full max-w-[86px] flex-1 flex-col items-center justify-end gap-2.5">
                  <div className="flex h-full w-full items-end justify-center gap-[6px]">
                    <div
                      className="w-full max-w-[18px] rounded-t-[5px]"
                      style={{
                        height: `${(b.livre / echelle) * 100}%`,
                        minHeight: 4,
                        background: SERIE_ACQUIS,
                      }}
                    />
                    <div
                      className="w-full max-w-[18px] rounded-t-[5px]"
                      style={{
                        height: `${(b.total / echelle) * 100}%`,
                        minHeight: 4,
                        background: SERIE_RESTE,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-normal capitalize text-[color:var(--mk-muted)]">{b.label}</span>
                </div>
              ))}
              <div className="pointer-events-none absolute left-0 right-0 top-[34%] flex justify-center">
                {/* Pastille inversée (encre ↔ fond) : contrastée dans les deux
                    thèmes sans couleur codée en dur. */}
                <div className="rounded-[10px] bg-[color:var(--mk-ink)] px-3 py-2 text-center leading-[1.3] text-[color:var(--mk-page)] shadow-[var(--mk-shadow-lift)]">
                  <div className="text-[13px] font-semibold tabular-nums">{data.stats.totalColis} colis</div>
                  <div className="text-[10px] font-normal opacity-60">{periodLabel}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`${CARTE} flex flex-col gap-6 p-6`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-[color:var(--mk-line-soft)]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6">
                  <path d="M12 2.6 21 7.8 21 17 12 22.2 3 17 3 7.8Z" stroke="#64748B" />
                  <path d="M3 7.8 12 13 21 7.8" stroke="#64748B" />
                  <path d="M12 13 12 22.2" stroke="#64748B" />
                </svg>
              </div>
              <span className="text-[15px] font-semibold text-[color:var(--mk-ink)]">CRBT</span>
            </div>
            <div className="rounded-[10px] border border-[color:var(--mk-line)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--mk-muted)]">
              {periodLabel}
            </div>
          </div>

          {/* Trois montants alignés sur une même ligne de base, puis la barre
              qui montre comment le brut se répartit — les anciens cercles de
              tailles inégales n'encodaient aucune proportion réelle. */}
          <div>
            {/* Empilé sous 640px : à trois colonnes, un montant à cinq chiffres
                déborderait de sa cellule sur un téléphone. */}
            <div className="grid grid-cols-1 gap-y-3 sm:grid-cols-3 sm:gap-y-0">
              <CrbtFigure label="Brut" montant={data.crbt.brut} className="sm:pr-3" />
              <CrbtFigure
                label="Remboursé"
                montant={data.crbt.rembourse}
                pastille={SERIE_ACQUIS}
                className="sm:border-l sm:border-[color:var(--mk-line-soft)] sm:px-3"
              />
              <CrbtFigure
                label="À rembourser"
                montant={data.crbt.aRembourser}
                pastille={SERIE_RESTE}
                className="sm:border-l sm:border-[color:var(--mk-line-soft)] sm:pl-3"
              />
            </div>

            {/* Piste seule tant qu'il n'y a rien à répartir : un aplat gris à
                100 % se lirait à tort comme "tout est à rembourser". */}
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-[color:var(--mk-line-soft)]">
              {data.crbt.brut > 0 && (
                <>
                  <div style={{ width: `${partRembourse}%`, background: SERIE_ACQUIS }} />
                  <div style={{ width: `${100 - partRembourse}%`, background: SERIE_RESTE }} />
                </>
              )}
            </div>
            <p className="mt-2 text-[11px] font-normal text-[color:var(--mk-muted-2)]">
              {data.crbt.brut > 0
                ? `${partRembourse} % du montant brut déjà remboursé`
                : 'Aucun montant à rembourser sur cette période'}
            </p>
          </div>

          <div className="mt-auto flex flex-col gap-3.5">
            <RateBar label="Taux de livraison" pct={data.rates.livraison} color={SERIE_ACQUIS} />
            <RateBar label="Taux de collecte" pct={data.rates.collecte} color={SERIE_RESTE} />
            <RateBar label="Taux d'encaissement" pct={data.rates.encaissement} color={SERIE_RESTE} />
          </div>
        </div>
      </div>
    </div>
  );
}
