'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

// Boîte de dialogue standard du back-office. Reprend les jetons du système
// (rayon, filet, halo jaune de l'en-tête) pour que toutes les fenêtres de
// l'application se ressemblent, quelle que soit la page qui les ouvre.
export function Modal({
  title,
  onClose,
  children,
  size = 'md',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  // Échap ferme, et le fond de page ne défile plus derrière la fenêtre :
  // sans ça, la molette faisait glisser la liste sous la boîte ouverte.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_30px_70px_-20px_rgba(32,32,32,0.45)] dark:border-white/10 dark:bg-neutral-950`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bandeau jaune de 3px : la même signature que les fenêtres « design »
            de l'app (cf. .mtModal::before dans app/globals.css). */}
        <div className="h-[3px] shrink-0 bg-[linear-gradient(90deg,#FFEE32,#FFD100_55%,rgba(255,209,0,0))]" />
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-black/[0.06] px-5 py-4 dark:border-white/10">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon border border-black/10 bg-white text-black/50 hover:border-brand hover:bg-brand/10 hover:text-black dark:border-white/15 dark:bg-white/5 dark:text-white/60 dark:hover:text-white"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
