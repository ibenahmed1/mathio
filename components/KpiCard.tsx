export function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  highlight = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /* Une ligne de contexte sous le libellé, pour les chiffres dont l'intitulé
     ne suffit pas à dire ce qu'ils recouvrent (« Total à percevoir » : de quoi
     est-il fait ?). Omise, la carte garde exactement son gabarit d'avant. */
  hint?: string;
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
        <div className="min-w-0">
          <p className="text-2xl font-black leading-tight">{value}</p>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
          {hint && <p className="mt-0.5 text-[11px] leading-snug opacity-60">{hint}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-ink dark:bg-brand/10 dark:text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-black leading-tight text-black dark:text-white">{value}</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-black/45 dark:text-white/45">{hint}</p>}
      </div>
    </div>
  );
}
