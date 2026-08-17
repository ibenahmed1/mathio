'use client';

import { useEffect, useMemo, useState } from 'react';
import { Key, Pencil, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { apiDelete, apiGet, apiPatch } from '@/lib/api-client';
import type { Utilisateur } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { ReinitialiserMotDePasse } from '@/components/ReinitialiserMotDePasse';
import { TarifsVilleModal } from '@/components/admin/TarifsVilleModal';
import { UserFormModal, ROLE_LABELS, type UserFormMode } from '@/components/admin/UserFormModal';
import { IconButton } from '@/components/admin/IconButton';

const ROLES = [
  'superviseur',
  'moderateur',
  'equipe_suivi',
  'responsable',
  'ramasseur',
  'livreur',
  'design',
  'gestionnaire_hub',
] as const;
type FiltreStatut = 'tous' | 'actif' | 'inactif';

export default function AdminEquipePage() {
  const [utilisateurs, setUtilisateurs] = useState<Utilisateur[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [filtreRole, setFiltreRole] = useState<string>('tous');
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>('tous');
  const [resetId, setResetId] = useState<string | null>(null);
  const [tarifsPourUtilisateur, setTarifsPourUtilisateur] = useState<Utilisateur | null>(null);
  const [formMode, setFormMode] = useState<UserFormMode | null>(null);

  async function load() {
    try {
      const res = await apiGet<{ data: Utilisateur[] }>('/api/utilisateurs');
      setUtilisateurs(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return utilisateurs.filter((u) => {
      if (filtreRole !== 'tous' && u.role !== filtreRole) return false;
      if (filtreStatut === 'actif' && !u.actif) return false;
      if (filtreStatut === 'inactif' && u.actif) return false;
      if (q && !u.nomComplet.toLowerCase().includes(q) && !(u.telephone ?? '').includes(q)) return false;
      return true;
    });
  }, [utilisateurs, filtreRole, filtreStatut, recherche]);

  async function toggleActif(id: string, actif: boolean) {
    setError(null);
    try {
      await apiPatch(`/api/utilisateurs/${id}/actif`, { actif: !actif });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function supprimer(u: Utilisateur) {
    if (!window.confirm(`Supprimer définitivement le compte "${u.nomComplet}" ? Cette action est irréversible.`)) {
      return;
    }
    setError(null);
    try {
      await apiDelete(`/api/utilisateurs/${u.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Équipe</h1>
        <button
          onClick={() => setFormMode({ kind: 'create' })}
          className="btn-primary flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Ajouter utilisateur
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
          <input
            className="input-basic w-64 pl-8"
            placeholder="Rechercher (nom, téléphone)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>

        <select className="input-basic w-52" value={filtreRole} onChange={(e) => setFiltreRole(e.target.value)}>
          <option value="tous">Fonction — Toutes</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>

        <div className="flex gap-1 rounded-md border border-black/10 p-1 dark:border-white/10">
          {(
            [
              ['tous', 'Tous'],
              ['actif', 'Actifs'],
              ['inactif', 'Inactifs'],
            ] as [FiltreStatut, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFiltreStatut(key)}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                filtreStatut === key
                  ? 'bg-brand text-brand-foreground'
                  : 'opacity-60 hover:bg-black/[0.04] hover:opacity-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs opacity-50">
          {visibles.length} compte{visibles.length > 1 ? 's' : ''}
        </span>
      </div>

      <table className="table-basic">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Téléphone</th>
            <th>Fonction</th>
            <th>Statut</th>
            <th>Créé le</th>
            <th>Dernière connexion</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((u) => (
            <tr key={u.id}>
              <td>{u.nomComplet}</td>
              <td>{u.telephone ?? '—'}</td>
              <td>{ROLE_LABELS[u.role] ?? u.role}</td>
              <td>
                <StatutBadge statut={u.actif ? 'actif' : 'suspendu'} />
              </td>
              <td>{new Date(u.dateCreation).toLocaleDateString('fr-FR')}</td>
              <td>{u.derniereConnexion ? new Date(u.derniereConnexion).toLocaleDateString('fr-FR') : '—'}</td>
              <td>
                <div className="flex flex-wrap items-start gap-1.5">
                  <IconButton variant="edit" label="Modifier" onClick={() => setFormMode({ kind: 'edit', utilisateur: u })}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    variant={u.actif ? 'deactivate' : 'activate'}
                    label={u.actif ? 'Désactiver' : 'Activer'}
                    onClick={() => toggleActif(u.id, u.actif)}
                  >
                    <span className={`block h-2.5 w-2.5 rounded-full ${u.actif ? 'bg-orange-600' : 'bg-green-600'}`} />
                  </IconButton>
                  {u.role === 'livreur' && (
                    <IconButton
                      variant="wallet"
                      label="Tarifs de livraison par ville"
                      onClick={() => setTarifsPourUtilisateur(u)}
                    >
                      <Wallet className="h-4 w-4" />
                    </IconButton>
                  )}
                  <IconButton variant="key" label="Réinitialiser le mot de passe" onClick={() => setResetId(u.id)}>
                    <Key className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="delete" label="Supprimer" onClick={() => supprimer(u)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
                {resetId === u.id && (
                  <div className="mt-2">
                    <ReinitialiserMotDePasse utilisateurId={u.id} onDone={() => setResetId(null)} />
                  </div>
                )}
              </td>
            </tr>
          ))}
          {visibles.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center opacity-60">
                Aucun compte ne correspond à ces filtres
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {tarifsPourUtilisateur && (
        <TarifsVilleModal
          utilisateurId={tarifsPourUtilisateur.id}
          nomComplet={tarifsPourUtilisateur.nomComplet}
          onClose={() => setTarifsPourUtilisateur(null)}
        />
      )}

      {formMode && (
        <UserFormModal
          mode={formMode}
          onClose={() => setFormMode(null)}
          onSaved={() => {
            setFormMode(null);
            load();
          }}
        />
      )}
    </div>
  );
}
