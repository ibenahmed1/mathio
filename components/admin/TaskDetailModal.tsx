'use client';

import { useEffect, useState } from 'react';
import { X, MessagesSquare, CalendarClock, Lock, Unlock, Paperclip, Trash2, History } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api-client';
import type { Tache, EquipeTache, MembreTache } from '@/lib/types';
import {
  STATUTS_TACHE,
  LABELS_STATUT_TACHE,
  PRIORITES_TACHE,
  LABELS_PRIORITE_TACHE,
  STATUT_TACHE_DOT,
  ETIQUETTES_TACHE,
  LABELS_ETIQUETTE_TACHE,
  formatCleTache,
} from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';
import { MentionTextarea } from '@/components/admin/MentionTextarea';
import type { HistoriqueStatutTache } from '@/lib/types';
import { Field } from '@/components/form/Field';

// Temps passé dans chaque colonne (§ traçabilité /admin/tasks) : dérivé en
// diffant les horodatages consécutifs de l'historique (ordonné ASC) plutôt
// que de stocker des bornes début/fin redondantes côté API.
function calculerTempsParStatut(historique: HistoriqueStatutTache[]) {
  const totaux: Record<string, number> = { a_faire: 0, en_cours: 0, termine: 0 };
  for (let i = 0; i < historique.length; i++) {
    const debut = new Date(historique[i].horodatage).getTime();
    const fin = i + 1 < historique.length ? new Date(historique[i + 1].horodatage).getTime() : Date.now();
    totaux[historique[i].nouveauStatut] = (totaux[historique[i].nouveauStatut] ?? 0) + Math.max(0, fin - debut);
  }
  return totaux;
}

function formatDuree(ms: number) {
  const heures = Math.floor(ms / (1000 * 60 * 60));
  if (heures < 1) return '< 1 h';
  if (heures < 24) return `${heures} h`;
  const jours = Math.floor(heures / 24);
  const resteHeures = heures % 24;
  return resteHeures > 0 ? `${jours} j ${resteHeures} h` : `${jours} j`;
}

