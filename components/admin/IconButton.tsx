'use client';

// Bouton d'action icône seule, réutilisé partout où une liste admin a des
// actions répétées par ligne (zones/villes, équipe…) — la couleur porte le
// sens de l'action pour rester lisible sans libellé.
const BASE = 'inline-flex items-center justify-center rounded-md border p-1.5 transition disabled:opacity-50';

const VARIANT = {
  edit: 'border-black/15 text-blue-600 hover:border-blue-600 hover:bg-blue-600 hover:text-white dark:border-white/15 dark:text-blue-400',
  delete: 'border-black/15 text-red-600 hover:border-red-600 hover:bg-red-600 hover:text-white dark:border-white/15 dark:text-red-400',
  add: 'border-black/15 text-emerald-600 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white dark:border-white/15 dark:text-emerald-400',
  activate: 'border-black/15 text-green-600 hover:border-green-600 hover:bg-green-600 hover:text-white dark:border-white/15 dark:text-green-400',
  deactivate: 'border-black/15 text-orange-600 hover:border-orange-600 hover:bg-orange-600 hover:text-white dark:border-white/15 dark:text-orange-400',
  key: 'border-black/15 text-violet-600 hover:border-violet-600 hover:bg-violet-600 hover:text-white dark:border-white/15 dark:text-violet-400',
  wallet: 'border-black/15 text-indigo-600 hover:border-indigo-600 hover:bg-indigo-600 hover:text-white dark:border-white/15 dark:text-indigo-400',
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
