'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Hub, Ville } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { IconButton } from '@/components/admin/IconButton';
import { Field } from '@/components/form/Field';

type ModalState =
  | { kind: 'hub'; mode: 'create' }
  | { kind: 'hub'; mode: 'edit'; hub: Hub }
  | { kind: 'ville'; mode: 'create'; hubId: string }
  | { kind: 'ville'; mode: 'edit'; ville: Ville }
  | null;

export default function AdminHubsPage() {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedHubId, setSelectedHubId] = useState<string | null>(null);

  // Conserve la sélection courante si le hub existe toujours après un
  // rechargement ; sinon retombe sur le premier hub (ou aucune sélection
  // s'il n'y en a plus) — évite de perdre le focus admin à chaque mutation.
  async function load() {
    try {
      const res = await apiGet<{ data: Hub[] }>('/api/hubs');
      setHubs(res.data);
      setSelectedHubId((current) => (current && res.data.some((h) => h.id === current) ? current : (res.data[0]?.id ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, []);

  const totaux = useMemo(() => {
    const villes = hubs.reduce((total, h) => total + (h.villes?.length ?? 0), 0);
    const colisDepot = hubs.reduce((total, h) => total + (h.nbColisDepot ?? 0), 0);
    return { hubs: hubs.length, villes, colisDepot };
  }, [hubs]);

  const selectedHub = hubs.find((h) => h.id === selectedHubId) ?? null;

  async function handleHubSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind !== 'hub') return;
    const fd = new FormData(e.currentTarget);
    const payload = {
      nom: String(fd.get('nom') ?? ''),
      ville: String(fd.get('ville') ?? ''),
      adresse: String(fd.get('adresse') ?? ''),
      telephone: String(fd.get('telephone') ?? ''),
      isCentral: fd.get('isCentral') === 'on',
    };
    setError(null);
    try {
      if (modal.mode === 'create') {
        await apiPost('/api/hubs', payload);
      } else {
        await apiPatch(`/api/hubs/${modal.hub.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleVilleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind !== 'ville') return;
    const fd = new FormData(e.currentTarget);
    const payload = { nom: String(fd.get('nom') ?? ''), hubId: String(fd.get('hubId') ?? '') };
    setError(null);
    try {
      if (modal.mode === 'create') {
        await apiPost('/api/villes', payload);
      } else {
        await apiPatch(`/api/villes/${modal.ville.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimerHub(hub: Hub) {
    if (!window.confirm(`Supprimer le hub "${hub.nom}" ? Cette action est irréversible.`)) return;
    setError(null);
    try {
      await apiDelete(`/api/hubs/${hub.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimerVille(ville: Ville) {
    if (!window.confirm(`Supprimer la ville "${ville.nom}" ?`)) return;
    setError(null);
    try {
      await apiDelete(`/api/villes/${ville.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Gestion des Hubs</h1>
          <p className="mt-0.5 text-sm opacity-60">
            {totaux.hubs} hub{totaux.hubs > 1 ? 's' : ''} · {totaux.villes} ville{totaux.villes > 1 ? 's' : ''} · {totaux.colisDepot} colis au dépôt
          </p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ kind: 'hub', mode: 'create' })}>
          Nouveau hub
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr] lg:items-start">
        {/* Liste des hubs : navigation, pas d'actions — le détail porte les actions */}
        <div
          className={`flex-col gap-0.5 rounded-lg border border-black/10 p-1.5 dark:border-white/10 ${
            selectedHubId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {hubs.map((hub) => {
            const active = hub.id === selectedHubId;
            return (
              <button
                key={hub.id}
                type="button"
                onClick={() => setSelectedHubId(hub.id)}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left transition ${
                  active ? 'bg-brand/[0.15] dark:bg-brand/[0.12]' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                }`}
              >
                <span className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {hub.nom}
                    {hub.isCentral && (
                      <span className="rounded-full bg-black px-1.5 py-0.5 text-[10px] font-bold text-white dark:bg-white dark:text-black">
                        Central
                      </span>
                    )}
                  </span>
                  <span className="text-xs opacity-60">
                    {hub.villes?.length ?? 0} ville{(hub.villes?.length ?? 0) > 1 ? 's' : ''} · {hub.nbColisDepot ?? 0} colis au dépôt
                  </span>
                </span>
                <ChevronRight className={`h-4 w-4 shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-25'}`} />
              </button>
            );
          })}
          {hubs.length === 0 && <p className="px-3 py-4 text-sm opacity-60">Aucun hub</p>}
        </div>

        {/* Détail du hub sélectionné : coordonnées et villes rattachées */}
        <div className={`flex-col gap-4 ${selectedHubId ? 'flex' : 'hidden lg:flex'}`}>
          {selectedHub ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedHubId(null)}
                className="inline-flex items-center gap-1 self-start text-sm font-semibold opacity-60 hover:opacity-100 lg:hidden"
              >
                <ChevronRight className="h-4 w-4 rotate-180" /> Tous les hubs
              </button>

              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold">{selectedHub.nom}</h2>
                    {selectedHub.isCentral && (
                      <span className="rounded-full bg-black px-2 py-0.5 text-[11px] font-bold text-white dark:bg-white dark:text-black">
                        Hub Central
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs opacity-60">
                    {selectedHub.ville}
                    {selectedHub.adresse ? ` — ${selectedHub.adresse}` : ''}
                    {selectedHub.telephone ? ` · ${selectedHub.telephone}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs opacity-60">
                    {selectedHub.villes?.length ?? 0} ville(s) · {selectedHub.nbColisDepot ?? 0} colis au dépôt
                  </p>
                </div>
                <div className="flex gap-2">
                  <IconButton variant="edit" label="Modifier le hub" onClick={() => setModal({ kind: 'hub', mode: 'edit', hub: selectedHub })}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="delete" label="Supprimer le hub" onClick={() => supprimerHub(selectedHub)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="add" label="Ajouter une ville" onClick={() => setModal({ kind: 'ville', mode: 'create', hubId: selectedHub.id })}>
                    <Plus className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(selectedHub.villes ?? []).map((ville) => (
                  <div
                    key={ville.id}
                    className="inline-flex items-center overflow-hidden rounded-full border border-black/20 text-xs font-medium text-black/70 dark:border-white/20 dark:text-white/70"
                  >
                    <button
                      type="button"
                      onClick={() => setModal({ kind: 'ville', mode: 'edit', ville })}
                      title={`Modifier ${ville.nom}`}
                      className="py-1 pl-3 pr-1 hover:opacity-80"
                    >
                      {ville.nom}
                    </button>
                    <button
                      type="button"
                      onClick={() => supprimerVille(ville)}
                      title={`Supprimer ${ville.nom}`}
                      className="mr-1 rounded-full p-0.5 opacity-60 transition hover:bg-red-600 hover:text-white hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {(selectedHub.villes ?? []).length === 0 && (
                  <p className="rounded-lg border border-dashed border-black/15 p-4 text-center text-sm opacity-60 dark:border-white/15">
                    Aucune ville rattachée à ce hub
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm opacity-60 dark:border-white/15">
              Sélectionnez un hub pour voir ses villes
            </p>
          )}
        </div>
      </div>

      {modal?.kind === 'hub' && (
        <Modal title={modal.mode === 'create' ? 'Nouveau hub' : 'Modifier le hub'} onClose={() => setModal(null)}>
          <form onSubmit={handleHubSubmit} className="flex flex-col gap-4">
            <Field label="Nom du hub" required>
              <input name="nom" className="input-basic" defaultValue={modal.mode === 'edit' ? modal.hub.nom : ''} required />
            </Field>
            <Field label="Ville" required>
              <input name="ville" className="input-basic" defaultValue={modal.mode === 'edit' ? modal.hub.ville : ''} required />
            </Field>
            <div className="form-grid">
              <Field label="Adresse" optional>
                <input
                  name="adresse"
                  className="input-basic"
                  defaultValue={modal.mode === 'edit' ? (modal.hub.adresse ?? '') : ''}
                />
              </Field>
              <Field label="Téléphone" optional>
                <input
                  name="telephone"
                  className="input-basic"
                  defaultValue={modal.mode === 'edit' ? (modal.hub.telephone ?? '') : ''}
                />
              </Field>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                name="isCentral"
                className="check-basic"
                defaultChecked={modal.mode === 'edit' ? modal.hub.isCentral : false}
              />
              Hub central (entrepôt principal de préparation)
            </label>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Enregistrer
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.kind === 'ville' && (
        <Modal title={modal.mode === 'create' ? 'Nouvelle ville' : 'Modifier la ville'} onClose={() => setModal(null)}>
          <form onSubmit={handleVilleSubmit} className="flex flex-col gap-4">
            <Field label="Nom de la ville" required>
              <input name="nom" className="input-basic" defaultValue={modal.mode === 'edit' ? modal.ville.nom : ''} required />
            </Field>
            <Field label="Hub" required>
              <select
                name="hubId"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.ville.hubId : modal.hubId}
                required
              >
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.nom}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Enregistrer
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
