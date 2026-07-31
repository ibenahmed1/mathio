import { TrendingDown, TrendingUp } from 'lucide-react';

interface KpiColorway {
  bg: string;
  border: string;
  iconBg: string;
  accentText: string;
}

// Seules les 2 teintes validées sont conservées (indigo / ambre), alternées
// sur les cartes KPI du dashboard.
const KPI_COLORWAYS: KpiColorway[] = [
  { bg: 'bg-[#EEF2FF] dark:bg-[#6366F1]/10', border: 'border-[#6366F1]/15', iconBg: 'bg-[#6366F1]/15', accentText: 'text-[#6366F1]' },
  { bg: 'bg-[#FFF8DB] dark:bg-[#FFC909]/10', border: 'border-[#FFC909]/20', iconBg: 'bg-[#FFC909]/20', accentText: 'text-[#FFC909]' },
];

export function MarchandKpiCard({
  icon: Icon,
  label,
  value,
  tint = 0,
  trendPct,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** Index 0-1 : indigo, ambre. */
  tint?: 0 | 1;
  /** Variation en % vs la période précédente, uniquement si réellement calculée (jamais inventée). */
  trendPct?: number;
}) {
  const c = KPI_COLORWAYS[tint];
  return (
    <div
      className={`relative rounded-3xl border p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${c.bg} ${c.border}`}
    >
      {trendPct !== undefined && (
        <span
          className={`trend-pill absolute right-4 top-4 ${
            trendPct >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
          }`}
        >
          {trendPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {trendPct >= 0 ? '+' : ''}
          {trendPct}%
        </span>
      )}
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${c.iconBg} ${c.accentText}`}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-3xl font-bold leading-tight text-slate-900 dark:text-white">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/55">{label}</p>
    </div>
  );
}
