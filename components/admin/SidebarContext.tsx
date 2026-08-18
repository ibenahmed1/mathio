'use client';

import { createContext, useContext } from 'react';

type SidebarControls = {
  collapsed: boolean;
  toggleCollapse: () => void;
  openMobile: () => void;
};

export const SidebarContext = createContext<SidebarControls | null>(null);

// Consommé par les pages qui masquent l'AppHeader générique (§ hideHeaderFor
// dans AdminShell) mais doivent tout de même exposer un moyen de replier/ouvrir
// la sidebar depuis leur propre en-tête (cf. SidebarToggleButtons).
export function useSidebarControls() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebarControls doit être utilisé sous AdminShell');
  return ctx;
}
