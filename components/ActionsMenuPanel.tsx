'use client';

import { useCallback, useEffect, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// Panneau des menus « ⋮ » des listes (colis, bons d'envoi, de livraison, de
// préparation…).
//
// Il est rendu en PORTAIL sur document.body, en position fixe, et non en
// `absolute` dans la cellule : les tables vivent dans .table-card, qui clippe
// (coins arrondis) et dont le contenu défile horizontalement — un menu posé
// dans le flux y était donc coupé dès qu'il s'ouvrait sur une des dernières
// lignes, et emporté par le défilement latéral de la table.
//
// Le menu se recale au-dessus de son bouton quand il n'y a pas la place
// dessous, et se ferme au défilement, au redimensionnement, sur Échap et sur
// un clic à l'extérieur.

const MARGE = 8;

export function ActionsMenuPanel({
  anchorRef,
  open,
  onClose,
  width = 224,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  // Le placement se fait dans le callback de `ref`, pas dans un effet : il
  // s'exécute au montage du panneau, avant peinture, avec sa hauteur RÉELLE
  // sous la main — donc sans état intermédiaire ni frame où le menu
  // apparaîtrait au mauvais endroit.
  const placer = useCallback(
    (el: HTMLDivElement | null) => {
      const ancre = anchorRef.current;
      if (!el || !ancre) return;
      const rect = ancre.getBoundingClientRect();
      const hauteur = el.offsetHeight;
      const placeDessous = window.innerHeight - rect.bottom;
      const versLeHaut = placeDessous < hauteur + MARGE && rect.top > placeDessous;

      el.style.top = `${versLeHaut ? Math.max(MARGE, rect.top - hauteur - 4) : rect.bottom + 4}px`;
      // Aligné sur le bord DROIT du bouton (les menus de ligne sont en fin de
      // rangée), sans jamais sortir de la fenêtre.
      el.style.left = `${Math.min(Math.max(MARGE, rect.right - width), window.innerWidth - width - MARGE)}px`;
      el.style.visibility = 'visible';
    },
    [anchorRef, width]
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // En capture : la table défile dans son propre conteneur, un écouteur posé
    // sur window ne verrait pas cet évènement autrement.
    function onScrollOrResize() {
      onClose();
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90]" onClick={onClose} aria-hidden />
      <div
        ref={placer}
        role="menu"
        className="fixed top-0 left-0 z-[91] flex flex-col overflow-hidden rounded-xl border border-black/[0.07] bg-white py-1 shadow-[0_20px_45px_-15px_rgba(32,32,32,0.35)] dark:border-white/10 dark:bg-neutral-950"
        style={{ width, visibility: 'hidden' }}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

// Habillage commun d'une entrée de menu — repris tel quel par les cinq menus
// « ⋮ » de l'application pour qu'ils se ressemblent enfin.
export const actionsMenuItemClass =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-black/80 transition-colors hover:bg-brand/[0.14] hover:text-black dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white';

export const actionsMenuItemDangerClass =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400';
