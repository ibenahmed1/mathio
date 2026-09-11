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

  // Une seule rangée qui défile au doigt, plutôt qu'un retour à la ligne : à
  // 360 px, `flex-wrap` étalait les onglets sur deux ou trois rangées et le
  // soulignement de l'onglet actif flottait au milieu du bloc.
  //
  // Le filet de base est une ombre INTERNE et non une bordure : le conteneur
  // défile, donc clippe — l'onglet ne peut plus déborder d'un pixel (-mb-px)
  // pour recouvrir une bordure, il la ferait défiler verticalement. L'ombre
  // interne se peint sous les enfants : le soulignement actif la recouvre.
  return (
    <div className="scrollbar-none flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)] dark:shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">
      {tabs.map((tab) => {
        const active = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
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
