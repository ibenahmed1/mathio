'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Boxes, ImageOff, Pencil } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Produit } from '@/lib/types';

const OPTIONS_PAR_PAGE = [10, 25, 50, 100];

// statutReception est un verrou fixé explicitement par l'admin (page
// "Modifier produit"), pas une déduction des quantités — tant qu'il vaut
// pas_encore_recu, la saisie des quantités reste désactivée là-bas.
function StatutBadgeProduit({ statut }: { statut: Produit['statutReception'] }) {
  if (statut === 'recu') return <span className="badge bg-green-500/15 text-green-700 dark:text-green-400">Reçu</span>;
  return <span className="badge badge-neutral">Pas encore reçu</span>;
}

// Vue admin transverse (tous marchands) de l'inventaire produit : chaque
// ligne mène vers la page "Modifier produit" pour valider la réception,
// retirer du stock et renseigner le rayonnage (voir [id]/page.tsx).
export default function AdminStockInventairePage() {
  const [produits, setProduits] = useState<Produit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [rechercheMagasin, setRechercheMagasin] = useState('');
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
    const qMagasin = rechercheMagasin.trim().toLowerCase();
    const q = recherche.trim().toLowerCase();
    return produits.filter((p) => {
      if (qMagasin && !(p.marchand?.nomBoutique ?? '').toLowerCase().includes(qMagasin)) return false;
      if (!q) return true;
      if (p.nom.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q)) return true;
      return (p.variantes ?? []).some((v) => v.nom.toLowerCase().includes(q) || v.reference.toLowerCase().includes(q));
    });
  }, [produits, rechercheMagasin, recherche]);

  const totalPages = Math.max(1, Math.ceil(filtres.length / parPage));
  const pageCourante = Math.min(page, totalPages);
  const debut = filtres.length === 0 ? 0 : (pageCourante - 1) * parPage + 1;
  const fin = Math.min(pageCourante * parPage, filtres.length);
  const pageItems = filtres.slice((pageCourante - 1) * parPage, pageCourante * parPage);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Inventaire</h1>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <input
        className="input-basic max-w-xs"
        placeholder="Rechercher un magasin"
        value={rechercheMagasin}
        onChange={(e) => {
          setRechercheMagasin(e.target.value);
          setPage(1);
        }}
      />

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
          <table className="table-basic min-w-[820px]">
            <thead>
              <tr>
                <th></th>
                <th>Nom du magasin</th>
                <th>Nom du produit</th>
                <th>Quantité</th>
                <th>Rayonnage</th>
                <th>Statut</th>
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
                    <td>{p.marchand?.nomBoutique ?? '—'}</td>
                    <td className="font-medium">{p.nom}</td>
                    <td>
                      {lignes ? (
                        <div className="flex flex-col gap-1 py-1 text-xs">
                          {lignes.map((v) => (
                            <span key={v.id}>
                              <span className="font-semibold">{v.nom} :</span> {v.quantiteRecue} | {v.quantiteEnCours}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs">
                          {p.quantiteRecue} | {p.quantiteEnCours}
                        </span>
                      )}
                    </td>
                    <td>
                      {lignes ? (
                        <div className="flex flex-col gap-1 py-1 text-xs opacity-70">
                          {lignes.map((v) => (
                            <span key={v.id}>{v.rayonnage ?? '—'}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs opacity-70">{p.rayonnage ?? '—'}</span>
                      )}
                    </td>
                    <td>
                      <StatutBadgeProduit statut={p.statutReception} />
                    </td>
                    <td className="w-8">
                      <Link
                        href={`/admin/stock/inventaire/${p.id}`}
                        className="inline-flex items-center justify-center rounded-md bg-black/[0.06] p-1.5 transition hover:bg-black/[0.12] dark:bg-white/10 dark:hover:bg-white/20"
                        aria-label={`Modifier ${p.nom}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!chargement && filtres.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <Boxes className="h-8 w-8 opacity-40" />
                      <p className="font-medium">
                        {produits.length === 0 ? 'Aucun produit dans l’inventaire' : 'Aucun résultat pour cette recherche'}
                      </p>
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
