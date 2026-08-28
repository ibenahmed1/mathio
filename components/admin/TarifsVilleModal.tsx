'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Hub, TarifLivreurVille } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { Field } from '@/components/form/Field';

// Surcharge des frais de livraison/refus d'un livreur pour des villes
// spécifiques (maquette "Ajouter Utilisateur" : Frais de livraison (Agadir),
// etc.) — les villes non listées ici utilisent les frais par défaut du
// livreur (voir le formulaire "Ajouter utilisateur", UserFormModal).
export function TarifsVilleModal({
  utilisateurId,
  nomComplet,
  onClose,
}: {
  utilisateurId: string;
  nomComplet: string;
  onClose: () => void;
}) {
  const [tarifs, setTarifs] = useState<TarifLivreurVille[]>([]);
  const [villes, setVilles] = useState<{ id: string; nom: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ villeId: '', fraisLivraison: '', fraisRefus: '' });

  async function load() {
    try {
      const [tarifsRes, hubsRes] = await Promise.all([
        apiGet<{ data: TarifLivreurVille[] }>(`/api/utilisateurs/${utilisateurId}/tarifs-villes`),
        apiGet<{ data: Hub[] }>('/api/hubs'),
      ]);
      setTarifs(tarifsRes.data);
      setVilles(
        hubsRes.data
          .flatMap((h) => h.villes ?? [])
          .map((v) => ({ id: v.id, nom: v.nom }))
          .sort((a, b) => a.nom.localeCompare(b.nom))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const villesDisponibles = villes.filter((v) => !tarifs.some((t) => t.villeId === v.id));

  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    if (!form.villeId || form.fraisLivraison === '' || form.fraisRefus === '') return;
    setError(null);
    try {
      await apiPost(`/api/utilisateurs/${utilisateurId}/tarifs-villes`, form);
      setForm({ villeId: '', fraisLivraison: '', fraisRefus: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function enregistrerModif(tarif: TarifLivreurVille, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    try {
      await apiPatch(`/api/utilisateurs/${utilisateurId}/tarifs-villes/${tarif.id}`, {
        fraisLivraison: String(fd.get('fraisLivraison') ?? ''),
        fraisRefus: String(fd.get('fraisRefus') ?? ''),
      });
      setEditId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimer(tarif: TarifLivreurVille) {
    if (!window.confirm(`Retirer le tarif spécifique pour "${tarif.ville?.nom}" ?`)) return;
    setError(null);
    try {
      await apiDelete(`/api/utilisateurs/${utilisateurId}/tarifs-villes/${tarif.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <Modal title={`Tarifs par ville — ${nomComplet}`} onClose={onClose}>
      <p className="text-xs opacity-60">
        Les villes ci-dessous surchargent les frais de livraison/refus par défaut du livreur. Une ville sans ligne
        utilise ses frais par défaut.
      </p>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="flex flex-col gap-2">
        {tarifs.map((tarif) => (
          <div key={tarif.id} className="rounded-md border border-black/10 p-2.5 dark:border-white/10">
            {editId === tarif.id ? (
              <form onSubmit={(e) => enregistrerModif(tarif, e)} className="flex flex-wrap items-end gap-2">
                <span className="text-sm font-semibold">{tarif.ville?.nom}</span>
                <Field label="Frais livraison">
                  <input
                    name="fraisLivraison"
                    type="number"
                    step="0.01"
                    className="input-basic w-24 py-1"
                    defaultValue={tarif.fraisLivraison}
                  />
                </Field>
                <Field label="Frais refus">
                  <input
                    name="fraisRefus"
                    type="number"
                    step="0.01"
                    className="input-basic w-24 py-1"
                    defaultValue={tarif.fraisRefus}
                  />
                </Field>
                <button type="submit" className="btn-primary px-2 py-1 text-xs">
                  Enregistrer
                </button>
                <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={() => setEditId(null)}>
                  Annuler
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-semibold">{tarif.ville?.nom}</span>
                  <span className="ml-2 opacity-70">
                    Livraison : {tarif.fraisLivraison} DH · Refus : {tarif.fraisRefus} DH
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    title="Modifier"
                    onClick={() => setEditId(tarif.id)}
                    className="rounded-md border border-black/15 p-1.5 text-blue-600 transition hover:bg-blue-600 hover:text-white dark:border-white/15 dark:text-blue-400"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Supprimer"
                    onClick={() => supprimer(tarif)}
                    className="rounded-md border border-black/15 p-1.5 text-red-600 transition hover:bg-red-600 hover:text-white dark:border-white/15 dark:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {tarifs.length === 0 && <p className="text-sm opacity-60">Aucun tarif spécifique — frais par défaut partout.</p>}
      </div>

      {villesDisponibles.length > 0 && (
        <form onSubmit={ajouter} className="flex flex-wrap items-end gap-2 border-t border-black/10 pt-3 dark:border-white/10">
          <Field label="Ville" required>
            <select
              className="input-basic py-1"
              value={form.villeId}
              onChange={(e) => setForm({ ...form, villeId: e.target.value })}
              required
            >
              <option value="">Choisir…</option>
              {villesDisponibles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nom}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Frais livraison" required>
            <input
              type="number"
              step="0.01"
              className="input-basic w-24 py-1"
              value={form.fraisLivraison}
              onChange={(e) => setForm({ ...form, fraisLivraison: e.target.value })}
              required
            />
          </Field>
          <Field label="Frais refus" required>
            <input
              type="number"
              step="0.01"
              className="input-basic w-24 py-1"
              value={form.fraisRefus}
              onChange={(e) => setForm({ ...form, fraisRefus: e.target.value })}
              required
            />
          </Field>
          <button type="submit" className="btn-primary flex items-center gap-1 px-2 py-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </button>
        </form>
      )}
    </Modal>
  );
}
