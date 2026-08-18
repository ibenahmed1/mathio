'use client';

import Image from 'next/image';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Search, UserRound, X } from 'lucide-react';
import type { NavItem, NavGroup } from '@/components/AppSidebar';
import type { Role } from '@/app/generated/prisma/enums';
import { apiPost } from '@/lib/api-client';
import s from './AdminSidebar.module.css';

const LOGO = '/mathio-logo.png';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  superviseur: 'Superviseur',
  moderateur: 'Modérateur',
  equipe_suivi: 'Agent',
  responsable: 'Responsable',
  marchand: 'Marchand',
  livreur: 'Livreur',
  ramasseur: 'Ramasseur',
  design: 'Design',
  gestionnaire_hub: 'Gestionnaire Hub',
  agent_hub: 'Agent Hub',
};

function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

function isActiveHref(pathname: string, href: string) {
  return pathname === href;
}

function groupContainsActive(pathname: string, group: NavGroup) {
  return group.children.some((c) => isActiveHref(pathname, c.href));
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

export function AdminSidebar({
  nav,
  adminName,
  role,
  collapsed,
  mobileOpen,
  onCloseMobile,
}: {
  nav: NavItem[];
  adminName: string;
  role: Role;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of nav) {
      if (isGroup(item)) initial[item.label] = groupContainsActive(pathname, item);
    }
    return initial;
  });

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  // Menu Profil/Déconnexion : rendu en portail sur document.body pour échapper
  // à `overflow: hidden` sur .sidebar (nécessaire pour clipper le contenu
  // pendant l'animation de repli), sinon le menu serait tronqué.
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileMenuRect, setProfileMenuRect] = useState<{ bottom: number; left: number; width: number } | null>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (profileBtnRef.current?.contains(target)) return;
      if (profileMenuRef.current?.contains(target)) return;
      setProfileMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [profileMenuOpen]);

  function toggleProfileMenu() {
    if (!profileMenuOpen && profileBtnRef.current) {
      const rect = profileBtnRef.current.getBoundingClientRect();
      setProfileMenuRect({ bottom: window.innerHeight - rect.top + 8, left: rect.left, width: rect.width });
    }
    setProfileMenuOpen((v) => !v);
  }

  async function handleLogout() {
    setProfileMenuOpen(false);
    await apiPost('/api/auth/logout');
    router.push('/login');
  }

  const q = query.trim().toLowerCase();
  const items = !q
    ? nav
    : nav.filter((item) =>
        isGroup(item)
          ? item.label.toLowerCase().includes(q) || item.children.some((c) => c.label.toLowerCase().includes(q))
          : item.label.toLowerCase().includes(q)
      );

  function renderItem(item: NavItem) {
    if (isGroup(item)) {
      const Icon = item.icon;
      const open = !collapsed && (openGroups[item.label] ?? false);
      const active = groupContainsActive(pathname, item);
      return (
        <li key={item.label}>
          <button
            type="button"
            onClick={() => toggleGroup(item.label)}
            className={`${s.navItem} ${active ? s.navItemActive : ''}`}
            title={item.label}
          >
            <span className={s.navIcon}>
              <Icon className="h-4 w-4" />
            </span>
            <span className={`${s.navLabel} ${collapsed ? s.collapseHide : ''}`}>{item.label}</span>
            <ChevronDown
              className={`${s.navChevronIcon} ${open ? s.navChevronOpen : ''} ${collapsed ? s.collapseHide : ''}`}
            />
          </button>
          {open && (
            <ul className={s.subNav}>
              {item.children.map((child) => {
                const ChildIcon = child.icon;
                const childActive = isActiveHref(pathname, child.href);
                return (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={onCloseMobile}
                      className={`${s.subNavItem} ${childActive ? s.subNavItemActive : ''}`}
                    >
                      <ChildIcon className="h-3.5 w-3.5" />
                      {child.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      );
    }

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
          <span className={`${s.navLabel} ${collapsed ? s.collapseHide : ''}`}>{item.label}</span>
        </Link>
      </li>
    );
  }

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
        className={`${s.sidebar} fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'w-64 lg:w-20' : 'w-64'}`}
      >
        {/* ---------- Logo ---------- */}
        <div className={s.brand}>
          <div className={s.logoTile}>
            <Image src={LOGO} alt="Mathio Delivery" width={42} height={42} className={s.logoImg} priority />
          </div>
          <div className={`${s.brandText} ${collapsed ? s.collapseHide : ''}`}>
            <span className={s.brandName}>MATHIO</span>
            <span className={s.brandSub}>DELIVERY</span>
          </div>
          <button onClick={onCloseMobile} className={`${s.closeBtn} lg:hidden`} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---------- Recherche ---------- */}
        <div className={`${s.search} ${collapsed ? s.collapseHide : ''}`}>
          <Search className={s.searchIconSvg} />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
          />
        </div>

        {/* ---------- Navigation ---------- */}
        <nav className={s.nav}>
          <ul className={s.navList}>{items.map(renderItem)}</ul>
        </nav>

        {/* ---------- Profil ---------- */}
        <button
          type="button"
          ref={profileBtnRef}
          onClick={toggleProfileMenu}
          className={`${s.profile} ${s.profileBtn}`}
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
        >
          <span className={s.profileAvatar}>{initialsOf(adminName).toUpperCase() || 'AD'}</span>
          <span className={`${s.profileText} ${collapsed ? s.collapseHide : ''}`}>
            <span className={s.profileName}>{adminName}</span>
            <span className={s.profileRole}>{ROLE_LABELS[role]}</span>
          </span>
        </button>
      </aside>
      {profileMenuOpen &&
        profileMenuRect &&
        createPortal(
          <div
            ref={profileMenuRef}
            role="menu"
            className={s.profileMenu}
            style={{ bottom: profileMenuRect.bottom, left: profileMenuRect.left, width: profileMenuRect.width }}
          >
            <Link
              href="/admin/parametres"
              role="menuitem"
              onClick={() => setProfileMenuOpen(false)}
              className={s.profileMenuItem}
            >
              <UserRound className="h-4 w-4" />
              Profil
            </Link>
            <button type="button" role="menuitem" onClick={handleLogout} className={`${s.profileMenuItem} ${s.profileMenuItemDanger}`}>
              <LogOut className="h-4 w-4" />
              Déconnexion
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
