'use client';

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebarControls } from './SidebarContext';

// Boutons de repli/ouverture de la sidebar pour les pages qui masquent
// l'AppHeader générique (§ hideHeaderFor dans AdminShell) et portent leur
// propre en-tête — même comportement que dans AppHeader (bouton "Menu" en
// mobile, bouton "Panel" en desktop), juste rendu ailleurs dans l'arbre.
export function SidebarToggleButtons({ className }: { className?: string }) {
  const { collapsed, toggleCollapse, openMobile } = useSidebarControls();

  return (
    <div className={className}>
      <button
        onClick={openMobile}
        className="shrink-0 rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/10 lg:hidden"
        aria-label="Ouvrir le menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        onClick={toggleCollapse}
        className="hidden shrink-0 rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/10 lg:flex"
        aria-label={collapsed ? 'Étendre la barre latérale' : 'Réduire la barre latérale'}
      >
        {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>
    </div>
  );
}
