'use client';

import { useEffect, useState } from 'react';
import { PackagePlus, Trash2, Boxes, TriangleAlert } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import type { Marchandise } from '@/lib/types';

// Catalogue "marchandise" du marchand : sert à peupler la liste déroulante
// du formulaire "Nouveau colis" (le marchand ne voit que ce qu'il a saisi ici).
export default function MarchandisesPage() {
  const [marchandises, setMarchandises] = useState<Marchandise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ nom: '', qteStock: '', prix: '' });
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [chargement, setChargement] = useState(true);

  async function load() {
    setChargement(true);
    try {
      const res = await apiGet<{ data: Marchandise[] }>('/api/marchandises');
      setMarchandises(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnvoiEnCours(true);
    try {
      await apiPost('/api/marchandises', {
        nom: form.nom,
        qteStock: Number(form.qteStock) || 0,
        prix: Number(form.prix) || 0,
      });
      setForm({ nom: '', qteStock: '', prix: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnvoiEnCours(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await apiDelete(`/api/marchandises/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Marchandises</h1>

      <p className="max-w-2xl text-sm opacity-70">
        Le catalogue ci-dessous alimente la liste déroulante « Marchandise » du formulaire de création de colis : son
        prix pré-remplit automatiquement le prix du colis (prix × quantité), tout en restant modifiable.
      </p>

      <form onSubmit={handleCreate} className="form-section max-w-xl">
        <div className="form-grid sm:grid-cols-3">
          <label className="form-field sm:col-span-3">
            <span className="form-label">
              Nom de la marchandise<span className="form-required">*</span>
            </span>
            <input
              className="input-basic"
              placeholder="Ex. Coffret 2 flacons 50 ml"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              required
            />
          </label>
          <label className="form-field">
            <span className="form-label">
              Stock<span className="form-required">*</span>
            </span>
            <input
              className="input-basic"
              type="number"
              min="0"
              value={form.qteStock}
              onChange={(e) => setForm({ ...form, qteStock: e.target.value })}
              required
            />
          </label>
          <label className="form-field">
            <span className="form-label">
              Prix<span className="form-required">*</span>
            </span>
            <div className="form-affix">
              <input
                className="input-bare"
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                value={form.prix}
                onChange={(e) => setForm({ ...form, prix: e.target.value })}
                required
              />
              <span className="form-affix-chip">DH</span>
            </div>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" disabled={envoiEnCours} className="btn-primary flex items-center justify-center gap-2">
            <PackagePlus className="h-4 w-4" />
            Ajouter
          </button>
        </div>
      </form>

      {error && (
        <p className="flex items-center gap-2 text-sm font-medium text-red-600">
          <TriangleAlert className="h-4 w-4" /> {error}
        </p>
      )}

      <div className="table-card max-w-xl">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[480px]">
            <thead>
              <tr>
                <th>Marchandise</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Prix</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {marchandises.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.nom}</td>
                  <td className="text-right tabular-nums">
                    <span className={`badge ${m.qteStock === 0 ? 'badge-danger' : 'badge-neutral'}`}>{m.qteStock}</span>
                  </td>
                  <td className="text-right font-semibold tabular-nums">{m.prix} DH</td>
                  <td className="w-8">
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="text-red-600 transition hover:opacity-70"
                      aria-label={`Supprimer ${m.nom}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!chargement && marchandises.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      <Boxes className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucune marchandise enregistrée</p>
                      <p className="text-xs">Ajoutez-en une ci-dessus pour la retrouver dans le formulaire colis.</p>
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
