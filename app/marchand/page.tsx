'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Package, PackageCheck, Wallet, PackagePlus, PackageX, Undo2 } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { LABELS_STATUT_COMMANDE, STATUTS_NON_LIVRAISON } from '@/lib/statuts';
import { MarchandKpiCard } from '@/components/marchand/MarchandKpiCard';
import { MarchandAgendaPanel } from '@/components/marchand/MarchandAgendaPanel';

interface DashboardData {
  kpi: {
    totalColis: number;
    colisLivres: number;
    colisEnCours: number;
    demandesRamassage: number;
    totalCod: number;
    tauxLivre: number;
    tauxRetourne: number;
    tauxAnnule: number;
  };
  evolution7j: { date: string; label: string; count: number }[];
  paiements7j: { date: string; label: string; paye: number; enAttente: number }[];
  statutRepartition: { statut: string; count: number }[];
  derniersColis: Commande[];
  aTraiterAujourdhui: { id: string; codeSuivi: string; clientNom: string; ville: string; statut: string; dateCreation: string }[];
  derniersClients: { nom: string; ville: string; date: string }[];
}

// Anomalies / échecs d'appel / retours-annulations : au-delà du sous-ensemble
// "non-livraison" déjà partagé avec l'admin, on y ajoute les statuts
// terminaux négatifs (retour, annulation) et les relances sans réponse.
const STATUTS_ALERTE = new Set<string>([
  ...STATUTS_NON_LIVRAISON,
  'deuxieme_appel_pas_reponse',
  'troisieme_appel_pas_reponse',
  'retourne',
  'en_retour_par_amana',
  'annule',
  'annule_par_vendeur',
]);

// Palette du donut : mêmes teintes pastel que les cartes KPI et le chart
// hebdomadaire (jaune #FFF8DB / indigo #EEF2FF).
const JAUNE_PASTEL = '#FFF8DB';
const INDIGO_PASTEL = '#EEF2FF';
// Palette de l'icône dans le flux d'activité : mêmes 2 familles, en version
// vive pour rester lisible sur un fond pastel à 15% d'opacité.
const JAUNE_VIF = '#FFC909';
const INDIGO_VIF = '#6366F1';

const STATUT_META: Record<string, { label: string; colorPastel: string; colorVif: string }> = Object.fromEntries(
  Object.entries(LABELS_STATUT_COMMANDE).map(([statut, label]) => {
    const alerte = STATUTS_ALERTE.has(statut);
    return [statut, { label, colorPastel: alerte ? INDIGO_PASTEL : JAUNE_PASTEL, colorVif: alerte ? INDIGO_VIF : JAUNE_VIF }];
  }),
);

// Palette alternée à 2 tons du chart hebdomadaire, en version pastel claire
// (mêmes teintes que le fond des cartes KPI : jaune #FFF8DB / indigo #EEF2FF)
// plutôt que les tons vifs — indépendante de STATUT_META.
const BAR_COLORS = ['#FFF8DB', '#EEF2FF'];

function dateRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.round(diffMs / 3_600_000);
  if (diffH < 1) return "à l'instant";
  if (diffH < 24) return `il y a ${diffH} h`;
  return `il y a ${Math.round(diffH / 24)} j`;
}

function TooltipStatut({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-xl border border-black/10 bg-white/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur dark:border-white/10 dark:bg-black/95">
      <span className="font-semibold">{STATUT_META[p.name]?.label ?? p.name}</span> — {p.value} colis
    </div>
  );
}

function TooltipEvolution({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-black/10 bg-white/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur dark:border-white/10 dark:bg-black/95">
      <p className="font-bold capitalize">{label}</p>
      <span className="font-semibold">{payload[0].value}</span> expédition(s)
    </div>
  );
}

