'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api-client';
import type { Commande } from '@/lib/types';

export default function AdminConfirmationColisPage() {
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiGet<{ data: Commande[] }>('/api/commandes?statut=nouveau_colis');
      setCommandes(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  async function changerStatut(id: string, statut: string) {
    setError(null);
    try {
      await apiPatch(`/api/commandes/${id}/statut`, { statut });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Confirmation des colis</h1>
        <p className="text-sm opacity-70">Colis en attente de confirmation par l&apos;agent.</p>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[640px]">
          <thead>
            <tr>
              <th>Code</th>
              <th>Client</th>
              <th>Téléphone</th>
              <th>Ville</th>
              <th>Montant</th>
              <th>Risque</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c) => (
              <tr key={c.id}>
                <td className="font-mono">{c.codeSuivi}</td>
                <td>{c.clientNom}</td>
                <td>{c.clientTelephone}</td>
                <td>{c.ville}</td>
                <td>{c.montantCod} DH</td>
                <td>{c.aRisque ? '⚠️' : ''}</td>
                <td className="flex gap-2">
                  <button onClick={() => changerStatut(c.id, 'attente_de_ramassage')} className="btn-outline px-2 py-1 text-xs">
                    Confirmer
                  </button>
                  <button onClick={() => changerStatut(c.id, 'annule')} className="btn-outline px-2 py-1 text-xs">
                    Annuler
                  </button>
                </td>
              </tr>
            ))}
            {commandes.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center opacity-60">
                  Aucun colis en attente de confirmation
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
