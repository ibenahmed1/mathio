'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { AdresseMarchand, Ramassage } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';

export default function MarchandRamassagesPage() {
  const [ramassages, setRamassages] = useState<Ramassage[]>([]);
  const [adresses, setAdresses] = useState<AdresseMarchand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ adresseId: '', datePrevue: '', creneauHoraire: '', nbColisEstimes: '' });

  async function load() {
    try {
      const [r, a] = await Promise.all([
        apiGet<{ data: Ramassage[] }>('/api/ramassages'),
        apiGet<{ data: AdresseMarchand[] }>('/api/adresses'),
      ]);
      setRamassages(r.data);
      setAdresses(a.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiPost('/api/ramassages', {
        adresseId: form.adresseId,
        datePrevue: form.datePrevue,
        creneauHoraire: form.creneauHoraire || undefined,
        nbColisEstimes: form.nbColisEstimes ? Number(form.nbColisEstimes) : undefined,
      });
      setForm({ adresseId: '', datePrevue: '', creneauHoraire: '', nbColisEstimes: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Mes ramassages</h1>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary">
          {showForm ? 'Annuler' : 'Demander un ramassage ponctuel'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="grid max-w-xl grid-cols-1 gap-2 rounded-lg border border-black/10 p-4 sm:grid-cols-2 dark:border-white/10">
          <select
            className="input-basic sm:col-span-2"
            value={form.adresseId}
            onChange={(e) => setForm({ ...form, adresseId: e.target.value })}
            required
          >
            <option value="">Choisir une adresse de collecte…</option>
            {adresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.libelle} — {a.adresseComplete}
              </option>
            ))}
          </select>
          {adresses.length === 0 && (
            <p className="sm:col-span-2 text-xs text-amber-700">
              Aucune adresse enregistrée — ajoutez-en une dans votre Profil avant de demander un ramassage.
            </p>
          )}
          <input
            className="input-basic"
            type="date"
            value={form.datePrevue}
            onChange={(e) => setForm({ ...form, datePrevue: e.target.value })}
            required
          />
          <input
            className="input-basic"
            placeholder="Créneau (ex. 17:00-19:00)"
            value={form.creneauHoraire}
            onChange={(e) => setForm({ ...form, creneauHoraire: e.target.value })}
          />
          <input
            className="input-basic sm:col-span-2"
            type="number"
            placeholder="Nombre de colis estimé"
            value={form.nbColisEstimes}
            onChange={(e) => setForm({ ...form, nbColisEstimes: e.target.value })}
          />
          <button type="submit" disabled={!adresses.length} className="btn-primary sm:col-span-2">
            Envoyer la demande
          </button>
        </form>
      )}

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="table-basic min-w-[640px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Créneau</th>
              <th>Mode</th>
              <th>Colis (estimé/réel)</th>
              <th>Ramasseur</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {ramassages.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.datePrevue).toLocaleDateString('fr-FR')}</td>
                <td>{r.creneauHoraire ?? '—'}</td>
                <td>{r.modeCreation}</td>
                <td>
                  {r.nbColisEstimes ?? '—'} / {r.nbColisReels}
                </td>
                <td>{r.ramasseur?.nomComplet ?? '—'}</td>
                <td>
                  <StatutBadge statut={r.statut} />
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
    </div>
  );
}
