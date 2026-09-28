import { ShoppingBag } from 'lucide-react';

// § Intégration YouCan — pendant de ShopifyTag : distingue un colis ou une
// marchandise venus d'une boutique YouCan. Déduit du lien (Commande.youcan,
// Marchandise.youcan), jamais d'un champ saisi.
//
// Pas de logo officiel dans public/logos : une icône générique en tient lieu.
export function YoucanTag({ detail, compact = false }: { detail?: string | null; compact?: boolean }) {
  const titre = detail ? `Importé de YouCan — ${detail}` : 'Importé de YouCan';
  return (
    <span
      title={titre}
      aria-label={titre}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold leading-none text-violet-800 dark:border-violet-400/40 dark:bg-violet-400/15 dark:text-violet-200"
    >
      <ShoppingBag className="h-3 w-3" aria-hidden />
      {!compact && 'YouCan'}
    </span>
  );
}
