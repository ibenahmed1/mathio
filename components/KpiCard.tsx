export function KpiCard({
  icon: Icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /* Réservé à un seul KPI par tableau de bord : fond plein jaune de marque
     (comme la carte "héros" des maquettes de référence) au lieu du pastel
     doux utilisé par les autres cartes. */
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <div className="card-tint-strong flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/10 text-brand-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-2xl font-black leading-tight">{value}</p>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-ink dark:bg-brand/10 dark:text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-black leading-tight text-black dark:text-white">{value}</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">{label}</p>
      </div>
    </div>
  );
}
