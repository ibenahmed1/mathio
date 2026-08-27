'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Produit } from '@/lib/types';

// Sélecteur/autocomplétion connecté au stock (Produit) du marchand : utilisé
// par les formulaires "Nouveau colis" et "Modifier le colis" quand enStock
// est coché, pour relier le colis à sa fiche produit (Commande.produitId) et
// ainsi permettre l'affichage de sa vraie photo dans ColisInfoModal (cf.
// commentaire sur Commande.produitId dans prisma/schema.prisma).
export function ProduitSelect({
  marchandId,
  value,
  onSelect,
  disabled,
  disabledHint,
}: {
  // Omis (undefined) côté marchand : l'API /api/produits déduit alors son
  // propre stock depuis la session. Fourni côté admin, où le marchand est
  // choisi explicitement dans le formulaire.
  marchandId?: string;
  value: string;
  onSelect: (produit: Produit | null) => void;
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

  const selected = produits.find((p) => p.id === value) ?? null;

  const q = query.trim().toLowerCase();
  const resultats = (
    q ? produits.filter((p) => p.nom.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q)) : produits
  ).slice(0, 20);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-40" />
        <input
          className="input-basic w-full pl-7 pr-7"
          placeholder={disabled ? disabledHint ?? 'Indisponible' : 'Rechercher un produit (nom ou référence)…'}
          value={open ? query : selected ? `${selected.nom} (${selected.reference})` : ''}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
        />
        {selected && !open && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
            onClick={() => onSelect(null)}
            aria-label="Retirer le produit sélectionné"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-black">
          {resultats.length === 0 && <p className="px-3 py-2 text-xs opacity-50">Aucun produit trouvé</p>}
          {resultats.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                onSelect(p);
                setQuery('');
                setOpen(false);
              }}
            >
              {p.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photoUrl} alt="" className="h-6 w-6 rounded object-cover" />
              ) : (
                <span className="h-6 w-6 shrink-0 rounded bg-black/5 dark:bg-white/10" />
              )}
              <span className="flex flex-col">
                <span className="font-medium">{p.nom}</span>
                <span className="text-xs opacity-50">
                  {p.reference} · stock : {p.quantiteEnCours}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
