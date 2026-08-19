'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import { AppSidebar } from '@/components/AppSidebar';
import { NAV_PLANNER } from './nav';

// Coquille de la web app Planner : même construction que LivreurShell
// (AppSidebar générique + en-tête à une ligne) plutôt qu'AdminShell, parce
// que le Planner n'est plus un utilisateur du back-office — il a son propre
// espace applicatif à trois écrans, utilisable au quai sur téléphone ou
// tablette comme sur poste fixe.
//
// Le hub de rattachement est affiché en permanence dans l'en-tête : c'est le
// périmètre que le serveur force sur chacune de ses requêtes
// (resolveHubPlanification, lib/bon-distribution.ts), autant qu'il le voie.
export function PlannerShell({
  plannerName,
  hubNom,
  children,
}: {
  plannerName: string;
  hubNom: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  async function handleLogout() {
    await apiPost('/api/auth/logout');
    router.push('/login');
  }

  return (
    <div className="shell-surface min-h-screen lg:flex">
      <AppSidebar
        nav={NAV_PLANNER}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="shrink-0 rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/10 lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="hidden shrink-0 rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/10 lg:flex"
              aria-label={collapsed ? 'Étendre la barre latérale' : 'Réduire la barre latérale'}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight">{plannerName}</p>
              <p className="flex items-center gap-1 truncate text-xs opacity-60">
                <Building2 className="h-3 w-3 shrink-0" />
                {hubNom ? `Hub ${hubNom}` : 'Tous les hubs'}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex shrink-0 items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100"
          >
            <LogOut className="h-4 w-4" />
            Déconnexion
          </button>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
