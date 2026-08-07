'use client';

import { useMemo, useState } from 'react';
import { UserPlus, Users, X } from 'lucide-react';
import { apiPost, apiPut } from '@/lib/api-client';
import type { EquipeTache, MembreTache } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';

const ROLE_LABELS_EQUIPE: Record<string, string> = {
  admin: 'Administrateur',
  superviseur: 'Superviseur',
  moderateur: 'Modérateur',
  equipe_suivi: 'Agent',
  responsable: 'Responsable',
};

const ROLES_INVITATION = ['equipe_suivi', 'admin', 'superviseur', 'moderateur', 'responsable'];

// Workflow d'assignation (§ /admin/tasks) : édite la composition d'un pôle
// (multi-select coché parmi tout le personnel interne) et permet d'inviter
// une personne qui n'a pas encore de compte — elle est créée puis rattachée
// au pôle en un seul appel. Sauvegarde en un PUT qui resynchronise la liste
// complète plutôt qu'un appel par case cochée/décochée.
export function TeamManagerModal({
  equipes,
  personnelInterne,
  onClose,
  onChanged,
}: {
  equipes: EquipeTache[];
  personnelInterne: MembreTache[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [equipeId, setEquipeId] = useState(equipes[0]?.id ?? '');
  const equipe = useMemo(() => equipes.find((eq) => eq.id === equipeId), [equipes, equipeId]);

  const [selection, setSelection] = useState<Set<string>>(
    () => new Set((equipes[0]?.membres ?? []).map((m) => m.utilisateur.id))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteOuvert, setInviteOuvert] = useState(false);
  const [inviteForm, setInviteForm] = useState({ nomComplet: '', email: '', secret: '', role: 'equipe_suivi' });
  const [inviting, setInviting] = useState(false);

  function selectionnerEquipe(id: string) {
    setEquipeId(id);
    const eq = equipes.find((e) => e.id === id);
    setSelection(new Set((eq?.membres ?? []).map((m) => m.utilisateur.id)));
    setError(null);
    setInviteOuvert(false);
  }

  function toggle(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function enregistrer() {
    if (!equipeId) return;
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/api/taches/equipes/${equipeId}/membres`, { utilisateurIds: Array.from(selection) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  async function inviter(e: React.FormEvent) {
    e.preventDefault();
    if (!equipeId) return;
    setInviting(true);
    setError(null);
    try {
      const membre = await apiPost<{ utilisateur: { id: string } }>(
        `/api/taches/equipes/${equipeId}/membres`,
        inviteForm
      );
      setSelection((prev) => new Set(prev).add(membre.utilisateur.id));
      setInviteForm({ nomComplet: '', email: '', secret: '', role: 'equipe_suivi' });
      setInviteOuvert(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setInviting(false);
    }
  }

  // Le personnel invité via ce modal n'est pas toujours revenu dans
  // `personnelInterne` (chargé au montage de la page) tant que onChanged()
  // n'a pas rechargé les données parentes — on complète localement avec les
  // membres déjà connus de l'équipe pour que la case cochée reste visible.
  const personnesAffichees = useMemo(() => {
    const parIds = new Map(personnelInterne.map((p) => [p.id, p]));
    for (const m of equipe?.membres ?? []) {
      if (!parIds.has(m.utilisateur.id)) {
        parIds.set(m.utilisateur.id, { id: m.utilisateur.id, nomComplet: m.utilisateur.nomComplet, role: m.utilisateur.role });
      }
    }
    return Array.from(parIds.values()).sort((a, b) => a.nomComplet.localeCompare(b.nomComplet));
  }, [personnelInterne, equipe]);

  return (
    <Modal title="Gérer les équipes" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Équipe
          <select className="input-basic" value={equipeId} onChange={(e) => selectionnerEquipe(e.target.value)}>
            {equipes.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.nom}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide opacity-60">
            <Users className="h-3.5 w-3.5" /> Membres du pôle
          </p>
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-md border border-black/10 p-1.5 dark:border-white/10">
            {personnesAffichees.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={selection.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="flex-1">{p.nomComplet}</span>
                <span className="text-xs opacity-50">{ROLE_LABELS_EQUIPE[p.role] ?? p.role}</span>
              </label>
            ))}
            {personnesAffichees.length === 0 && (
              <p className="px-2 py-3 text-center text-xs opacity-50">Aucun compte back-office pour le moment</p>
            )}
          </div>
        </div>

        {inviteOuvert ? (
          <form onSubmit={inviter} className="flex flex-col gap-2 rounded-md border border-black/10 p-3 dark:border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide opacity-60">Inviter un membre</p>
              <button type="button" onClick={() => setInviteOuvert(false)} className="opacity-60 hover:opacity-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              className="input-basic"
              placeholder="Nom complet"
              value={inviteForm.nomComplet}
              onChange={(e) => setInviteForm({ ...inviteForm, nomComplet: e.target.value })}
              required
            />
            <input
              className="input-basic"
              type="email"
              placeholder="Email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input-basic"
                type="password"
                placeholder="Mot de passe (6+ car.)"
                minLength={6}
                value={inviteForm.secret}
                onChange={(e) => setInviteForm({ ...inviteForm, secret: e.target.value })}
                required
              />
              <select
                className="input-basic"
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
              >
                {ROLES_INVITATION.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS_EQUIPE[r]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={inviting} className="btn-outline self-start text-xs">
              {inviting ? 'Invitation…' : 'Créer et ajouter au pôle'}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setInviteOuvert(true)}
            className="flex w-fit items-center gap-1.5 text-xs font-semibold text-brand-foreground opacity-80 hover:opacity-100"
          >
            <UserPlus className="h-3.5 w-3.5" /> Inviter un membre
          </button>
        )}

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-black/10 pt-3 dark:border-white/10">
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Fermer
          </button>
          <button type="button" className="btn-primary" onClick={enregistrer} disabled={saving || !equipeId}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
