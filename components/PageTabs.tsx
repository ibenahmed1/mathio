'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface PageTab {
  label: string;
  href: string;
}

// Onglets de navigation en haut de page, utilisés pour regrouper plusieurs
// routes existantes sous une même section (ex. Colis, Bons & Documents,
// Support & Profil) sans dupliquer les entrées dans la sidebar.
//
// Par défaut l'onglet actif est déterminé par correspondance exacte avec le
// pathname courant. Si un onglet distingue plusieurs vues d'une même route
// via un paramètre de requête (ex. /marchand/colis vs /marchand/colis?statut=en_attente),
// la page appelante doit calculer et passer `activeHref` (pathname + query).
export function PageTabs({ tabs, activeHref }: { tabs: PageTab[]; activeHref?: string }) {
  const pathname = usePathname();
  const current = activeHref ?? pathname;

  return (
    <div className="flex flex-wrap gap-1 border-b border-black/10 dark:border-white/10">
      {tabs.map((tab) => {
        const active = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
              active
                ? 'border-brand text-black dark:text-white'
                : 'border-transparent text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
