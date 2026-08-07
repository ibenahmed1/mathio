'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AppHeader } from '@/components/AppHeader';
import { NAV_ADMIN, filterNavByRole } from '@/components/admin/nav';
import type { Role } from '@/app/generated/prisma/enums';

// Le board Kanban (§ /admin/tasks) porte son propre en-tête (fil d'ariane +
// titre + actions, cf. reference-board-light.html) : la barre "Administrateur
// / Mon compte" fait doublon et mange de la hauteur utile, donc on la masque
// sur cette page. La sidebar reste affichée pour garder la navigation admin.
// Revers : sur mobile, le bouton d'ouverture de la sidebar vit dans cette
// barre — elle reste donc repliée sur /admin/tasks en mobile.
function hideHeaderFor(pathname: string | null) {
  return !!pathname && pathname.startsWith('/admin/tasks');
}

export function AdminShell({ adminName, role, children }: { adminName: string; role: Role; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const showHeader = !hideHeaderFor(pathname);
  const nav = filterNavByRole(NAV_ADMIN, role);

  return (
    <div className="min-h-screen bg-white dark:bg-black lg:flex">
      <AdminSidebar
        nav={nav}
        adminName={adminName}
        role={role}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {showHeader && (
          <AppHeader
            title={adminName}
            profileHref="/admin/parametres"
            collapsed={collapsed}
            onToggleMobile={() => setMobileOpen(true)}
            onToggleCollapse={() => setCollapsed((v) => !v)}
          />
        )}
        <main className={showHeader ? 'flex-1 p-4 sm:p-6' : 'flex-1'}>{children}</main>
      </div>
    </div>
  );
}
