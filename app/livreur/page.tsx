'use client';

import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PackageCheck, Package, Share2 } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { DashboardLivreurStats } from '@/lib/types';
import { LivreurShell } from '@/components/livreur/LivreurShell';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

const DONUT_COLORS = ['#94a3b8', '#2563eb']; // nouveau (gris), en_cours (bleu)

function ProgressBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="font-bold">{pct}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function LivreurDashboardPage() {
  const [range, setRange] = useState(defaultRange());
  const [pendingRange, setPendingRange] = useState(range);
  const [data, setData] = useState<DashboardLivreurStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setError(null);
      apiGet<DashboardLivreurStats>(`/api/livreur/dashboard?from=${range.from}&to=${range.to}`)
        .then(setData)
        .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
    });
  }, [range]);

  const bd = data?.bonsDistribution;
  const donutData = bd ? [{ name: 'Nouveau', value: bd.nouveau }, { name: 'En cours', value: bd.enCours }] : [];

  return (
    <LivreurShell>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="page-title">Accueil</h1>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setRange(pendingRange);
            }}
          >
            <label className="flex flex-col gap-1 text-xs font-semibold opacity-70">
              Du
              <input
                type="date"
                className="input-basic"
                value={pendingRange.from}
                max={pendingRange.to}
                onChange={(e) => setPendingRange((r) => ({ ...r, from: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold opacity-70">
              Au
              <input
                type="date"
                className="input-basic"
                value={pendingRange.to}
                min={pendingRange.from}
                onChange={(e) => setPendingRange((r) => ({ ...r, to: e.target.value }))}
              />
            </label>
            <button type="submit" className="btn-primary">
              Filtrer
            </button>
          </form>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="card-tint-strong flex flex-col gap-4 p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <PackageCheck className="h-4 w-4" />
              Statistique des colis
            </h2>
            {data ? (
              <>
                <ProgressBar label="Colis livrés" pct={data.colis.tauxLivre} color="#16a34a" />
                <ProgressBar label="Colis retournés" pct={data.colis.tauxRetourne} color="#dc2626" />
                <p className="text-xs opacity-60">
                  {data.colis.total} colis sur la période — {data.colis.livres} livrés, {data.colis.retournes} retournés
                </p>
              </>
            ) : (
              <p className="text-sm opacity-60">Chargement…</p>
            )}
          </div>

          <div className="card-tint-strong flex flex-col gap-4 p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Share2 className="h-4 w-4" />
              Statistique des bons de distribution
            </h2>
            {bd ? (
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <div className="relative h-[160px] w-full sm:w-1/2">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={70}
                        paddingAngle={2}
                        strokeWidth={2}
                        stroke="#ffffff"
                        isAnimationActive={false}
                      >
                        {donutData.map((d, i) => (
                          <Cell key={d.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold">{bd.total}</span>
                    <span className="text-xs opacity-60">Enregistré</span>
                  </div>
                </div>
                <ul className="flex w-full flex-col gap-1.5 text-sm sm:w-1/2">
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DONUT_COLORS[0] }} />
                      Nouveau
                    </span>
                    <span className="font-semibold opacity-70">{bd.nouveau}</span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DONUT_COLORS[1] }} />
                      En cours
                    </span>
                    <span className="font-semibold opacity-70">{bd.enCours}</span>
                  </li>
                  <li className="flex items-center justify-between gap-2 border-t border-black/10 pt-1.5 dark:border-white/10">
                    <span className="flex items-center gap-2">
                      <Package className="h-3.5 w-3.5" />
                      Colis distribués
                    </span>
                    <span className="font-semibold opacity-70">{bd.nbColisTotal}</span>
                  </li>
                </ul>
              </div>
            ) : (
              <p className="text-sm opacity-60">Chargement…</p>
            )}
          </div>
        </div>
      </div>
    </LivreurShell>
  );
}
