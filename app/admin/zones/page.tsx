'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { HubRegional, Ville, ZoneLogistique } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { IconButton } from '@/components/admin/IconButton';

type ModalState =
  | { kind: 'zone'; mode: 'create' }
  | { kind: 'zone'; mode: 'edit'; zone: ZoneLogistique }
  | { kind: 'hub'; mode: 'create'; zoneId: string }
  | { kind: 'hub'; mode: 'edit'; hub: HubRegional }
  | { kind: 'ville'; mode: 'create'; hubId: string }
  | { kind: 'ville'; mode: 'edit'; ville: Ville }
  | null;

function compterZone(zone: ZoneLogistique) {
  const hubs = zone.hubs ?? [];
  const villes = hubs.reduce((total, hub) => total + (hub.villes?.length ?? 0), 0);
  return { hubs: hubs.length, villes };
}

export default function AdminZonesPage() {
  const [zones, setZones] = useState<ZoneLogistique[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  // Conserve la sélection courante si la zone existe toujours après un
  // rechargement ; sinon retombe sur la première zone (ou aucune sélection
  // s'il n'y en a plus) — évite de perdre le focus admin à chaque mutation.
  async function load() {
    try {
      const res = await apiGet<{ data: ZoneLogistique[] }>('/api/zones');
      setZones(res.data);
      setSelectedZoneId((current) =>
        current && res.data.some((z) => z.id === current) ? current : (res.data[0]?.id ?? null)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Liste à plat de tous les hubs (toutes zones confondues), pour le sélecteur
  // du formulaire "ville" — une ville peut être rattachée à n'importe quel hub.
  const tousLesHubs = useMemo(
    () => zones.flatMap((zone) => (zone.hubs ?? []).map((hub) => ({ ...hub, zoneNom: zone.nom }))),
    [zones]
  );

  const totaux = useMemo(() => {
    const hubs = zones.reduce((total, z) => total + (z.hubs ?? []).length, 0);
    const villes = zones.reduce((total, z) => total + compterZone(z).villes, 0);
    return { zones: zones.length, hubs, villes };
  }, [zones]);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  async function handleZoneSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind !== 'zone') return;
    const fd = new FormData(e.currentTarget);
    const payload = { nom: String(fd.get('nom') ?? ''), code: String(fd.get('code') ?? '') };
    setError(null);
    try {
      if (modal.mode === 'create') {
        await apiPost('/api/zones', payload);
      } else {
        await apiPatch(`/api/zones/${modal.zone.id}`, payload);
      }
      setModal(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function handleHubSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal || modal.kind !== 'hub') return;
    const fd = new FormData(e.currentTarget);
    const payload = { nom: String(fd.get('nom') ?? ''), zoneId: String(fd.get('zoneId') ?? '') };
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
    const payload = {
      nom: String(fd.get('nom') ?? ''),
      type: String(fd.get('type') ?? ''),
      hubId: String(fd.get('hubId') ?? ''),
    };
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

  async function supprimerZone(zone: ZoneLogistique) {
    if (!window.confirm(`Supprimer la zone "${zone.nom}" ? Cette action est irréversible.`)) return;
    setError(null);
    try {
      await apiDelete(`/api/zones/${zone.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimerHub(hub: HubRegional) {
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
          <h1 className="page-title">Zones & Villes</h1>
          <p className="mt-0.5 text-sm opacity-60">
            {totaux.zones} zones · {totaux.hubs} hubs · {totaux.villes} villes
          </p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ kind: 'zone', mode: 'create' })}>
          Nouvelle zone
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr] lg:items-start">
        {/* Liste des zones : navigation, pas d'actions — le détail porte les actions */}
        <div
          className={`flex-col gap-0.5 rounded-lg border border-black/10 p-1.5 dark:border-white/10 ${
            selectedZoneId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {zones.map((zone) => {
            const counts = compterZone(zone);
            const active = zone.id === selectedZoneId;
            return (
              <button
                key={zone.id}
                type="button"
                onClick={() => setSelectedZoneId(zone.id)}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left transition ${
                  active ? 'bg-brand/[0.15] dark:bg-brand/[0.12]' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                }`}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{zone.nom}</span>
                  <span className="text-xs opacity-60">
                    {counts.hubs} hub{counts.hubs > 1 ? 's' : ''} · {counts.villes} ville{counts.villes > 1 ? 's' : ''}
                  </span>
                </span>
                <ChevronRight className={`h-4 w-4 shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-25'}`} />
              </button>
            );
          })}
          {zones.length === 0 && <p className="px-3 py-4 text-sm opacity-60">Aucune zone</p>}
        </div>

        {/* Détail de la zone sélectionnée : hubs et villes */}
        <div className={`flex-col gap-4 ${selectedZoneId ? 'flex' : 'hidden lg:flex'}`}>
          {selectedZone ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedZoneId(null)}
                className="inline-flex items-center gap-1 self-start text-sm font-semibold opacity-60 hover:opacity-100 lg:hidden"
              >
                <ChevronRight className="h-4 w-4 rotate-180" /> Toutes les zones
              </button>

              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold">{selectedZone.nom}</h2>
                    <span className="rounded-full bg-black/[0.06] px-2 py-0.5 font-mono text-[11px] font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                      {selectedZone.code}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs opacity-60">
                    {compterZone(selectedZone).hubs} hub(s) · {compterZone(selectedZone).villes} ville(s)
                  </p>
                </div>
                <div className="flex gap-2">
                  <IconButton
                    variant="edit"
                    label="Modifier la zone"
                    onClick={() => setModal({ kind: 'zone', mode: 'edit', zone: selectedZone })}
                  >
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="delete" label="Supprimer la zone" onClick={() => supprimerZone(selectedZone)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    variant="add"
                    label="Ajouter un hub"
                    onClick={() => setModal({ kind: 'hub', mode: 'create', zoneId: selectedZone.id })}
                  >
                    <Plus className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {(selectedZone.hubs ?? []).map((hub) => (
                  <div key={hub.id} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-bold">{hub.nom}</h3>
                      <div className="flex gap-1.5">
                        <IconButton variant="edit" label="Modifier le hub" onClick={() => setModal({ kind: 'hub', mode: 'edit', hub })}>
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton variant="delete" label="Supprimer le hub" onClick={() => supprimerHub(hub)}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(hub.villes ?? []).map((ville) => (
                        <div
                          key={ville.id}
                          className={`inline-flex items-center overflow-hidden rounded-full text-xs font-medium ${
                            ville.type === 'principale'
                              ? 'bg-black text-white dark:bg-white dark:text-black'
                              : 'border border-black/20 text-black/70 dark:border-white/20 dark:text-white/70'
                          }`}
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
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'ville', mode: 'create', hubId: hub.id })}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-black/25 px-2.5 py-1 text-xs font-medium text-black/50 transition hover:border-emerald-600 hover:text-emerald-600 dark:border-white/25 dark:text-white/50"
                      >
                        <Plus className="h-3 w-3" /> Ville
                      </button>
                    </div>
                  </div>
                ))}
                {(selectedZone.hubs ?? []).length === 0 && (
                  <p className="rounded-lg border border-dashed border-black/15 p-4 text-center text-sm opacity-60 dark:border-white/15">
                    Aucun hub dans cette zone
                  </p>
                )}
              </div>

              {(selectedZone.hubs ?? []).some((h) => (h.villes?.length ?? 0) > 0) && (
                <p className="flex flex-wrap items-center gap-4 text-xs opacity-50">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-black dark:bg-white" /> Ville principale
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-black/40 dark:border-white/40" /> Ville satellite
                  </span>
                </p>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm opacity-60 dark:border-white/15">
              Sélectionnez une zone pour voir ses hubs et villes
            </p>
          )}
        </div>
      </div>

      {modal?.kind === 'zone' && (
        <Modal title={modal.mode === 'create' ? 'Nouvelle zone' : 'Modifier la zone'} onClose={() => setModal(null)}>
          <form onSubmit={handleZoneSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Nom de la zone
              <input
                name="nom"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.zone.nom : ''}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Code (identifiant technique)
              <input
                name="code"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.zone.code : ''}
                required
              />
            </label>
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </form>
        </Modal>
      )}

      {modal?.kind === 'hub' && (
        <Modal title={modal.mode === 'create' ? 'Nouveau hub' : 'Modifier le hub'} onClose={() => setModal(null)}>
          <form onSubmit={handleHubSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Nom du hub
              <input
                name="nom"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.hub.nom : ''}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Zone
              <select
                name="zoneId"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.hub.zoneId : modal.zoneId}
                required
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nom}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </form>
        </Modal>
      )}

      {modal?.kind === 'ville' && (
        <Modal title={modal.mode === 'create' ? 'Nouvelle ville' : 'Modifier la ville'} onClose={() => setModal(null)}>
          <form onSubmit={handleVilleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Nom de la ville
              <input
                name="nom"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.ville.nom : ''}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Type
              <select
                name="type"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.ville.type : 'satellite'}
              >
                <option value="principale">Principale</option>
                <option value="satellite">Satellite</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Hub
              <select
                name="hubId"
                className="input-basic"
                defaultValue={modal.mode === 'edit' ? modal.ville.hubId : modal.hubId}
                required
              >
                {tousLesHubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.nom} ({h.zoneNom})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
