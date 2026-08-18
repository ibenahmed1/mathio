'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, X } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { NavItem, NavGroup } from '@/components/AppSidebar';
import s from './MarchandSidebar.module.css';

const LOGO = '/mathio-logo.png';

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

// La sidebar reste dépliée en permanence en desktop (aucun repli) : seul le
// panneau mobile s'ouvre et se ferme.
export function MarchandSidebar({
  nav,
  autre,
  mobileOpen,
  onCloseMobile,
}: {
  nav: NavItem[];
  /** Items rattachés au groupe "AUTRE" (ex: Support & Profil). */
  autre: NavItem[];
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
          className={`${s.navItem} ${active ? s.navItemActive : ''}`}
          title={item.label}
        >
          <span className={s.navIcon}>
            <Icon className="h-4 w-4" />
          </span>
          <span className={s.navLabel}>{item.label}</span>
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
        className={`${s.sidebar} fixed inset-y-0 left-0 z-40 w-64 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* ---------- Logo ---------- */}
        <div className={s.brand}>
          <div className={s.logoTile}>
            <Image src={LOGO} alt="Mathio Delivery" width={42} height={42} className={s.logoImg} priority />
          </div>
          <div className={s.brandText}>
            <span className={s.brandName}>MATHIO</span>
            <span className={s.brandSub}>DELIVERY</span>
          </div>
          {/* Fermeture du panneau mobile uniquement — masqué en desktop, où la
              sidebar reste dépliée en permanence. */}
          <button onClick={onCloseMobile} className={s.closeBtn} aria-label="Fermer le menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---------- Navigation ---------- */}
        <nav className={s.nav}>
          <div className={s.navGroups}>
            <div>
              <p className={s.sectionLabel}>Menu</p>
              <div className="flex flex-col gap-2">
                {menuBlocks.map((block, i) => {
                  if (!block.section) {
                    return (
                      <ul key={`plain-${i}`} className={s.navList}>
                        {block.items.filter((it): it is Extract<NavItem, { href: string }> => !isGroup(it)).map(renderLeaf)}
                      </ul>
                    );
                  }
                  return (
                    <div key={block.section}>
                      <p className={s.sectionLabel}>{block.section}</p>
                      <ul className={s.navList}>
                        {block.items.filter((it): it is Extract<NavItem, { href: string }> => !isGroup(it)).map(renderLeaf)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={s.navGroupsBottom}>
              <p className={s.sectionLabel}>Autre</p>
              <ul className={s.navList}>
                {autre.filter((it): it is Extract<NavItem, { href: string }> => !isGroup(it)).map(renderLeaf)}
                <li>
                  <button
                    onClick={handleLogout}
                    className={`${s.navItem} ${s.navItemDanger}`}
                    title="Déconnexion"
                  >
                    <span className={s.navIcon}>
                      <LogOut className="h-4 w-4" />
                    </span>
                    <span className={s.navLabel}>Déconnexion</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </nav>
      </aside>
    </>
  );
}
