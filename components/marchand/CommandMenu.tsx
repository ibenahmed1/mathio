'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, LayoutDashboard, Package, PackagePlus, FileStack, Truck, LifeBuoy } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Commande } from '@/lib/types';

const RACCOURCIS = [
  { label: 'Tableau de bord', href: '/marchand', icon: LayoutDashboard },
  { label: 'Colis', href: '/marchand/colis', icon: Package },
  { label: 'Nouveau colis', href: '/marchand/colis/nouveau', icon: PackagePlus },
  { label: 'Bons & Documents', href: '/marchand/bons-livraison', icon: FileStack },
  { label: 'Ramassages', href: '/marchand/ramassages', icon: Truck },
  { label: 'Support & Profil', href: '/marchand/reclamations', icon: LifeBuoy },
];

// Recherche globale (Ctrl+K / Cmd+K) : raccourcis de navigation + recherche
// de colis en direct. Le marchand ne devrait jamais avoir besoin de chercher
// dans la sidebar — tout objectif courant est à un raccourci ou une frappe.
export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [resultats, setResultats] = useState<Commande[]>([]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResultats([]);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResultats([]);
      return;
    }
    const timer = setTimeout(() => {
      apiGet<{ data: Commande[] }>(`/api/commandes?search=${encodeURIComponent(q)}&pageSize=6`)
        .then((res) => setResultats(res.data))
        .catch(() => setResultats([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function aller(href: string) {
    setOpen(false);
    router.push(href);
  }

  const raccourcisFiltres = RACCOURCIS.filter((r) => r.label.toLowerCase().includes(query.trim().toLowerCase()));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full max-w-xs items-center gap-2 rounded-md border border-black/10 px-3 py-1.5 text-sm text-black/50 transition hover:bg-black/5 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10"
      >
        <Search className="h-4 w-4" />
        Rechercher…
        <kbd className="ml-auto rounded border border-black/20 px-1.5 py-0.5 text-xs dark:border-white/20">Ctrl K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-24" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg rounded-xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-black"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
          <Search className="h-4 w-4 opacity-50" />
          <input
            autoFocus
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Rechercher un colis (code, destinataire) ou une page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {raccourcisFiltres.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase opacity-50">Navigation</p>
              {raccourcisFiltres.map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.href}
                    onClick={() => aller(r.href)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-brand hover:text-brand-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    {r.label}
                  </button>
                );
              })}
            </div>
          )}

          {resultats.length > 0 && (
            <div>
              <p className="px-2 py-1 text-xs font-semibold uppercase opacity-50">Colis</p>
              {resultats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => aller(`/marchand/colis/suivi?code=${encodeURIComponent(c.codeSuivi)}`)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-brand hover:text-brand-foreground"
                >
                  <span className="font-mono">{c.codeSuivi}</span>
                  <span className="opacity-60">
                    {c.clientNom} — {c.ville}
                  </span>
                </button>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && resultats.length === 0 && raccourcisFiltres.length === 0 && (
            <p className="px-2 py-4 text-center text-sm opacity-50">Aucun résultat</p>
          )}
        </div>
      </div>
    </div>
  );
}
