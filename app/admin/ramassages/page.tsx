'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Ramassage, Utilisateur } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';

export default function AdminRamassagesPage() {
  const [ramassages, setRamassages] = useState<Ramassage[]>([]);
  const [ramasseurs, setRamasseurs] = useState<Utilisateur[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const r = await apiGet<{ data: Ramassage[] }>('/api/ramassages');
      setRamassages(r.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // /api/utilisateurs est réservé à "admin" : on l'isole dans son propre
    // effet (comme /admin/commandes pour les livreurs) pour qu'un 403 ici
    // n'empêche pas les autres rôles back-office de voir la liste des
    // ramassages, même s'ils ne peuvent pas assigner de ramasseur.
    apiGet<{ data: Utilisateur[] }>('/api/utilisateurs?role=ramasseur')
      .then((res) => setRamasseurs(res.data))
      .catch(() => {});
  }, []);

  async function assignerRamasseur(id: string, ramasseurId: string) {
    setError(null);
    try {
      await apiPatch(`/api/ramassages/${id}`, { ramasseurId: ramasseurId || null, statut: ramasseurId ? 'confirmee' : undefined });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function lancerPlanification() {
    setError(null);
    setMessage(null);
    try {
      const res = await apiPost<{ crees: unknown[]; ignores: { nomBoutique: string; raison: string }[] }>(
        '/api/ramassages/planifier'
      );
      setMessage(
        `${res.crees.length} tournée(s) créée(s). Ignorés : ${
          res.ignores.map((i) => `${i.nomBoutique} (${i.raison})`).join(', ') || 'aucun'
        }`
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Ramassages</h1>
        <button onClick={lancerPlanification} className="btn-primary">
          Lancer la planification récurrente (RG-16)
        </button>
      </div>

      {message && <p className="text-sm font-medium text-green-700">{message}</p>}
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <table className="table-basic">
        <thead>
          <tr>
            <th>Marchand</th>
            <th>Date</th>
            <th>Mode</th>
            <th>Colis (est./réel)</th>
            <th>Statut</th>
            <th>Ramasseur assigné</th>
          </tr>
        </thead>
        <tbody>
          {ramassages.map((r) => (
            <tr key={r.id}>
              <td>{r.marchand?.nomBoutique}</td>
              <td>{new Date(r.datePrevue).toLocaleDateString('fr-FR')}</td>
              <td>{r.modeCreation}</td>
              <td>
                {r.nbColisEstimes ?? '—'} / {r.nbColisReels}
              </td>
              <td>
                <StatutBadge statut={r.statut} />
              </td>
              <td>
                <select
                  className="input-basic px-2 py-1 text-xs"
                  value={r.ramasseurId ?? ''}
                  onChange={(e) => assignerRamasseur(r.id, e.target.value)}
                >
                  <option value="">— non assigné —</option>
                  {ramasseurs.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nomComplet}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {ramassages.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center opacity-60">
                Aucun ramassage
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
