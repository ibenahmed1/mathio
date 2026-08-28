'use client';

import { Menu } from 'lucide-react';
import { useSidebarControls } from './SidebarContext';

// Ouverture de la barre latérale en MOBILE uniquement : là, la barre est
// hors-écran et son propre bouton (repli/fermeture, cf. AdminSidebar) est
// donc inatteignable.
//
// Le repli desktop n'est plus rendu ici : il vit dans la barre elle-même, où
// il ne décale plus la mise en page des interfaces qui l'entouraient.
export function SidebarToggleButtons({ className }: { className?: string }) {
  const { openMobile } = useSidebarControls();

  return (
    <button
      onClick={openMobile}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white p-2 text-black/70 shadow-sm transition hover:border-brand hover:bg-brand/10 hover:text-black lg:hidden dark:border-white/15 dark:bg-white/5 dark:text-white/80 ${className ?? ''}`}
      aria-label="Ouvrir le menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
