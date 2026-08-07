'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, ChevronDown, UserRound, LogOut } from 'lucide-react';
import { apiPost } from '@/lib/api-client';

export function AppHeader({
  title,
  profileHref,
  collapsed,
  onToggleMobile,
  onToggleCollapse,
  search,
}: {
  title: string | null;
  profileHref: string;
  collapsed: boolean;
  onToggleMobile: () => void;
  onToggleCollapse: () => void;
  search?: React.ReactNode;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function handleLogout() {
    await apiPost('/api/auth/logout');
    router.push('/login');
  }

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/[0.06] bg-white/90 px-4 py-3.5 backdrop-blur-sm dark:border-white/10 dark:bg-black/90">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onToggleMobile}
          className="shrink-0 rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/10 lg:hidden"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={onToggleCollapse}
          className="hidden shrink-0 rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/10 lg:flex"
          aria-label={collapsed ? 'Étendre la barre latérale' : 'Réduire la barre latérale'}
        >
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
        <span className="truncate text-lg font-black tracking-tight">{title ?? ' '}</span>
      </div>

      {search && <div className="hidden flex-1 justify-center px-4 sm:flex">{search}</div>}

      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full border border-brand/20 bg-brand/[0.08] px-3 py-1.5 text-sm font-semibold hover:bg-brand/[0.15] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
        >
          <UserRound className="h-4 w-4" />
          <span className="hidden sm:inline">Mon compte</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 w-48 rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-black">
            <Link
              href={profileHref}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-brand hover:text-brand-foreground"
            >
              <UserRound className="h-4 w-4" />
              Profil
            </Link>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-600 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Déconnexion
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