// Modale de détail d'une tâche (§ /admin/tasks), portée à l'identique de la
// fiche Kadence (design_handoff_kanban) : édition par pastilles cliquables
// (équipe / statut / priorité) plutôt que des <select>, + fil de commentaires
// avec mentions "@membre".
export function TaskDetailModal({
  tacheId,
  equipes,
  membres,
  peutAssigner = true,
  peutModifier = true,
  onClose,
  onChanged,
}: {
  tacheId: string;
  equipes: EquipeTache[];
  membres: MembreTache[];
  peutAssigner?: boolean;
  peutModifier?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tache, setTache] = useState<Tache | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [commentaire, setCommentaire] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [raisonBlocageDraft, setRaisonBlocageDraft] = useState('');
  const [savingBlocage, setSavingBlocage] = useState(false);
  const [pieceNom, setPieceNom] = useState('');
  const [pieceUrl, setPieceUrl] = useState('');
  const [addingPiece, setAddingPiece] = useState(false);
  // Barre de progression modifiable (curseur) : brouillon local pendant le
  // glisser, commit à l'API seulement au relâchement — évite de spammer
  // l'API à chaque pixel de déplacement du curseur.
  const [progressDraft, setProgressDraft] = useState(0);
  useEffect(() => {
    queueMicrotask(() => {
      if (tache) setProgressDraft(tache.progress);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tache?.id, tache?.progress]);

  // Le menu "Assigner à" et les mentions "@" ne proposent que les membres du
  // pôle de la tâche (§ workflow d'assignation) — se recharge quand l'équipe
  // change (soit au chargement, soit si l'admin la réaffecte).
  const [membresEquipe, setMembresEquipe] = useState<MembreTache[]>(membres);
  const teamId = tache?.teamId;
  useEffect(() => {
    if (!teamId) return;
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

  async function load() {
    try {
      const data = await apiGet<Tache>(`/api/taches/${tacheId}`);
      setTache(data);
      setDescription(data.description ?? '');
      setRaisonBlocageDraft(data.raisonBlocage ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tacheId]);

  async function patch(payload: Record<string, unknown>) {
    if (!tache) return;
    setError(null);
    try {
      const updated = await apiPatch<Tache>(`/api/taches/${tache.id}`, payload);
      setTache(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function enregistrerDescription() {
    setSavingDescription(true);
    await patch({ description });
    setSavingDescription(false);
  }

  async function posterCommentaire() {
    if (!tache || !commentaire.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await apiPost(`/api/taches/${tache.id}/commentaires`, { texte: commentaire.trim(), mentionIds });
      setCommentaire('');
      setMentionIds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setPosting(false);
    }
  }

  async function basculerBlocage() {
    if (!tache) return;
    if (tache.bloque) {
      await patch({ bloque: false });
      return;
    }
    const raison = raisonBlocageDraft.trim();
    if (!raison) {
      setError('Une raison est requise pour marquer la tâche comme bloquée');
      return;
    }
    setSavingBlocage(true);
    await patch({ bloque: true, raisonBlocage: raison });
    setSavingBlocage(false);
  }

  async function enregistrerRaisonBlocage() {
    if (!tache || !tache.bloque) return;
    const raison = raisonBlocageDraft.trim();
    if (!raison || raison === tache.raisonBlocage) return;
    setSavingBlocage(true);
    await patch({ raisonBlocage: raison });
    setSavingBlocage(false);
  }

  async function ajouterPieceJointe(e: React.FormEvent) {
    e.preventDefault();
    if (!tache || !pieceNom.trim() || !pieceUrl.trim()) return;
    setAddingPiece(true);
    setError(null);
    try {
      await apiPost(`/api/taches/${tache.id}/pieces-jointes`, { nom: pieceNom.trim(), url: pieceUrl.trim() });
      setPieceNom('');
      setPieceUrl('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setAddingPiece(false);
    }
  }

  async function supprimerPieceJointe(pieceId: string) {
    if (!tache) return;
    setError(null);
    try {
      await apiDelete(`/api/taches/${tache.id}/pieces-jointes/${pieceId}`);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  function surlignerMentions(texte: string) {
    const noms = membresEquipe.map((m) => m.nomComplet).filter((n) => texte.includes(`@${n}`));
    if (noms.length === 0) return texte;
    const echappes = noms.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(@(?:${echappes.join('|')}))`, 'g');
    return texte.split(pattern).map((part, i) =>
      noms.includes(part.slice(1)) && part.startsWith('@') ? (
        <span key={i} className="kdc-mention">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  }

  const tempsParStatut = tache ? calculerTempsParStatut(tache.historiqueStatuts ?? []) : {};

  return (
    <div className="kdc-board kdc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="kdc-modal" onClick={(e) => e.stopPropagation()}>
        {!tache ? (
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            Chargement…
          </p>
        ) : (
          <>
            <div className="kdc-modal__head">
              <span className="kdc-modal__key">{formatCleTache(tache.numero)}</span>
              <span className={`kdc-status-badge ${STATUT_TACHE_DOT[tache.statut]}`}>
                {LABELS_STATUT_TACHE[tache.statut]}
              </span>
              <button onClick={onClose} className="kdc-modal__close" aria-label="Fermer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="kdc-modal__title">{tache.titre}</div>
            {tache.dateEcheance && (
              <p className="kdc-modal__summary flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                {new Date(tache.dateEcheance).toLocaleDateString('fr-FR')}
              </p>
            )}

            {tache.bloque && (
              <div className="kdc-blocked-banner">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <div>
                  <p className="kdc-blocked-banner__title">Bloquée</p>
                  {tache.raisonBlocage && <p className="kdc-blocked-banner__reason">{tache.raisonBlocage}</p>}
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

            <div className="kdc-field-label">DESCRIPTION</div>
            <textarea
              className="kdc-textarea mt-[9px] w-full px-3 py-2 text-[12.5px]"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if (description !== (tache.description ?? '')) enregistrerDescription();
              }}
              placeholder="Aucune description"
              disabled={!peutModifier}
            />
            {savingDescription && (
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                Enregistrement…
              </span>
            )}

            <div className="kdc-field-label">BLOCAGE</div>
            <div className="kdc-options">
              <button
                type="button"
                onClick={basculerBlocage}
                disabled={!peutModifier || savingBlocage}
                className={`kdc-opt kdc-opt--plain ${tache.bloque ? 'kdc-opt--danger kdc-opt--on' : ''}`}
              >
                {tache.bloque ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {tache.bloque ? 'Débloquer' : 'Marquer comme bloqué'}
              </button>
            </div>
            <textarea
              className="kdc-textarea mt-[9px] w-full px-3 py-2 text-[12.5px]"
              rows={2}
              value={raisonBlocageDraft}
              onChange={(e) => setRaisonBlocageDraft(e.target.value)}
              onBlur={enregistrerRaisonBlocage}
              placeholder="Raison du blocage (attente d'accès, bug critique, réponse client…)"
              disabled={!peutModifier}
            />

            <div className="kdc-field-label">ÉQUIPE</div>
            <div className="kdc-options">
              {equipes.map((eq) => {
                const on = tache.teamId === eq.id;
                return (
                  <button
                    key={eq.id}
                    type="button"
                    onClick={() => patch({ teamId: eq.id })}
                    disabled={!peutModifier}
                    className={`kdc-opt kdc-opt--plain ${on ? 'kdc-opt--on' : ''}`}
                  >
                    {eq.nom}
                  </button>
                );
              })}
            </div>

            {peutAssigner ? (
              <>
                <div className="kdc-field-label">ASSIGNER À</div>
                <div className="kdc-options">
                  <button
                    type="button"
                    onClick={() => patch({ assigneeId: null })}
                    className={`kdc-opt kdc-opt--plain ${!tache.assigneeId ? 'kdc-opt--on' : ''}`}
                  >
                    Non assigné
                  </button>
                  {membresEquipe.map((m) => {
                    const on = tache.assigneeId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => patch({ assigneeId: m.id })}
                        className={`kdc-opt ${on ? 'kdc-opt--on' : ''}`}
                      >
                        <span className={`kdc-avatar ${avatarClassName(m.nomComplet)}`}>{initiales(m.nomComplet)}</span>
                        {m.nomComplet.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              tache.assignee && (
                <>
                  <div className="kdc-field-label">ASSIGNÉ À</div>
                  <div className="kdc-options">
                    <span className="kdc-opt kdc-opt--plain kdc-opt--on">
                      <span className={`kdc-avatar ${avatarClassName(tache.assignee.nomComplet)}`}>
                        {initiales(tache.assignee.nomComplet)}
                      </span>
                      {tache.assignee.nomComplet}
                    </span>
                  </div>
                </>
              )
            )}

            <div className="kdc-field-label">STATUT</div>
            <div className="kdc-options">
              {STATUTS_TACHE.map((s) => {
                const on = tache.statut === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => patch({ statut: s })}
                    disabled={!peutModifier}
                    className={`kdc-opt kdc-opt--plain ${on ? 'kdc-opt--on' : ''}`}
                  >
                    <span className={`kdc-dot ${on ? '' : STATUT_TACHE_DOT[s]}`} style={on ? { background: 'var(--on-accent)' } : undefined} />
                    {LABELS_STATUT_TACHE[s]}
                  </button>
                );
              })}
            </div>

            <div className="kdc-field-label">PRIORITÉ</div>
            <div className="kdc-options">
              {PRIORITES_TACHE.map((p) => {
                const on = tache.priorite === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => patch({ priorite: p })}
                    disabled={!peutModifier}
                    className={`kdc-opt kdc-opt--plain ${on ? 'kdc-opt--on' : ''}`}
                  >
                    {LABELS_PRIORITE_TACHE[p]}
                  </button>
                );
              })}
            </div>

            <div className="kdc-field-label">ÉTIQUETTES</div>
            <div className="kdc-options">
              {ETIQUETTES_TACHE.map((k) => {
                const on = tache.etiquettes.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      patch({
                        etiquettes: on ? tache.etiquettes.filter((x) => x !== k) : [...tache.etiquettes, k],
                      })
                    }
                    disabled={!peutModifier}
                    className="kdc-opt kdc-opt--plain"
                    style={
                      on
                        ? { borderColor: `var(--label-${k}-fg)`, background: `var(--label-${k}-bg)`, color: `var(--label-${k}-fg)` }
                        : undefined
                    }
                  >
                    {LABELS_ETIQUETTE_TACHE[k]}
                  </button>
                );
              })}
            </div>

            <div className="kdc-field-label">PROGRESSION</div>
            <div className="mt-[9px] flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progressDraft}
                onChange={(e) => setProgressDraft(Number(e.target.value))}
                onMouseUp={() => patch({ progress: progressDraft })}
                onTouchEnd={() => patch({ progress: progressDraft })}
                onKeyUp={() => patch({ progress: progressDraft })}
                disabled={!peutModifier}
                className="kdc-range"
              />
              <span className="w-10 shrink-0 text-right text-[11.5px] font-bold" style={{ color: 'var(--text-1)' }}>
                {progressDraft}%
              </span>
            </div>

            <div className="kdc-field-label">ÉCHÉANCE (livraison souhaitée)</div>
            <input
              type="date"
              className="kdc-input mt-[9px] w-fit px-3 py-2 text-sm"
              value={tache.dateEcheance ? tache.dateEcheance.slice(0, 10) : ''}
              onChange={(e) => patch({ dateEcheance: e.target.value || null })}
              disabled={!peutModifier}
            />

            <div className="kdc-field-label">PIÈCES JOINTES</div>
            <div className="kdc-attachments">
              {(tache.piecesJointes ?? []).map((p) => (
                <div key={p.id} className="kdc-attachment">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                  <a href={p.url} target="_blank" rel="noreferrer" className="kdc-attachment__link">
                    {p.nom}
                  </a>
                  {peutModifier && (
                    <button
                      type="button"
                      onClick={() => supprimerPieceJointe(p.id)}
                      className="kdc-attachment__remove"
                      aria-label={`Retirer ${p.nom}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {(tache.piecesJointes ?? []).length === 0 && (
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Aucune pièce jointe
                </p>
              )}
            </div>
            {peutModifier && (
              <form onSubmit={ajouterPieceJointe} className="kdc-attachment-form">
                <Field label="Nom du document" className="flex-1">
                  <input className="input-basic" value={pieceNom} onChange={(e) => setPieceNom(e.target.value)} />
                </Field>
                <Field label="Lien" className="flex-1">
                  <input
                    className="input-basic"
                    value={pieceUrl}
                    onChange={(e) => setPieceUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </Field>
                <button
                  type="submit"
                  className="kdc-btn-outline"
                  disabled={addingPiece || !pieceNom.trim() || !pieceUrl.trim()}
                >
                  {addingPiece ? 'Ajout…' : 'Ajouter'}
                </button>
              </form>
            )}

            <div className="kdc-field-label">TRAÇABILITÉ</div>
            <div className="kdc-traceability">
              <div className="kdc-traceability__row">
                <span>Créée le</span>
                <span>{new Date(tache.dateCreation).toLocaleString('fr-FR')}</span>
              </div>
              <div className="kdc-traceability__row">
                <span>Livraison souhaitée</span>
                <span>
                  {tache.dateEcheance ? new Date(tache.dateEcheance).toLocaleDateString('fr-FR') : 'Non définie'}
                </span>
              </div>
              {(tache.historiqueStatuts?.length ?? 0) > 0 && (
                <>
                  <div className="kdc-traceability__subtitle">
                    <History className="h-3 w-3" /> Temps passé par colonne
                  </div>
                  {STATUTS_TACHE.map((s) => (
                    <div key={s} className="kdc-traceability__row">
                      <span className="flex items-center gap-1.5">
                        <span className={`kdc-dot ${STATUT_TACHE_DOT[s]}`} />
                        {LABELS_STATUT_TACHE[s]}
                      </span>
                      <span>{formatDuree(tempsParStatut[s] ?? 0)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <h3 className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                <MessagesSquare className="h-4 w-4" /> Discussion
              </h3>
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {(tache.commentaires ?? []).map((c) => (
                  <div key={c.id} className="kdc-comment text-sm">
                    <p className="kdc-comment__meta">
                      <span className={`kdc-avatar ${avatarClassName(c.auteur?.nomComplet ?? null)}`}>
                        {initiales(c.auteur?.nomComplet ?? '?')}
                      </span>
                      {c.auteur?.nomComplet} · {new Date(c.dateCreation).toLocaleString('fr-FR')}
                    </p>
                    <p className="kdc-comment__body">{surlignerMentions(c.texte)}</p>
                  </div>
                ))}
                {(tache.commentaires ?? []).length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                    Aucun commentaire pour l&apos;instant
                  </p>
                )}
              </div>

              <MentionTextarea
                value={commentaire}
                onChange={(texte, ids) => {
                  setCommentaire(texte);
                  setMentionIds(ids);
                }}
                membres={membresEquipe}
                placeholder="Écrire un commentaire… (@ pour mentionner)"
              />
              <button
                className="kdc-btn-primary self-end px-3 py-1.5 text-xs disabled:opacity-50"
                onClick={posterCommentaire}
                disabled={posting || !commentaire.trim()}
              >
                {posting ? 'Envoi…' : 'Commenter'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
