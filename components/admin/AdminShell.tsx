'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { SidebarContext } from '@/components/admin/SidebarContext';
import { SidebarToggleButtons } from '@/components/admin/SidebarToggleButtons';
import { NAV_ADMIN, filterNavByPermissions } from '@/components/admin/nav';
import type { Role } from '@/app/generated/prisma/enums';

// Le repli de la barre latérale se commande désormais DEPUIS la barre
// elle-même (cf. AdminSidebar) : plus rien ne flotte dans le contenu des
// pages, et toutes les interfaces retrouvent la même gouttière à gauche.
//
// Ne subsiste dans le contenu que l'ouverture en MOBILE, où la barre est
// hors-écran et son bouton donc inatteignable. La page Comptabilité porte le
// sien dans son propre en-tête (§ SidebarToggleButtons) : on ne le doublonne
// pas ici.
function hideMobileBarFor(pathname: string | null) {
  return !!pathname && pathname.startsWith('/admin/comptabilite');
}

// Les pages qui gèrent elles-mêmes leur pleine largeur (Kanban, Comptabilité)
// ne veulent pas de la marge de la coquille.
function isFullBleed(pathname: string | null) {
  return !!pathname && (pathname.startsWith('/admin/tasks') || pathname.startsWith('/admin/comptabilite'));
}

export function AdminShell({
  adminName,
  role,
  permissions,
  children,
}: {
  adminName: string;
  role: Role;
  // Permissions effectives du compte (§ lib/permissions.ts), résolues côté
  // serveur par le layout : la barre latérale n'affiche que les modules
  // réellement ouverts. Purement cosmétique — le refus, lui, est prononcé par
  // le proxy, qui ne fait confiance à rien de ce qui vient du client.
  permissions: string[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const fullBleed = isFullBleed(pathname);
  const nav = filterNavByPermissions(NAV_ADMIN, role, permissions);

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
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {!hideMobileBarFor(pathname) && (
            <div className="px-4 pt-4 lg:hidden">
              <SidebarToggleButtons />
            </div>
          )}
          <main className={fullBleed ? 'min-w-0 flex-1' : 'min-w-0 flex-1 p-4 sm:p-6'}>{children}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
