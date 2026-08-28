'use client';

import { useEffect, useState } from 'react';
import { MessageSquareWarning, Reply } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api-client';
import type { Reclamation } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { Modal } from '@/components/admin/Modal';
import { STATUTS_RECLAMATION, LABELS_STATUT_RECLAMATION } from '@/lib/statuts';
import { Field } from '@/components/form/Field';

export default function AdminReclamationsPage() {
  const [reclamations, setReclamations] = useState<Reclamation[]>([]);
  const [statutFiltre, setStatutFiltre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actif, setActif] = useState<Reclamation | null>(null);

  async function load() {
    try {
      const params = statutFiltre ? `?statut=${statutFiltre}` : '';
      const res = await apiGet<{ data: Reclamation[] }>(`/api/reclamations${params}`);
      setReclamations(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutFiltre]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Réclamations</h1>

      <select className="input-basic w-fit" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)}>
        <option value="">Tous les statuts</option>
        {STATUTS_RECLAMATION.map((s) => (
          <option key={s} value={s}>
            {LABELS_STATUT_RECLAMATION[s]}
          </option>
        ))}
      </select>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="table-card">
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[900px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Marchand</th>
                <th>Sujet</th>
                <th>Colis</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reclamations.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(r.dateCreation).toLocaleString('fr-FR')}</td>
                  <td>{r.marchand?.nomBoutique ?? '—'}</td>
                  <td>{r.sujet}</td>
                  <td className="font-mono text-xs">{r.commande?.codeSuivi ?? '—'}</td>
                  <td>
                    <StatutBadge statut={r.statut} />
                  </td>
                  <td>
                    <button onClick={() => setActif(r)} className="btn-outline flex items-center gap-1 px-2 py-1 text-xs">
                      <Reply className="h-3 w-3" />
                      Répondre
                    </button>
                  </td>
                </tr>
              ))}
              {reclamations.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <MessageSquareWarning className="h-8 w-8 opacity-40" />
                      <p className="font-medium">Aucune réclamation</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {actif && (
        <ReponseModal
          reclamation={actif}
          onClose={() => setActif(null)}
          onSaved={() => {
            setActif(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ReponseModal({
  reclamation,
  onClose,
  onSaved,
}: {
  reclamation: Reclamation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [statut, setStatut] = useState(reclamation.statut);
  const [reponse, setReponse] = useState(reclamation.reponse ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/reclamations/${reclamation.id}`, { statut, reponse });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Réclamation — ${reclamation.sujet}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="rounded-md bg-black/[0.03] p-3 text-sm dark:bg-white/[0.05]">
          <p className="text-xs opacity-60">
            {reclamation.marchand?.nomBoutique} · {new Date(reclamation.dateCreation).toLocaleString('fr-FR')}
            {reclamation.commande ? ` · Colis ${reclamation.commande.codeSuivi}` : ''}
          </p>
          <p className="mt-1">{reclamation.message}</p>
        </div>

        <Field label="Statut">
          <select className="input-basic" value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}>
            {STATUTS_RECLAMATION.map((s) => (
              <option key={s} value={s}>
                {LABELS_STATUT_RECLAMATION[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Réponse">
          <textarea className="input-basic" rows={4} value={reponse} onChange={(e) => setReponse(e.target.value)} />
        </Field>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </Modal>
  );
}
