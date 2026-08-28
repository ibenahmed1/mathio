'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import { AppSidebar } from '@/components/AppSidebar';
import { NAV_LIVREUR } from './nav';

// Coquille desktop de l'espace livreur (sidebar à 6 sections, cf. nav.ts) —
// remplace l'ancienne coquille mobile-first à 2 onglets (Tournée/Caisse)
// désormais absorbée par les pages Colis et Bons de paiement. Réutilise
// AppSidebar (composant générique déjà prévu pour ça, jusqu'ici seulement
// utilisé pour son type NavItem) plutôt que de dupliquer AdminSidebar/
// MarchandSidebar pour un espace à une seule section de nav sans sous-menus.
export function LivreurShell({ children }: { children: React.ReactNode }) {
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
        nav={NAV_LIVREUR}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Le repli desktop vit désormais dans la barre (cf. AppSidebar) : ne
            reste ici que l'ouverture en mobile, où la barre est hors-écran. */}
        <header className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-3 dark:border-white/10">
          <button
            onClick={() => setMobileOpen(true)}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white p-2 text-black/70 shadow-sm transition hover:border-brand hover:bg-brand/10 hover:text-black lg:hidden dark:border-white/15 dark:bg-white/5 dark:text-white/80"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            onClick={handleLogout}
            className="ml-auto flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100"
          >
            <LogOut className="h-4 w-4" />
            Déconnexion
          </button>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