function TooltipPaiements({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const paye = payload.find((p) => p.dataKey === 'paye')?.value ?? 0;
  const enAttente = payload.find((p) => p.dataKey === 'enAttente')?.value ?? 0;
  return (
    <div className="rounded-xl border border-black/10 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-white/10 dark:bg-black/95">
      <p className="mb-1 font-bold capitalize">{label}</p>
      <p className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[#eda100]" /> Encaissé :{' '}
        <span className="font-semibold">{paye.toLocaleString('fr-FR')} DH</span>
      </p>
      <p className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-gray-400" /> En attente :{' '}
        <span className="font-semibold">{enAttente.toLocaleString('fr-FR')} DH</span>
      </p>
    </div>
  );
}

// Badge flottant "meilleur jour" superposé à la barre concernée, dans l'esprit
// du "95% Wednesday" de la maquette de référence — dérivé du vrai maximum de
// la semaine, jamais d'une valeur inventée.
function bestDayBadge(bestIndex: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme exacte des props imposée par recharts (LabelList content)
  return function BestDayBadge(props: any) {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const width = Number(props.width ?? 0);
    const index = props.index as number | undefined;
    const value = props.value as number | undefined;
    if (index !== bestIndex || !value) return null;
    const cx = x + width / 2;
    return (
      <g>
        <rect
          x={cx - 36}
          y={y - 30}
          width={72}
          height={22}
          rx={11}
          className="fill-white stroke-black/10 dark:fill-neutral-900 dark:stroke-white/10"
          strokeWidth={1}
        />
        <text x={cx} y={y - 15} textAnchor="middle" fontSize={11} fontWeight={700} className="fill-black dark:fill-white">
          {value} colis
        </text>
      </g>
    );
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<DashboardData>('/api/marchands/dashboard')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  if (error) return <p className="text-sm font-medium text-red-600">{error}</p>;
  if (!data) return <p className="opacity-60">Chargement…</p>;

  const totalStatuts = data.statutRepartition.reduce((acc, s) => acc + s.count, 0);
  const bestIndex = data.evolution7j.reduce(
    (best, cur, i, arr) => (cur.count > arr[best].count ? i : best),
    0,
  );

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="page-title">Dashboard</h1>
          <Link href="/marchand/colis/nouveau" className="btn-primary flex items-center gap-2">
            <PackagePlus className="h-4 w-4" />
            Nouveau colis
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MarchandKpiCard icon={PackageCheck} label="Taux livré" value={`${data.kpi.tauxLivre.toLocaleString('fr-FR')}%`} tint={0} />
          <MarchandKpiCard icon={Undo2} label="Taux retourné" value={`${data.kpi.tauxRetourne.toLocaleString('fr-FR')}%`} tint={1} />
          <MarchandKpiCard icon={PackageX} label="Taux annulé" value={`${data.kpi.tauxAnnule.toLocaleString('fr-FR')}%`} tint={0} />
          <MarchandKpiCard icon={Wallet} label="Total COD (DH)" value={data.kpi.totalCod.toLocaleString('fr-FR')} tint={1} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="glass-card rounded-3xl">
            <h2 className="mb-3 text-sm font-bold">Répartition des statuts</h2>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="relative sm:w-1/2">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={data.statutRepartition}
                      dataKey="count"
                      nameKey="statut"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={2}
                      strokeWidth={2}
                      stroke="#ffffff"
                      isAnimationActive={false}
                    >
                      {data.statutRepartition.map((s) => (
                        <Cell key={s.statut} fill={STATUT_META[s.statut]?.colorPastel ?? JAUNE_PASTEL} />
                      ))}
                    </Pie>
                    <Tooltip content={<TooltipStatut />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-black dark:text-white">{totalStatuts}</span>
                  <span className="text-xs text-slate-400">Colis</span>
                </div>
              </div>
              <ul className="flex w-full flex-col gap-1.5 text-sm sm:w-1/2">
                {data.statutRepartition.map((s) => (
                  <li key={s.statut} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: STATUT_META[s.statut]?.colorPastel ?? JAUNE_PASTEL }}
                      />
                      {STATUT_META[s.statut]?.label ?? s.statut}
                    </span>
                    <span className="font-semibold opacity-70">
                      {s.count} {totalStatuts > 0 ? `(${Math.round((s.count / totalStatuts) * 100)}%)` : ''}
                    </span>
                  </li>
                ))}
                {totalStatuts === 0 && <li className="opacity-60">Aucune donnée</li>}
              </ul>
            </div>
          </div>

          <div className="glass-card rounded-3xl">
            <h2 className="mb-3 text-sm font-bold">Statistiques hebdomadaires des livraisons</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.evolution7j} margin={{ top: 30, right: 8, left: -20, bottom: 0 }} barCategoryGap="30%" barGap={0}>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }} />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }}
                />
                <Tooltip content={<TooltipEvolution />} cursor={{ fill: 'currentColor', fillOpacity: 0.06 }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                  {data.evolution7j.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                  <LabelList dataKey="count" content={bestDayBadge(bestIndex)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card rounded-3xl">
          <div className="mb-3 flex items-center gap-4">
            <h2 className="text-sm font-bold">Suivi des revenus</h2>
            <span className="flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
              <span className="h-2 w-2 rounded-full bg-[#eda100]" /> Encaissé
            </span>
            <span className="flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
              <span className="h-2 w-2 rounded-full bg-gray-400" /> En attente
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.paiements7j} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }} />
              <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }} />
              <Tooltip content={<TooltipPaiements />} cursor={{ stroke: 'currentColor', strokeOpacity: 0.15 }} />
              <Line type="monotone" dataKey="paye" stroke="#eda100" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line
                type="monotone"
                dataKey="enAttente"
                stroke="#9ca3af"
                strokeWidth={2.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card rounded-3xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">Activité récente</h2>
            <Link href="/marchand/colis" className="text-sm font-semibold text-brand-foreground hover:underline dark:text-brand">
              Voir tout
            </Link>
          </div>
          <ul className="flex flex-col gap-1">
            {data.derniersColis.map((c) => {
              const meta = STATUT_META[c.statut];
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-brand/[0.08]">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${meta?.colorVif ?? JAUNE_VIF}22`, color: meta?.colorVif ?? JAUNE_VIF }}
                  >
                    <Package className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {c.clientNom} · {c.ville}
                    </p>
                    <p className="truncate text-xs text-black/50 dark:text-white/50">
                      {c.codeSuivi} · {meta?.label ?? c.statut}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-black/40 dark:text-white/40">{dateRelative(c.dateCreation)}</span>
                </li>
              );
            })}
            {data.derniersColis.length === 0 && <li className="py-4 text-center text-sm opacity-50">Aucun colis</li>}
          </ul>
        </div>
      </div>

      <div className="w-full shrink-0 xl:w-80">
        <MarchandAgendaPanel aTraiterAujourdhui={data.aTraiterAujourdhui} derniersClients={data.derniersClients} />
      </div>
    </div>
  );
}
