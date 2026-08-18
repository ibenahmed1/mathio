import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

// Bouton standardisé de l'app (jetons --mt-* définis dans
// AdminSidebar.module.css sous `:global(:root)`, donc disponibles sur toute
// page /admin/**) — reprend à l'identique le style de référence "+ Nouvelle
// transaction" (§ Comptabilité, components/accounting/Accounting.module.css
// .btnPrimary/.btnSecondary), extrait ici en composant réutilisable plutôt
// que dupliqué en CSS module par page.
const BASE =
  'inline-flex shrink-0 items-center gap-2 rounded-[var(--mt-r-md)] px-4 py-2.5 text-[13px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[image:var(--mt-gradient)] text-[color:var(--mt-ink)] shadow-[var(--mt-glow)] hover:-translate-y-0.5 active:translate-y-0',
  secondary:
    'border border-[color:var(--mt-line-2)] bg-[color:var(--mt-surface)] text-[color:var(--mt-ink-2)] hover:border-[color:var(--mt-yellow)]',
};

// Exposé pour les rares cas où l'élément ne peut pas être un <button> (ex.
// <Link> stylé comme une action secondaire) — évite de dupliquer BASE/VARIANTS.
export function buttonClassName(variant: ButtonVariant = 'primary', className = ''): string {
  return `${BASE} ${VARIANTS[variant]} ${className}`;
}

export const buttonFontStyle = { fontFamily: 'var(--mt-font)' } as const;

export function Button({ variant = 'primary', icon, className = '', children, style, ...props }: ButtonProps) {
  return (
    <button className={buttonClassName(variant, className)} style={{ ...buttonFontStyle, ...style }} {...props}>
      {icon}
      {children}
    </button>
  );
}
