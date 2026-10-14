'use client';

import { useEffect, useState } from 'react';
import { MessageSquareWarning, Reply } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Reclamation } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { ReclamationDetailModal } from '@/components/reclamations/ReclamationDetailModal';
import { STATUTS_RECLAMATION, LABELS_STATUT_RECLAMATION } from '@/lib/statuts';

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
                <tr key={r.id} onClick={() => setActif(r)} style={{ cursor: 'pointer' }}>
                  <td className="whitespace-nowrap text-xs opacity-70">{new Date(r.dateCreation).toLocaleString('fr-FR')}</td>
                  <td>{r.marchand?.nomBoutique ?? '—'}</td>
                  <td>{r.sujet}</td>
                  <td className="font-mono text-xs">{r.commande?.codeSuivi ?? '—'}</td>
                  <td>
                    <StatutBadge statut={r.statut} />
                  </td>
                  <td>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActif(r);
                      }}
                      className="btn-outline flex items-center gap-1 px-2 py-1 text-xs">
                      <Reply className="h-3 w-3" />
                      {r.reponses.length > 0 ? `Réponses (${r.reponses.length})` : 'Répondre'}
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

      {/* Détail d'un clic sur la ligne : même fenêtre que la fiche d'une tâche. */}
      {actif && (
        <ReclamationDetailModal reclamationId={actif.id} espace="admin" onClose={() => setActif(null)} onChanged={load} />
      )}
    </div>
  );
}
