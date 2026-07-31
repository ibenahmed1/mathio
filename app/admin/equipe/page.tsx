'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Utilisateur } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';

const ROLES = ['agent_confirmation', 'ramasseur', 'livreur', 'finance', 'sav'] as const;

const ROLE_LABELS: Record<string, string> = {
  agent_confirmation: 'Agent de confirmation',
  ramasseur: 'Ramasseur',
  livreur: 'Livreur',
  finance: 'Finance',
  sav: 'SAV',
};

// "Terrain" regroupe les deux rôles que l'admin gère au quotidien (recrutement
// fréquent, onboarding rapide) — c'est la vue par défaut de cette page. Les
// rôles back-office restent consultables via l'onglet "Autres rôles".
const GROUPES = {
  terrain: ['ramasseur', 'livreur'] as string[],
  autres: ['agent_confirmation', 'finance', 'sav'] as string[],
  tous: ROLES as unknown as string[],
};
type Groupe = keyof typeof GROUPES;

export default function AdminEquipePage() {
  const [utilisateurs, setUtilisateurs] = useState<Utilisateur[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [groupe, setGroupe] = useState<Groupe>('terrain');
  const [genererAuto, setGenererAuto] = useState(true);
  const [form, setForm] = useState({ nomComplet: '', telephone: '', secret: '', role: 'livreur' as string });

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

  const visibles = useMemo(
    () => utilisateurs.filter((u) => GROUPES[groupe].includes(u.role)),
    [utilisateurs, groupe]
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiPost<Utilisateur & { secretTemporaire?: string }>('/api/utilisateurs', {
        nomComplet: form.nomComplet,
        telephone: form.telephone,
        role: form.role,
        secret: genererAuto ? undefined : form.secret,
      });
      if (res.secretTemporaire) {
        window.alert(
          `Compte créé pour "${form.nomComplet}" (${ROLE_LABELS[form.role] ?? form.role}).\n\n` +
            `Identifiant (téléphone) : ${form.telephone}\n` +
            `Mot de passe temporaire : ${res.secretTemporaire}\n\n` +
            `Communique ces informations à la personne concernée — ce mot de passe ne sera plus jamais affiché.`
        );
      }
      setForm({ nomComplet: '', telephone: '', secret: '', role: 'livreur' });
      setGenererAuto(true);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function toggleActif(id: string, actif: boolean) {
    setError(null);
    try {
      await apiPatch(`/api/utilisateurs/${id}/actif`, { actif: !actif });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function reinitialiserMotDePasse(id: string, nomComplet: string) {
    setError(null);
    try {
      const res = await apiPost<{ secretTemporaire: string }>(`/api/utilisateurs/${id}/reinitialiser-mot-de-passe`);
      window.alert(
        `Nouveau mot de passe temporaire pour "${nomComplet}" : ${res.secretTemporaire}\n\nCommunique-le à la personne concernée.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Équipe</h1>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary">
          {showForm ? 'Annuler' : 'Créer un compte'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="grid max-w-xl grid-cols-2 gap-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <input
            className="input-basic"
            placeholder="Nom complet"
            value={form.nomComplet}
            onChange={(e) => setForm({ ...form, nomComplet: e.target.value })}
            required
          />
          <input
            className="input-basic"
            placeholder="Téléphone"
            value={form.telephone}
            onChange={(e) => setForm({ ...form, telephone: e.target.value })}
            required
          />
          <select
            className="input-basic col-span-2"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>

          <label className="col-span-2 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={genererAuto}
              onChange={(e) => setGenererAuto(e.target.checked)}
            />
            Générer le mot de passe automatiquement (recommandé)
          </label>

          {genererAuto ? (
            <p className="col-span-2 -mt-1 text-xs opacity-60">
              Un mot de passe temporaire sera créé et affiché une seule fois après la création du compte.
            </p>
          ) : (
            <input
              className="input-basic col-span-2"
              placeholder="Mot de passe / PIN (4 caractères min.)"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              required
            />
          )}

          <button type="submit" className="btn-primary col-span-2">
            Créer
          </button>
        </form>
      )}

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="flex gap-2 border-b border-black/10 dark:border-white/10">
        {(
          [
            ['terrain', 'Livreurs & ramasseurs'],
            ['autres', 'Autres rôles (back-office)'],
            ['tous', 'Tous'],
          ] as [Groupe, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setGroupe(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
              groupe === key ? 'border-brand text-black dark:text-white' : 'border-transparent opacity-60 hover:opacity-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <table className="table-basic">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Téléphone</th>
            <th>Rôle</th>
            <th>Actif</th>
            <th>Créé le</th>
            <th>Dernière connexion</th>
            <th>Action</th>
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
              <td className="flex flex-wrap gap-2">
                <button onClick={() => toggleActif(u.id, u.actif)} className="btn-outline px-2 py-1 text-xs">
                  {u.actif ? 'Désactiver' : 'Activer'}
                </button>
                <button
                  onClick={() => reinitialiserMotDePasse(u.id, u.nomComplet)}
                  className="btn-outline px-2 py-1 text-xs"
                >
                  Réinitialiser mot de passe
                </button>
              </td>
            </tr>
          ))}
          {visibles.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center opacity-60">
                Aucun compte dans cette catégorie
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
