'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { apiPost } from '@/lib/api-client';
import type { NavItem, NavGroup } from '@/components/AppSidebar';
import { SidebarIllustration } from './SidebarIllustration';

function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

function isActiveHref(pathname: string, href: string) {
  return pathname === href;
}

// Regroupe les items consécutifs partageant le même `section` (ex.
// "Marchandise") sous une même carte pastel isolée, comme dans AppSidebar.
function groupBySection(nav: NavItem[]): { section?: string; items: NavItem[] }[] {
  const blocks: { section?: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const last = blocks[blocks.length - 1];
    if (last && last.section === item.section) {
      last.items.push(item);
    } else {
      blocks.push({ section: item.section, items: [item] });
    }
  }
  return blocks;
}

export function MarchandSidebar({
  nav,
  autre,
  collapsed,
  mobileOpen,
  onCloseMobile,
}: {
  nav: NavItem[];
  /** Items rattachés au groupe "AUTRE" (ex: Support & Profil). */
  autre: NavItem[];
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await apiPost('/api/auth/logout');
    router.push('/login');
  }

  function renderLeaf(item: Extract<NavItem, { href: string }>) {
    const Icon = item.icon;
    const active = isActiveHref(pathname, item.href);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onCloseMobile}
          className={`flex items-center gap-3 py-2 text-sm font-semibold transition-all ${
            active
              ? 'rounded-r-2xl border-l-4 border-amber-400 bg-amber-100/60 pl-2 pr-3 text-amber-900 dark:border-amber-300/70 dark:bg-amber-400/10 dark:text-amber-200'
              : 'rounded-2xl px-3 text-black/70 hover:translate-x-0.5 hover:bg-black/[0.04] dark:text-white/70 dark:hover:bg-white/5'
          }`}
          title={item.label}
        >
          <Icon className="h-5 w-5 shrink-0" />
          <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
        </Link>
      </li>
    );
  }

  const menuBlocks = groupBySection(nav);

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Fermer le menu"
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen flex-col justify-between overflow-hidden border-r border-black/[0.06] bg-white/90 text-black backdrop-blur-xl transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 dark:border-white/10 dark:bg-neutral-950/90 dark:text-white ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'w-64 lg:w-20' : 'w-64'}`}
      >
        <div className="flex shrink-0 items-center justify-between px-5 py-3">
          <div className={collapsed ? 'lg:hidden' : ''}>
            <Logo />
          </div>
          <button
            onClick={onCloseMobile}
            className="rounded-full p-1 text-black/50 hover:text-brand-ink lg:hidden dark:text-white/60 dark:hover:text-brand"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-1">
          <div className="flex flex-col gap-3">
            <div>
              <p className={`mb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-black/35 dark:text-white/35 ${collapsed ? 'lg:hidden' : ''}`}>
                Menu
              </p>
              <div className="flex flex-col gap-2">
                {menuBlocks.map((block, i) => {
                  if (!block.section) {
                    return (
                      <ul key={`plain-${i}`} className="flex flex-col gap-0.5">
                        {block.items.filter((it): it is Extract<NavItem, { href: string }> => !isGroup(it)).map(renderLeaf)}
                      </ul>
                    );
                  }
                  return (
                    <div key={block.section}>
                      <p
                        className={`mb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-black/40 dark:text-white/40 ${
                          collapsed ? 'lg:hidden' : ''
                        }`}
                      >
                        {block.section}
                      </p>
                      <ul
                        className={`flex flex-col gap-0.5 rounded-3xl border border-brand/20 bg-brand/[0.10] p-1.5 dark:border-brand/10 dark:bg-brand/[0.06] ${
                          collapsed ? 'lg:border-0 lg:bg-transparent lg:p-0' : ''
                        }`}
                      >
                        {block.items.filter((it): it is Extract<NavItem, { href: string }> => !isGroup(it)).map(renderLeaf)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className={`mb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-black/35 dark:text-white/35 ${collapsed ? 'lg:hidden' : ''}`}>
                Autre
              </p>
              <ul className="flex flex-col gap-0.5">
                {autre.filter((it): it is Extract<NavItem, { href: string }> => !isGroup(it)).map(renderLeaf)}
                <li>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold text-red-600 transition-all hover:translate-x-0.5 hover:bg-red-600/10 dark:text-red-400"
                    title="Déconnexion"
                  >
                    <LogOut className="h-5 w-5 shrink-0" />
                    <span className={collapsed ? 'lg:hidden' : ''}>Déconnexion</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </nav>

        <div className={`shrink-0 px-4 pb-3 pt-1 ${collapsed ? 'lg:hidden' : ''}`}>
          <div className="rounded-3xl border border-brand/20 bg-brand/[0.12] px-3 pb-2.5 pt-2 text-center dark:border-brand/10 dark:bg-brand/[0.07]">
            <SidebarIllustration />
            <p className="mt-1 text-xs font-bold leading-tight text-black/80 dark:text-white/85">Livraison sans frontières</p>
          </div>
        </div>
      </aside>
    </>
  );
}
