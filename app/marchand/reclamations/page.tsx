'use client';

import { useEffect, useState } from 'react';
import { MessageSquarePlus, MessageSquareWarning } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Commande, Reclamation } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { SupportProfilSubNav } from '../SupportProfilSubNav';

export default function ReclamationsPage() {
  const [reclamations, setReclamations] = useState<Reclamation[]>([]);
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [form, setForm] = useState({ sujet: '', message: '', commandeId: '' });

  async function load() {
    try {
      const [r, c] = await Promise.all([
        apiGet<{ data: Reclamation[] }>('/api/reclamations'),
        apiGet<{ data: Commande[] }>('/api/commandes?pageSize=100'),
      ]);
      setReclamations(r.data);
      setCommandes(c.data);
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
    setEnvoiEnCours(true);
    try {
      await apiPost('/api/reclamations', {
        sujet: form.sujet,
        message: form.message,
        commandeId: form.commandeId || undefined,
      });
      setForm({ sujet: '', message: '', commandeId: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnvoiEnCours(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Support & Profil</h1>
        <SupportProfilSubNav />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm opacity-70">
          Signalez un problème (colis, paiement, ramassage…) au support. Vous pouvez suivre ici la réponse du
          back-office.
        </p>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4" />
          {showForm ? 'Annuler' : 'Nouvelle réclamation'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="grid max-w-xl grid-cols-1 gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.02]"
        >
          <label className="flex flex-col gap-1 text-sm">
            Sujet
            <input
              className="input-basic"
              value={form.sujet}
              onChange={(e) => setForm({ ...form, sujet: e.target.value })}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Colis concerné (optionnel)
            <select
              className="input-basic"
              value={form.commandeId}
              onChange={(e) => setForm({ ...form, commandeId: e.target.value })}
            >
              <option value="">Aucun colis en particulier</option>
              {commandes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codeSuivi} — {c.clientNom}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Message
            <textarea
              className="input-basic"
              rows={4}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              required
            />
          </label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button type="submit" disabled={envoiEnCours} className="btn-primary w-fit">
            {envoiEnCours ? 'Envoi…' : 'Envoyer'}
          </button>
        </form>
      )}

      {!showForm && error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="flex flex-col gap-3">
        {reclamations.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{r.sujet}</p>
                <p className="text-xs opacity-60">
                  {new Date(r.dateCreation).toLocaleString('fr-FR')}
                  {r.commande ? ` · Colis ${r.commande.codeSuivi}` : ''}
                </p>
              </div>
              <StatutBadge statut={r.statut} />
            </div>
            <p className="text-sm opacity-80">{r.message}</p>
            {r.reponse && (
              <div className="mt-1 rounded-md border-l-4 border-brand bg-brand/5 px-3 py-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Réponse du support</p>
                <p>{r.reponse}</p>
              </div>
            )}
          </div>
        ))}
        {reclamations.length === 0 && (
          <div className="empty-state">
            <MessageSquareWarning className="h-8 w-8 opacity-40" />
            <p className="font-medium">Aucune réclamation</p>
            <p className="text-xs">Vous n&apos;avez signalé aucun problème pour le moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}
