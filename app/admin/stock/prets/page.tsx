'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardList, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BonDePreparation, Commande } from '@/lib/types';
import { Button } from '@/components/admin/Button';

// § Gestion de stock (2/4) : colis stock au statut "pret_pour_preparation",
// pas encore rattachés à un Bon de Préparation. Sélection multiple (toutes
// marchands confondus) -> POST /api/bons-preparation regroupe automatiquement
// par marchand et génère un bon par marchand représenté dans la sélection.
export default function AdminStockPretsPage() {
  const [colis, setColis] = useState<Commande[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bonsGeneres, setBonsGeneres] = useState<BonDePreparation[] | null>(null);

  async function load() {
    setChargement(true);
    setError(null);
    try {
      const res = await apiGet<{ data: Commande[] }>(
        '/api/commandes?statut=pret_pour_preparation&enStock=true&sansBonPreparation=true&pageSize=100'
      );
      setColis(res.data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    load();
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

  const marchandsConcernes = new Set(colis.filter((c) => selected.has(c.id)).map((c) => c.marchandId)).size;

  async function genererBonsPreparation() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: BonDePreparation[] }>('/api/bons-preparation', { colisIds: Array.from(selected) });
      setBonsGeneres(res.data);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Prêts pour préparation</h1>
      <p className="text-sm opacity-70">
        Colis stock prêts à être préparés. Sélectionnez les colis à regrouper : un Bon de Préparation est généré par
        marchand représenté dans la sélection.
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
                      <ClipboardList className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucun colis prêt pour préparation pour le moment</p>
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
              ? `${selected.size} colis sélectionné${selected.size > 1 ? 's' : ''} — ${marchandsConcernes} marchand${marchandsConcernes > 1 ? 's' : ''} (${marchandsConcernes > 1 ? `${marchandsConcernes} bons seront générés` : '1 bon sera généré'})`
              : 'Sélectionnez au moins un colis pour continuer'}
          </p>
          <Button onClick={genererBonsPreparation} disabled={busy || selected.size === 0} icon={<CheckCircle2 className="h-4 w-4" />}>
            {busy ? 'Génération…' : 'Générer Bon de Préparation'}
          </Button>
        </div>
      </div>

      {bonsGeneres && <ModalBonsGeneres bons={bonsGeneres} onFermer={() => setBonsGeneres(null)} />}
    </div>
  );
}

function ModalBonsGeneres({ bons, onFermer }: { bons: BonDePreparation[]; onFermer: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-black">
        <div className="flex items-start justify-between">
          <p className="text-lg font-bold">
            {bons.length} Bon{bons.length > 1 ? 's' : ''} de Préparation généré{bons.length > 1 ? 's' : ''}
          </p>
          <button onClick={onFermer} className="rounded p-1 opacity-60 hover:opacity-100" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {bons.map((b) => (
            <Link
              key={b.id}
              href={`/admin/stock/bons-preparation/${b.id}`}
              className="flex items-center justify-between rounded-md border border-black/10 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
            >
              <span className="font-mono font-semibold">{b.numero}</span>
              <span className="opacity-60">{b.nbColis} colis</span>
            </Link>
          ))}
        </div>
        <button onClick={onFermer} className="mt-4 w-full text-center text-sm font-semibold opacity-60 hover:opacity-100">
          Fermer
        </button>
      </div>
    </div>
  );
}
