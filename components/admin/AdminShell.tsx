'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { SidebarContext } from '@/components/admin/SidebarContext';
import { SidebarToggleButtons } from '@/components/admin/SidebarToggleButtons';
import { NAV_ADMIN, filterNavByRole } from '@/components/admin/nav';
import type { Role } from '@/app/generated/prisma/enums';

// Le board Kanban (§ /admin/tasks) et la page Comptabilité (§ /admin/comptabilite)
// portent chacun leur propre en-tête (fil d'ariane + titre + actions) avec leur
// propre SidebarToggleButtons : la barre minimale ci-dessous ferait doublon sur
// ces pages, donc on la masque là uniquement.
function hideMinimalBarFor(pathname: string | null) {
  return !!pathname && (pathname.startsWith('/admin/tasks') || pathname.startsWith('/admin/comptabilite'));
}

export function AdminShell({ adminName, role, children }: { adminName: string; role: Role; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const showMinimalBar = !hideMinimalBarFor(pathname);
  const nav = filterNavByRole(NAV_ADMIN, role);

  return (
    <SidebarContext.Provider
      value={{ collapsed, toggleCollapse: () => setCollapsed((v) => !v), openMobile: () => setMobileOpen(true) }}
    >
      <div className="shell-surface mtContent min-h-screen lg:flex">
        <AdminSidebar
          nav={nav}
          adminName={adminName}
          role={role}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <main className={showMinimalBar ? 'flex-1 p-4 sm:p-6' : 'flex-1'}>
            {showMinimalBar ? (
              <div className="flex items-start gap-3">
                <SidebarToggleButtons className="mt-1 flex shrink-0 items-center gap-2" />
                <div className="min-w-0 flex-1">{children}</div>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
