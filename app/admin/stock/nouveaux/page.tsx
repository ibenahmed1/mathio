'use client';

import { useEffect, useMemo, useState } from 'react';
import { PackageSearch, CheckCircle2 } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { Button } from '@/components/admin/Button';

// § Gestion de stock (1/4) : colis stock (enStock=true) créés par le marchand
// et pas encore pris en charge par le Hub — ces colis ne passent pas par le
// Bon de Livraison marchand classique (cf. Commande.enStock, prisma/schema.prisma),
// donc c'est ici que l'admin les fait avancer vers "pret_pour_preparation"
// une fois arrivés physiquement, avant leur regroupement en Bon de
// Préparation (§ /admin/stock/prets).
export default function AdminStockNouveauxPage() {
  const [colis, setColis] = useState<Commande[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setChargement(true);
    setError(null);
    try {
      const res = await apiGet<{ data: Commande[] }>('/api/commandes?statut=nouveau_colis&enStock=true&pageSize=100');
      setColis(res.data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  const tousSelectionnes = colis.length > 0 && colis.every((c) => selected.has(c.id));

  function toggleTout() {
    setSelected(tousSelectionnes ? new Set() : new Set(colis.map((c) => c.id)));
  }

  function toggleUn(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function marquerPretPourPreparation() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/stock/pret-pour-preparation', { colisIds: Array.from(selected) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const totalQuantite = useMemo(() => colis.filter((c) => selected.has(c.id)).reduce((sum, c) => sum + c.quantite, 0), [colis, selected]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Nouveaux colis stock</h1>
      <p className="text-sm opacity-70">
        Colis stock créés par le marchand, pas encore pris en charge par le Hub. Sélectionnez les colis arrivés
        physiquement pour les marquer « prêts pour préparation ».
      </p>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[900px]">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" checked={tousSelectionnes} onChange={toggleTout} aria-label="Tout sélectionner" />
                </th>
                <th>Code suivi</th>
                <th>Marchand</th>
                <th>Produit</th>
                <th>Quantité</th>
                <th>Ville</th>
                <th>Date de création</th>
              </tr>
            </thead>
            <tbody>
              {colis.map((c) => (
                <tr key={c.id} className={selected.has(c.id) ? 'bg-brand/10' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleUn(c.id)}
                      aria-label={`Sélectionner ${c.codeSuivi}`}
                    />
                  </td>
                  <td className="font-mono text-xs font-semibold">{c.codeSuivi}</td>
                  <td>{c.marchand?.nomBoutique ?? '—'}</td>
                  <td>{c.produit?.nom ?? c.produitDescription ?? <span className="opacity-40">—</span>}</td>
                  <td>{c.quantite}</td>
                  <td>{c.ville}</td>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(c.dateCreation).toLocaleString('fr-FR')}</td>
                </tr>
              ))}
              {!chargement && colis.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <PackageSearch className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucun colis stock en attente de prise en charge</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-black/10 bg-white/95 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-black/95 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold">
            {selected.size > 0
              ? `${selected.size} colis sélectionné${selected.size > 1 ? 's' : ''} — ${totalQuantite} article${totalQuantite > 1 ? 's' : ''}`
              : 'Sélectionnez au moins un colis pour continuer'}
          </p>
          <Button onClick={marquerPretPourPreparation} disabled={busy || selected.size === 0} icon={<CheckCircle2 className="h-4 w-4" />}>
            {busy ? 'Mise à jour…' : 'Marquer prêt pour préparation'}
          </Button>
        </div>
      </div>
    </div>
  );
}
