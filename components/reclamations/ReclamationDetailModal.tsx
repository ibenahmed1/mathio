'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Reclamation } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { STATUTS_RECLAMATION, LABELS_STATUT_RECLAMATION } from '@/lib/statuts';
// Même gabarit que la fiche d'une tâche (TaskDetailModal) : les classes
// `kdc-*` vivent dans la feuille du Kanban, importée ici pour que la fenêtre
// ait exactement la même taille dans tous les espaces, marchand compris.
import '@/app/admin/tasks/board.css';
import { CodeColis } from '@/components/colis/CodeColis';

// § Réclamations — détail d'une réclamation (14/10/2026), ouvert d'un clic dans
// la liste, côté back-office comme côté marchand. Le message, puis le fil des
// réponses (elles se cumulent) ; le back-office y répond et change le statut,
// le marchand lit. Plus de réponse une fois la réclamation fermée.

const FERMEES = ['resolue', 'rejetee'];

export function ReclamationDetailModal({
  reclamationId,
  espace,
  onClose,
  onChanged,
}: {
  reclamationId: string;
  espace: 'admin' | 'marchand';
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [r, setR] = useState<Reclamation | null>(null);
  const [reponse, setReponse] = useState('');
  const [statut, setStatut] = useState<Reclamation['statut'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const lu = await apiGet<Reclamation>(`/api/reclamations/${reclamationId}`);
    setR(lu);
    setStatut(lu.statut);
  }, [reclamationId]);

  useEffect(() => {
    Promise.resolve()
      .then(() => charger())
      .catch((e) => setError(e instanceof Error ? e.message : 'Erreur'));
  }, [charger]);

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onClose]);

  async function envoyerReponse() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/reclamations/${reclamationId}/reponses`, { texte: reponse });
      setReponse('');
      await charger();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function enregistrerStatut() {
    if (!statut) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/reclamations/${reclamationId}`, { statut });
      await charger();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  const fermee = r ? FERMEES.includes(r.statut) : false;
  const derniere = r?.reponses.at(-1);

  return (
    <div className="kdc-board kdc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="kdc-modal kdc-modal--wide" onClick={(e) => e.stopPropagation()}>
        {!r ? (
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            {error ?? 'Chargement…'}
          </p>
        ) : (
          <>
            <div className="kdc-modal__head">
              <span className="kdc-modal__key">RÉCLAMATION</span>
              <StatutBadge statut={r.statut} />
              <button onClick={onClose} className="kdc-modal__close" aria-label="Fermer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="kdc-modal__title">{r.sujet}</p>
            <p className="kdc-modal__meta">
              {espace === 'admin' && r.marchand && (
                <>
                  <span>{r.marchand.nomBoutique}</span>
                  <span>·</span>
                </>
              )}
              <span>ouverte le {new Date(r.dateCreation).toLocaleString('fr-FR')}</span>
              {r.commande && (
                <>
                  <span>·</span>
                  <span>colis {r.commande.codeSuivi}</span>
                </>
              )}
            </p>

            {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

            <div className="kdc-modal__grid">
              <div className="kdc-modal__col">
                <div className="kdc-field-label">MESSAGE</div>
                <p className="mt-[9px] whitespace-pre-line break-words text-[13px]" style={{ color: 'var(--text-1)' }}>
                  {r.message}
                </p>

                <div className="kdc-field-label">RÉPONSES ({r.reponses.length})</div>
                <div className="mt-[9px] flex flex-col gap-2">
                  {r.reponses.map((rep) => (
                    <div key={rep.id} className="rounded-md border-l-4 border-brand bg-brand/5 px-3 py-2 text-[13px]">
                      <p className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                        {espace === 'admin' ? (rep.auteur ?? 'Support') : 'Réponse du support'} ·{' '}
                        {new Date(rep.dateCreation).toLocaleString('fr-FR')}
                      </p>
                      <p className="mt-1 whitespace-pre-line break-words" style={{ color: 'var(--text-1)' }}>
                        {rep.texte}
                      </p>
                    </div>
                  ))}
                  {r.reponses.length === 0 && (
                    <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                      Pas encore de réponse.
                    </p>
                  )}
                </div>

                {espace === 'admin' &&
                  (fermee ? (
                    <p className="mt-4 text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                      Réclamation fermée : on n&apos;y répond plus. Changez son statut pour la rouvrir.
                    </p>
                  ) : (
                    <>
                      <div className="kdc-field-label">{r.reponses.length > 0 ? 'NOUVELLE RÉPONSE' : 'RÉPONSE'}</div>
                      <textarea
                        className="kdc-textarea mt-[9px] w-full px-3 py-2 text-[12.5px]"
                        rows={4}
                        value={reponse}
                        onChange={(e) => setReponse(e.target.value)}
                        placeholder="Votre réponse au marchand…"
                      />
                      <div className="mt-2 flex justify-end">
                        <button className="kdc-btn-primary" onClick={envoyerReponse} disabled={busy || !reponse.trim()}>
                          {busy ? 'Envoi…' : 'Envoyer la réponse'}
                        </button>
                      </div>
                    </>
                  ))}
              </div>

              <div className="kdc-modal__col kdc-modal__col--side">
                <div className="kdc-field-label">STATUT</div>
                {espace === 'admin' && statut ? (
                  <div className="mt-[9px] flex flex-col gap-2">
                    <select className="input-basic" value={statut} onChange={(e) => setStatut(e.target.value as Reclamation['statut'])}>
                      {STATUTS_RECLAMATION.map((s) => (
                        <option key={s} value={s}>
                          {LABELS_STATUT_RECLAMATION[s]}
                        </option>
                      ))}
                    </select>
                    <button className="btn-outline" onClick={enregistrerStatut} disabled={busy || statut === r.statut}>
                      Enregistrer le statut
                    </button>
                  </div>
                ) : (
                  <div className="mt-[9px]">
                    <StatutBadge statut={r.statut} />
                  </div>
                )}

                <div className="kdc-field-label">COLIS</div>
                <p className="mt-[9px] text-[12.5px]" style={{ color: 'var(--text-1)' }}>
                  {r.commande ? <CodeColis id={r.commande.id} code={r.commande.codeSuivi} espace={espace} /> : '—'}
                </p>

                {espace === 'admin' && (
                  <>
                    <div className="kdc-field-label">BOUTIQUE</div>
                    <p className="mt-[9px] text-[12.5px]" style={{ color: 'var(--text-1)' }}>
                      {r.marchand?.nomBoutique ?? '—'}
                    </p>
                    <div className="kdc-field-label">OUVERTE PAR</div>
                    <p className="mt-[9px] text-[12.5px]" style={{ color: 'var(--text-1)' }}>
                      {r.utilisateur?.nomComplet ?? '—'}
                    </p>
                  </>
                )}

                <div className="kdc-field-label">DERNIÈRE RÉPONSE</div>
                <p className="mt-[9px] text-[12.5px]" style={{ color: 'var(--text-1)' }}>
                  {derniere ? new Date(derniere.dateCreation).toLocaleString('fr-FR') : '—'}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
