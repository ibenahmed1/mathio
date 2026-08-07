'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PackagePlus, Trash2, Boxes, ImageOff, TriangleAlert } from 'lucide-react';
import { apiDelete, apiGet } from '@/lib/api-client';
import type { Produit } from '@/lib/types';
import { InventaireSubNav } from './InventaireSubNav';

const OPTIONS_PAR_PAGE = [10, 25, 50, 100];

export default function InventairePage() {
  const [produits, setProduits] = useState<Produit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [parPage, setParPage] = useState(OPTIONS_PAR_PAGE[0]);
  const [page, setPage] = useState(1);

  async function load() {
    setChargement(true);
    try {
      const res = await apiGet<{ data: Produit[] }>('/api/produits');
      setProduits(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return produits;
    return produits.filter((p) => {
      if (p.nom.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q)) return true;
      return (p.variantes ?? []).some((v) => v.nom.toLowerCase().includes(q) || v.reference.toLowerCase().includes(q));
    });
  }, [produits, recherche]);

  const totalPages = Math.max(1, Math.ceil(filtres.length / parPage));
  const pageCourante = Math.min(page, totalPages);
  const debut = filtres.length === 0 ? 0 : (pageCourante - 1) * parPage + 1;
  const fin = Math.min(pageCourante * parPage, filtres.length);
  const pageItems = filtres.slice((pageCourante - 1) * parPage, pageCourante * parPage);

  async function handleDelete(id: string, nom: string) {
    if (!window.confirm(`Supprimer « ${nom} » de l'inventaire ?`)) return;
    setError(null);
    try {
      await apiDelete(`/api/produits/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">Gestion Inventaire</h1>
        <Link href="/marchand/inventaire/nouveau" className="btn-primary flex items-center gap-2">
          <PackagePlus className="h-4 w-4" />
          Ajouter Produit
        </Link>
      </div>

      <InventaireSubNav />

      {error && (
        <p className="flex items-center gap-2 text-sm font-medium text-red-600">
          <TriangleAlert className="h-4 w-4" /> {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          Afficher
          <select
            className="input-basic py-1"
            value={parPage}
            onChange={(e) => {
              setParPage(Number(e.target.value));
              setPage(1);
            }}
          >
            {OPTIONS_PAR_PAGE.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          entrées par page
        </label>
        <label className="flex items-center gap-2 text-sm">
          Rechercher :
          <input
            className="input-basic py-1"
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[720px]">
            <thead>
              <tr>
                <th></th>
                <th>Nom du produit</th>
                <th>Réf</th>
                <th className="text-right">Reçu</th>
                <th className="text-right">En cours</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => {
                const lignes = p.variantesActivees && (p.variantes?.length ?? 0) > 0 ? p.variantes! : null;
                return (
                  <tr key={p.id}>
                    <td className="w-12">
                      {p.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.photoUrl} alt={p.nom} className="h-9 w-9 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-black/[0.04] dark:bg-white/[0.06]">
                          <ImageOff className="h-4 w-4 opacity-40" />
                        </div>
                      )}
                    </td>
                    <td className="font-medium">{p.nom}</td>
                    {lignes ? (
                      <>
                        <td>
                          <div className="flex flex-col gap-1.5 py-1">
                            {lignes.map((v) => (
                              <span key={v.id} className="font-mono text-xs">
                                {v.reference}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="flex flex-col items-end gap-1.5 py-1">
                            {lignes.map((v) => (
                              <span key={v.id} className="badge bg-green-500/15 text-green-700 dark:text-green-400">
                                {v.quantiteRecue}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="flex flex-col items-end gap-1.5 py-1">
                            {lignes.map((v) => (
                              <span key={v.id} className="badge badge-warn">
                                {v.quantiteEnCours}
                              </span>
                            ))}
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="font-mono text-xs">{p.reference}</td>
                        <td className="text-right">
                          <span className="badge bg-green-500/15 text-green-700 dark:text-green-400">{p.quantiteRecue}</span>
                        </td>
                        <td className="text-right">
                          <span className="badge badge-warn">{p.quantiteEnCours}</span>
                        </td>
                      </>
                    )}
                    <td className="w-8">
                      <button
                        onClick={() => handleDelete(p.id, p.nom)}
                        className="text-red-600 transition hover:opacity-70"
                        aria-label={`Supprimer ${p.nom}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!chargement && filtres.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <Boxes className="h-8 w-8 opacity-40" />
                      <p className="font-medium">
                        {produits.length === 0 ? "Aucun produit dans l'inventaire" : 'Aucun résultat pour cette recherche'}
                      </p>
                      {produits.length === 0 && (
                        <p className="text-xs">
                          <Link href="/marchand/inventaire/nouveau" className="underline">
                            Ajoutez votre premier produit
                          </Link>
                          .
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm opacity-70">
        <span>
          Affichage {debut} à {fin} de {filtres.length} entrées
        </span>
        <div className="flex items-center gap-2">
          <button
            className="btn-outline disabled:opacity-40"
            disabled={pageCourante <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Précédent
          </button>
          <span className="font-semibold">{pageCourante}</span>
          <button
            className="btn-outline disabled:opacity-40"
            disabled={pageCourante >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Suivant
          </button>
        </div>
      </div>
    </div>
  );
}
