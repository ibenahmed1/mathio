'use client';

import Image from 'next/image';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Search, UserRound, X } from 'lucide-react';
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
  planner: 'Planner',
  // Ne s'affiche jamais dans cette barre : un compte de service de plateforme
  // partenaire ne peut pas ouvrir de session (SPACE_ROLES, lib/auth.ts).
  // L'entrée n'existe que parce que le type est exhaustif — et c'est bien
  // ainsi : elle documente le cas au lieu de le laisser tomber sur `undefined`.
  plateforme: 'Plateforme partenaire',
};

function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

function isActiveHref(pathname: string, href: string) {
  return pathname === href;
}

function groupContainsActive(pathname: string, group: NavGroup): boolean {
  return group.children.some((c) => (isGroup(c) ? groupContainsActive(pathname, c) : isActiveHref(pathname, c.href)));
}

// Le libellé seul ne suffit plus comme clé d'ouverture depuis que la
// navigation descend à trois niveaux : deux groupes homonymes sous deux
// parents différents s'ouvriraient ensemble. On préfixe donc par l'ancêtre.
function groupKey(parentKey: string, label: string) {
  return parentKey ? `${parentKey} / ${label}` : label;
}

function collectGroupKeys(nav: NavItem[], pathname: string, parentKey = '', into: Record<string, boolean> = {}) {
  for (const item of nav) {
    if (!isGroup(item)) continue;
    const key = groupKey(parentKey, item.label);
    into[key] = groupContainsActive(pathname, item);
    collectGroupKeys(item.children, pathname, key, into);
  }
  return into;
}

// La recherche doit atteindre les feuilles enfouies sous deux groupes (ex.
// « Pour zone » sous Factures & règlements > Bon de paiement) : on garde un
// groupe dont le libellé correspond — avec tous ses enfants — ou, à défaut,
// on le réduit aux branches qui correspondent.
function filtrerParRecherche(nav: NavItem[], q: string): NavItem[] {
  return nav.reduce<NavItem[]>((acc, item) => {
    const correspond = item.label.toLowerCase().includes(q);
    if (!isGroup(item)) {
      if (correspond) acc.push(item);
      return acc;
    }
    if (correspond) {
      acc.push(item);
      return acc;
    }
    const children = filtrerParRecherche(item.children, q);
    if (children.length > 0) acc.push({ ...item, children });
    return acc;
  }, []);
}

// Regroupe les items consécutifs partageant le même `section` sous un même
// intertitre (EXPLOITATION & LOGISTIQUE, FINANCE…). Les items sans `section`
// — Accueil, Statistique — restent en tête, sans intertitre.
function groupBySection(nav: NavItem[]): { section?: string; items: NavItem[] }[] {
  const blocks: { section?: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const last = blocks[blocks.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else blocks.push({ section: item.section, items: [item] });
  }
  return blocks;
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
  onToggleCollapse,
}: {
  nav: NavItem[];
  adminName: string;
  role: Role;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleCollapse: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => collectGroupKeys(nav, pathname));

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
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
  const items = !q ? nav : filtrerParRecherche(nav, q);
  const blocks = groupBySection(items);

  // `depth` : 0 = entrée de premier niveau (pastille d'icône, gros gabarit),
  // 1 et au-delà = sous-menu (gabarit compact). Un GROUPE de sous-menu garde
  // le gabarit compact mais reçoit son chevron.
  function renderItem(item: NavItem, parentKey = '', depth = 0): React.ReactNode {
    if (isGroup(item)) {
      const Icon = item.icon;
      const key = groupKey(parentKey, item.label);
      const open = !collapsed && (openGroups[key] ?? false);
      const active = groupContainsActive(pathname, item);
      const compact = depth > 0;
      return (
        <li key={key}>
          <button
            type="button"
            onClick={() => toggleGroup(key)}
            className={
              compact
                ? `${s.subNavItem} ${s.subNavGroupBtn} ${active ? s.subNavItemActive : ''}`
                : `${s.navItem} ${active ? s.navItemActive : ''}`
            }
            title={item.label}
          >
            {compact ? (
              <Icon className="h-3.5 w-3.5" />
            ) : (
              <span className={s.navIcon}>
                <Icon className="h-4 w-4" />
              </span>
            )}
            <span className={`${s.navLabel} ${collapsed ? s.collapseHide : ''}`}>{item.label}</span>
            <ChevronDown
              className={`${s.navChevronIcon} ${open ? s.navChevronOpen : ''} ${collapsed ? s.collapseHide : ''}`}
            />
          </button>
          {open && (
            <ul className={`${s.subNav} ${compact ? s.subNavNested : ''}`}>
              {item.children.map((child) => renderItem(child, key, depth + 1))}
            </ul>
          )}
        </li>
      );
    }

    const Icon = item.icon;
    const active = isActiveHref(pathname, item.href);
    if (depth > 0) {
      return (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={onCloseMobile}
            className={`${s.subNavItem} ${active ? s.subNavItemActive : ''}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        </li>
      );
    }
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
        } ${collapsed ? `w-64 lg:w-20 ${s.sidebarCollapsed}` : 'w-64'}`}
      >
        {/* ---------- Logo ---------- */}
        {/* Le bouton de repli vit DANS la barre (et non dans le contenu de la
            page) : c'est la barre qu'il commande, et posé dehors il volait une
            gouttière à chaque page — d'où le décalage visible partout où la
            page porte son propre fond. Replié, il descend sous le logo
            (cf. .brandCollapsed) : 80px de large ne laissent pas la place aux
            deux côte à côte. */}
        <div className={`${s.brand} ${collapsed ? s.brandCollapsed : ''}`}>
          <div className={s.logoTile}>
            <Image src={LOGO} alt="Mathio Delivery" width={42} height={42} className={s.logoImg} priority />
          </div>
          <div className={`${s.brandText} ${collapsed ? s.collapseHide : ''}`}>
            <span className={s.brandName}>MATHIO</span>
            <span className={s.brandSub}>DELIVERY</span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            className={s.collapseBtn}
            aria-label={collapsed ? 'Étendre la barre latérale' : 'Réduire la barre latérale'}
            title={collapsed ? 'Étendre la barre latérale' : 'Réduire la barre latérale'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
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
        {/* Les intertitres de section (EXPLOITATION & LOGISTIQUE, FINANCE…)
            disparaissent une fois la barre repliée : à 80px il ne reste que
            les icônes, un intertitre n'y tiendrait pas. */}
        <nav className={s.nav}>
          {blocks.map((block, i) => (
            <div key={block.section ?? `plain-${i}`} className={s.navBlock}>
              {block.section && (
                <p className={`${s.navSection} ${collapsed ? s.collapseHide : ''}`}>{block.section}</p>
              )}
              <ul className={s.navList}>{block.items.map((it) => renderItem(it))}</ul>
            </div>
          ))}
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
