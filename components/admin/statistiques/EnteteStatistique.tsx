'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
// Import depuis le NOYAU et non depuis '@/lib/statistiques' : ce composant est
// client, et statistiques.ts tire prisma → pg → fs, ce qui fait échouer le
// bundler avec une erreur dont la pile ne nomme même pas la vraie cause.
import { LABELS_PRESET, PRESETS_PERIODE } from '@/lib/statistiques-core';

const ONGLETS = [
  { label: 'Tout', href: '/admin/statistique/tout' },
  { label: 'Livreur', href: '/admin/statistique/livreur' },
  { label: 'Ville', href: '/admin/statistique/ville' },
  { label: 'Zone', href: '/admin/statistique/zone' },
  { label: 'Client', href: '/admin/statistique/client' },
  { label: 'Comparer', href: '/admin/statistique/comparer' },
];

// En-tête commun aux six pages de statistiques.
//
// Il n'utilise pas PageTabs parce qu'il doit faire une chose que PageTabs ne
// fait pas : REPORTER la période courante sur chaque lien. Sans ça, passer de
// « Livreur » à « Ville » retomberait sur la période par défaut, et on
// comparerait sans le savoir deux intervalles différents.
export function EnteteStatistique() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const periode = searchParams.get('periode');

  function avecPeriode(href: string) {
    return periode ? `${href}?periode=${periode}` : href;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Statistiques</h1>

        <div className="flex flex-wrap items-center gap-1">
          {PRESETS_PERIODE.map((p) => {
            const actif = (periode ?? '30j') === p;
            return (
              <Link
                key={p}
                href={`${pathname}?periode=${p}`}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition pointer-coarse:py-3 ${
                  actif
                    ? 'bg-brand text-brand-foreground'
                    : 'text-black/55 hover:bg-black/5 dark:text-white/55 dark:hover:bg-white/10'
                }`}
              >
                {LABELS_PRESET[p]}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Onglets sur UNE ligne qui défile plutôt qu'en retour à la ligne : six
          onglets repliés sur deux rangées ne se lisent plus comme une barre.
          Le filet du bas est une ombre interne et non une bordure : avec une
          bordure, le soulignement actif devait la chevaucher d'un pixel
          (-mb-px), débordement qu'un conteneur défilant rogne — et qu'il fait
          défiler verticalement. */}
      <div className="scrollbar-none flex flex-nowrap gap-1 overflow-x-auto shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)] dark:shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]">
        {ONGLETS.map((onglet) => {
          const actif = pathname === onglet.href;
          return (
            <Link
              key={onglet.href}
              href={avecPeriode(onglet.href)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition pointer-coarse:py-3 ${
                actif
                  ? 'border-brand text-black dark:text-white'
                  : 'border-transparent text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white'
              }`}
            >
              {onglet.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
