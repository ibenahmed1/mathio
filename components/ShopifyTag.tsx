import Image from 'next/image';

// § Intégration Shopify — distingue un colis ou une marchandise venus d'une
// boutique Shopify. Le tag se déduit du lien (Commande.shopify,
// Marchandise.shopify), jamais d'un champ saisi : il ne peut pas mentir.
//
// `detail` (le numéro de commande « #1001 », un SKU) part dans l'infobulle
// plutôt que dans le tag, pour que celui-ci garde la même largeur partout.
export function ShopifyTag({ detail, compact = false }: { detail?: string | null; compact?: boolean }) {
  const titre = detail ? `Importé de Shopify — ${detail}` : 'Importé de Shopify';
  return (
    <span
      title={titre}
      aria-label={titre}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#95BF47]/50 bg-[#95BF47]/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold leading-none text-[#3f6b21] dark:border-[#95BF47]/40 dark:bg-[#95BF47]/15 dark:text-[#bfe08a]"
    >
      <Image src="/logos/shopify.svg" alt="" width={11} height={12} unoptimized aria-hidden />
      {!compact && 'Shopify'}
    </span>
  );
}
