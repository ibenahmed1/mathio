'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Tache, EquipeTache, MembreTache } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { PRIORITES_TACHE, LABELS_PRIORITE_TACHE } from '@/lib/statuts';

export function TaskFormModal({
  equipes,
  membres,
  peutAssigner = true,
  onClose,
  onSaved,
}: {
  equipes: EquipeTache[];
  membres: MembreTache[];
  peutAssigner?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState(equipes[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [priorite, setPriorite] = useState<(typeof PRIORITES_TACHE)[number]>('moyenne');
  const [dateEcheance, setDateEcheance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Le menu "Assigné" ne propose que les membres du pôle choisi (§ workflow
  // d'assignation) — se recharge à chaque changement d'équipe.
  const [membresEquipe, setMembresEquipe] = useState<MembreTache[]>(membres);
  useEffect(() => {
    if (!teamId) {
      setMembresEquipe(membres);
      return;
    }
    let annule = false;
    apiGet<{ data: MembreTache[] }>(`/api/taches/membres?equipeId=${teamId}`)
      .then((res) => {
        if (!annule) setMembresEquipe(res.data);
      })
      .catch(() => {
        if (!annule) setMembresEquipe(membres);
      });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  useEffect(() => {
    if (assigneeId && !membresEquipe.some((m) => m.id === assigneeId)) setAssigneeId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membresEquipe]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titre.trim() || !teamId) {
      setError('Le titre et l’équipe sont requis');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost<Tache>('/api/taches', {
        titre: titre.trim(),
        description: description.trim() || undefined,
        teamId,
        assigneeId: assigneeId || undefined,
        priorite,
        dateEcheance: dateEcheance || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Nouvelle tâche" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Titre *
          <input className="input-basic" value={titre} onChange={(e) => setTitre(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Description
          <textarea
            className="input-basic"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Équipe *
            <select className="input-basic" value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
              {equipes.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.nom}
                </option>
              ))}
            </select>
          </label>
          {peutAssigner && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Assigné
              <select className="input-basic" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Non assigné</option>
                {membresEquipe.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nomComplet}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            Priorité
            <select
              className="input-basic"
              value={priorite}
              onChange={(e) => setPriorite(e.target.value as typeof priorite)}
            >
              {PRIORITES_TACHE.map((p) => (
                <option key={p} value={p}>
                  {LABELS_PRIORITE_TACHE[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Échéance
            <input
              type="date"
              className="input-basic"
              value={dateEcheance}
              onChange={(e) => setDateEcheance(e.target.value)}
            />
          </label>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Créer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
