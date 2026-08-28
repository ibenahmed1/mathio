'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { Logo } from '@/components/Logo';

// `permission` restreint l'affichage d'un item aux comptes qui détiennent
// cette permission (§ lib/permissions.ts) — c'est la même clé que celle
// exigée par le chemin de l'item dans lib/permission-routes.ts, de sorte que
// la barre latérale ne montre jamais un lien qui renverrait un 403. Omis =
// visible à tout compte ayant accès à l'espace courant.
//
// `roles` reste pour les navigations qui ne sont pas gouvernées par le
// catalogue (espaces marchand et terrain).
export type NavLeaf = { label: string; href: string; icon: React.ComponentType<{ className?: string }>; section?: string; roles?: string[]; permission?: string };
export type NavGroup = { label: string; icon: React.ComponentType<{ className?: string }>; children: NavLeaf[]; section?: string; roles?: string[]; permission?: string };
export type NavItem = NavLeaf | NavGroup;

function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

function isActiveHref(pathname: string, href: string) {
  return pathname === href;
}

function groupContainsActive(pathname: string, group: NavGroup) {
  return group.children.some((c) => isActiveHref(pathname, c.href));
}

// Regroupe les items consécutifs partageant le même `section` sous une même
// carte pastel, pour isoler visuellement un domaine (ex. "Marchandise") du
// reste de la navigation. Les items sans `section` restent affichés seuls.
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

export function AppSidebar({
  nav,
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapse,
}: {
  nav: NavItem[];
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  // Optionnel : les espaces dont la barre reste toujours dépliée n'en ont pas
  // besoin — le bouton n'est alors simplement pas rendu.
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
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

  function renderItem(item: NavItem) {
    if (isGroup(item)) {
      const Icon = item.icon;
      const open = !collapsed && (openGroups[item.label] ?? false);
      const active = groupContainsActive(pathname, item);
      return (
        <li key={item.label}>
          <button
            onClick={() => toggleGroup(item.label)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              active ? 'bg-brand/15 text-brand-ink dark:text-brand' : 'text-black/70 hover:bg-black/[0.04] dark:text-white/70 dark:hover:bg-white/5'
            }`}
            title={item.label}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className={collapsed ? 'lg:hidden' : 'flex-1 text-left'}>{item.label}</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${collapsed ? 'lg:hidden' : ''}`}
            />
          </button>
          {open && (
            <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-brand/20 pl-5">
              {item.children.map((child) => {
                const ChildIcon = child.icon;
                const childActive = isActiveHref(pathname, child.href);
                return (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={onCloseMobile}
                      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                        childActive
                          ? 'bg-brand/15 font-semibold text-brand-ink dark:text-brand'
                          : 'text-black/60 hover:bg-black/[0.04] hover:text-black dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white'
                      }`}
                    >
                      <ChildIcon className="h-4 w-4 shrink-0" />
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
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
            active
              ? 'bg-brand text-brand-foreground shadow-sm shadow-brand/30'
              : 'text-black/70 hover:bg-black/[0.04] dark:text-white/70 dark:hover:bg-white/5'
          }`}
          title={item.label}
        >
          <Icon className="h-5 w-5 shrink-0" />
          <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
        </Link>
      </li>
    );
  }

  const blocks = groupBySection(nav);

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
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-white text-black shadow-[4px_0_24px_-12px_rgba(0,0,0,0.12)] transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 dark:bg-neutral-950 dark:text-white dark:shadow-none dark:border-r dark:border-white/10 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'w-64 lg:w-20' : 'w-64'}`}
      >
        {/* Le repli se commande depuis la barre — même règle que l'espace
            admin : posé dans le contenu, ce bouton volait une gouttière à
            chaque page. Replié, il passe sous le logo, faute de largeur. */}
        <div
          className={`flex items-center gap-2 px-4 py-5 ${
            collapsed ? 'justify-between lg:flex-col lg:justify-center lg:gap-3 lg:px-2' : 'justify-between'
          }`}
        >
          <div className={collapsed ? 'lg:hidden' : ''}>
            <Logo />
          </div>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden shrink-0 rounded-lg border border-black/10 bg-white p-1.5 text-black/55 shadow-sm transition hover:border-brand hover:bg-brand/10 hover:text-black lg:grid lg:place-items-center dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:text-white"
              aria-label={collapsed ? 'Étendre la barre latérale' : 'Réduire la barre latérale'}
              title={collapsed ? 'Étendre la barre latérale' : 'Réduire la barre latérale'}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
          <button
            onClick={onCloseMobile}
            className="rounded p-1 text-black/50 hover:text-brand-ink lg:hidden dark:text-white/60 dark:hover:text-brand"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <div className="flex flex-col gap-5">
            {blocks.map((block, i) => {
              if (!block.section) {
                return (
                  <ul key={`plain-${i}`} className="flex flex-col gap-1">
                    {block.items.map(renderItem)}
                  </ul>
                );
              }
              return (
                <div key={block.section}>
                  <p
                    className={`mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-black/40 dark:text-white/40 ${
                      collapsed ? 'lg:hidden' : ''
                    }`}
                  >
                    {block.section}
                  </p>
                  <ul
                    className={`flex flex-col gap-1 rounded-2xl border border-brand/20 bg-brand/[0.10] p-1.5 dark:border-brand/10 dark:bg-brand/[0.06] ${
                      collapsed ? 'lg:border-0 lg:bg-transparent lg:p-0' : ''
                    }`}
                  >
                    {block.items.map(renderItem)}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>
      </aside>
    </>
  );
}
