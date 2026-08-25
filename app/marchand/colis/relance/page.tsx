'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, PackageSearch } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { STATUTS_A_RELANCER } from '@/lib/statuts';
import { ColisActionsMenu } from '@/components/marchand/ColisActionsMenu';
import { ColisSubNav } from '../ColisSubNav';

// Colis dont la dernière tentative de livraison a échoué (hors livrés et hors
// colis déjà en retour) : le marchand corrige l'adresse via "Modifier le
// colis" puis relance une nouvelle tentative avec le bouton "Relancer".
export default function ColisARelancerPage() {
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [relanceEnCours, setRelanceEnCours] = useState<string | null>(null);

  async function load() {
    setChargement(true);
    try {
      const res = await apiGet<{ data: Commande[] }>(`/api/commandes?statut=${STATUTS_A_RELANCER.join(',')}`);
      setCommandes(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  async function relancer(id: string) {
    setRelanceEnCours(id);
    setError(null);
    try {
      await apiPost(`/api/commandes/${id}/relancer`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setRelanceEnCours(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Colis</h1>
      </div>

      <ColisSubNav activeHref="/marchand/colis/relance" />

      <div>
        <h2 className="text-lg font-bold">Colis à relancer</h2>
        <p className="text-sm opacity-70">
          Tentatives de livraison en échec. Corrigez l&apos;adresse si besoin, puis relancez pour repasser le colis en
          file de livraison.
        </p>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[900px]">
            <thead>
              <tr>
                <th>Code d&apos;envoi</th>
                <th>Destinataire</th>
                <th>Téléphone</th>
                <th>Ville</th>
                <th>Adresse</th>
                <th className="text-right">Prix</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {commandes.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs font-semibold text-black/70 dark:text-white/70">{c.codeSuivi}</td>
                  <td className="font-medium">{c.clientNom}</td>
                  <td className="whitespace-nowrap">{c.clientTelephone}</td>
                  <td>{c.ville}</td>
                  <td className="max-w-[220px] truncate" title={c.adresse}>
                    {c.adresse}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{c.montantCod} DH</td>
                  <td>
                    <StatutBadge statut={c.statut} />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => relancer(c.id)}
                        disabled={relanceEnCours === c.id}
                        className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {relanceEnCours === c.id ? 'Relance…' : 'Relancer'}
                      </button>
                      <ColisActionsMenu commande={c} onChanged={load} champsRestreints />
                    </div>
                  </td>
                </tr>
              ))}
              {!chargement && commandes.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <PackageSearch className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucun colis à relancer</p>
                      <p className="text-xs">Les tentatives de livraison en échec apparaîtront ici.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
