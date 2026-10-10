'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Produit, ProduitVariante } from '@/lib/types';
import { unitesStock } from '@/lib/stock-unites';

// Sélecteur/autocomplétion connecté au stock (Produit) du marchand : utilisé
// par les formulaires "Nouveau colis" et "Modifier le colis" quand enStock
// est coché, pour relier le colis à l'unité de stock qu'il consomme
// (Commande.produitId + Commande.varianteId). Un produit à variantes ne se
// choisit que par l'une de ses variantes (lib/stock-unites.ts) : c'est elle
// que le passage en préparation décrémente. Le stock affiché est le stock
// RÉEL (quantité validée en entrepôt), pas la quantité déclarée.
export function ProduitSelect({
  marchandId,
  value,
  varianteId,
  onSelect,
  disabled,
  disabledHint,
}: {
  // Omis (undefined) côté marchand : l'API /api/produits déduit alors son
  // propre stock depuis la session. Fourni côté admin, où le marchand est
  // choisi explicitement dans le formulaire.
  marchandId?: string;
  value: string;
  varianteId?: string;
  onSelect: (produit: Produit | null, variante: ProduitVariante | null) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [produits, setProduits] = useState<Produit[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) {
      queueMicrotask(() => setProduits([]));
      return;
    }
    const path = marchandId !== undefined ? `/api/produits?marchandId=${marchandId}` : '/api/produits';
    apiGet<{ data: Produit[] }>(path)
      .then((res) => setProduits(res.data))
      .catch(() => setProduits([]));
  }, [marchandId, disabled]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const unites = unitesStock(produits);
  const selected =
    unites.find((u) => u.produit.id === value && (u.variante ? u.variante.id === varianteId : true)) ?? null;
  // Colis rattaché à un produit à variantes sans variante (antérieur au suivi
  // par variante) : on le montre, pour que l'agent voie ce qu'il doit préciser.
  const produitSansVariante = !selected && value ? produits.find((p) => p.id === value) ?? null : null;

  const q = query.trim().toLowerCase();
  const resultats = (
    q
      ? unites.filter(
          (u) =>
            u.libelle.toLowerCase().includes(q) ||
            u.reference.toLowerCase().includes(q) ||
            u.produit.reference.toLowerCase().includes(q)
        )
      : unites
  ).slice(0, 30);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-40" />
        <input
          className="input-basic w-full pl-7 pr-7 pointer-coarse:pr-10"
          placeholder={disabled ? disabledHint ?? 'Indisponible' : 'Rechercher un produit (nom ou référence)…'}
          value={
            open
              ? query
              : selected
                ? `${selected.libelle} (${selected.reference})`
                : produitSansVariante
                  ? `${produitSansVariante.nom} — variante à choisir`
                  : ''
          }
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
        />
        {(selected || produitSansVariante) && !open && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 pointer-coarse:right-0 pointer-coarse:p-3"
            onClick={() => onSelect(null, null)}
            aria-label="Retirer le produit sélectionné"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-black">
          {resultats.length === 0 && <p className="px-3 py-2 text-xs opacity-50">Aucun produit trouvé</p>}
          {resultats.map((u) => (
            <button
              key={u.variante?.id ?? u.produit.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                onSelect(u.produit, u.variante);
                setQuery('');
                setOpen(false);
              }}
            >
              {u.produit.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.produit.photoUrl} alt="" className="h-6 w-6 rounded object-cover" />
              ) : (
                <span className="h-6 w-6 shrink-0 rounded bg-black/5 dark:bg-white/10" />
              )}
              <span className="flex flex-col">
                <span className="font-medium">{u.libelle}</span>
                <span className={`text-xs ${u.disponible > 0 ? 'opacity-50' : 'text-red-600 dark:text-red-400'}`}>
                  {u.reference} · en entrepôt : {u.disponible}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
