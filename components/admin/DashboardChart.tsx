'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface VolumeJour {
  date: string;
  label: string;
  nouveau_colis: number;
  attente_de_ramassage: number;
  ramasse: number;
}

const SERIES: { key: keyof Omit<VolumeJour, 'date' | 'label'>; label: string; color: string }[] = [
  { key: 'nouveau_colis', label: 'Nouveau', color: '#9ca3af' },
  { key: 'attente_de_ramassage', label: 'Attente de ramassage', color: '#ffe066' },
  { key: 'ramasse', label: 'Ramassé', color: '#ffd100' },
];

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs shadow-md dark:border-white/10 dark:bg-black">
      <p className="mb-1 font-semibold capitalize">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          {SERIES.find((s) => s.key === p.name)?.label ?? p.name} : <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function DashboardChart({ data }: { data: VolumeJour[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.1} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'currentColor', opacity: 0.05 }} />
        <Legend
          formatter={(value) => <span className="text-xs">{SERIES.find((s) => s.key === value)?.label ?? value}</span>}
          iconType="circle"
          iconSize={8}
        />
        {SERIES.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.key} stackId="volume" fill={s.color} radius={0} maxBarSize={24} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
