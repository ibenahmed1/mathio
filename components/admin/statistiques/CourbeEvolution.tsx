'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PointEvolution } from '@/lib/statistiques-core';

// Trois séries et pas une de plus. La tentation serait d'empiler les vingt-huit
// statuts du pipeline : le graphe deviendrait un camaïeu illisible alors que la
// seule question posée ici est « ce que j'ai pris en charge, l'ai-je livré ? ».
// Le détail par statut est juste en dessous, dans son propre bloc.
const SERIES = [
  { key: 'livres', label: 'Livrés', couleur: '#ffd100' },
  { key: 'retournes', label: 'Retournés', couleur: '#ef4444' },
  { key: 'autres', label: 'En cours / annulés', couleur: '#9ca3af' },
] as const;

function Infobulle({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs shadow-md dark:border-white/10 dark:bg-black">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          {SERIES.find((s) => s.key === p.name)?.label ?? p.name} :{' '}
          <span className="font-semibold">{p.value}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-black/10 pt-1 font-semibold dark:border-white/10">
        Total : {total}
      </p>
    </div>
  );
}

export function CourbeEvolution({ data }: { data: PointEvolution[] }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm opacity-50">Aucun colis sur cette période.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.1} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
          // Sur 90 jours, un libellé par point se chevauche : recharts en
          // saute automatiquement dès qu'on lui laisse la main.
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={32}
          tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.6 }}
        />
        <Tooltip content={<Infobulle />} cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }} />
        <Legend
          formatter={(value) => (
            <span className="text-xs">{SERIES.find((s) => s.key === value)?.label ?? value}</span>
          )}
          iconType="circle"
          iconSize={8}
        />
        {SERIES.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.key}
            stackId="evolution"
            stroke={s.couleur}
            fill={s.couleur}
            fillOpacity={0.25}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
