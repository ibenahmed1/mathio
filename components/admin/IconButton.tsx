'use client';

// Bouton d'action icône seule, réutilisé partout où une liste admin a des
// actions répétées par ligne (zones/villes, équipe…) — la couleur porte le
// sens de l'action pour rester lisible sans libellé.
// Même gabarit que .btn-icon (app/globals.css) : 32px, rayon 10px, anneau de
// focus jaune — les actions de ligne s'alignent ainsi sur le reste du système.
const BASE =
  'inline-grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border bg-white shadow-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/5';

const VARIANT = {
  edit: 'border-black/10 text-blue-600 hover:border-blue-600 hover:bg-blue-600 hover:text-white dark:border-white/15 dark:text-blue-400',
  delete: 'border-black/10 text-red-600 hover:border-red-600 hover:bg-red-600 hover:text-white dark:border-white/15 dark:text-red-400',
  add: 'border-black/10 text-emerald-600 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white dark:border-white/15 dark:text-emerald-400',
  activate: 'border-black/10 text-green-600 hover:border-green-600 hover:bg-green-600 hover:text-white dark:border-white/15 dark:text-green-400',
  deactivate: 'border-black/10 text-orange-600 hover:border-orange-600 hover:bg-orange-600 hover:text-white dark:border-white/15 dark:text-orange-400',
  key: 'border-black/10 text-violet-600 hover:border-violet-600 hover:bg-violet-600 hover:text-white dark:border-white/15 dark:text-violet-400',
  wallet: 'border-black/10 text-indigo-600 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white dark:border-white/15 dark:text-indigo-400',
} as const;

export type IconButtonVariant = keyof typeof VARIANT;

export function IconButton({
  variant,
  label,
  onClick,
  disabled,
  children,
}: {
  variant: IconButtonVariant;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`${BASE} ${VARIANT[variant]}`}
    >
      {children}
    </button>
  );
}
