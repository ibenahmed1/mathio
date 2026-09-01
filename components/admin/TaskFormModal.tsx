'use client';

import { useEffect, useState } from 'react';
import { Activity, CheckSquare, MessagesSquare, Send, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Tache, EquipeTache, MembreTache, Etiquette } from '@/lib/types';
import {
  PRIORITES_TACHE,
  LABELS_PRIORITE_TACHE,
  STATUTS_TACHE,
  LABELS_STATUT_TACHE,
} from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';
import { MentionTextarea } from '@/components/admin/MentionTextarea';
import { EtiquettesPicker } from '@/components/admin/EtiquettesPicker';

// Création d'une tâche (§ /admin/tasks) : même gabarit que la fiche de
// détail — titre en tête, le rédigé à gauche (description, checklist,
// discussion, activité), les propriétés dans le rail de droite (board,
// statut, priorité, échéance, assignés, étiquettes, rapporteur). La modale
// générique (components/admin/Modal) n'est plus utilisée ici : elle impose
// une colonne unique et sa propre chrome, incompatibles avec ce gabarit.
//
// Deux sections n'existent qu'après l'enregistrement, faute de tâche à quoi
// les rattacher : la discussion (le premier commentaire est posté dans la
// foulée de la création) et l'activité (écrite par l'API, jamais par le
// client).
export function TaskFormModal({
  equipes,
  membres,
  peutAssigner = true,
  teamIdInitial,
  statutInitial = 'a_faire',
  rapporteur,
  catalogueEtiquettes = [],
  onEtiquetteCreee,
  peutAssignerHorsPole = false,
  onClose,
  onSaved,
}: {
  equipes: EquipeTache[];
  membres: MembreTache[];
  peutAssigner?: boolean;
  teamIdInitial?: string;
  statutInitial?: (typeof STATUTS_TACHE)[number];
  rapporteur?: string | null;
  catalogueEtiquettes?: Etiquette[];
  onEtiquetteCreee?: (creee: Etiquette) => void;
  /** Encadrement projet (§ ROLES_ASSIGNATION_TOUS_POLES) : peut désigner
   *  quelqu'un hors du board de la tâche. */
  peutAssignerHorsPole?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [etapes, setEtapes] = useState<string[]>([]);
  const [etapeDraft, setEtapeDraft] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState(teamIdInitial || equipes[0]?.id || '');
  const [assigneeId, setAssigneeId] = useState('');
  const [statut, setStatut] = useState<(typeof STATUTS_TACHE)[number]>(statutInitial);
  const [priorite, setPriorite] = useState<(typeof PRIORITES_TACHE)[number]>('moyenne');
  const [etiquettes, setEtiquettes] = useState<string[]>([]);
  const [dateEcheance, setDateEcheance] = useState('');
  const [pickerOuvert, setPickerOuvert] = useState(false);
  // Liste d'assignés élargie hors du board (encadrement projet uniquement).
  const [horsPole, setHorsPole] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Le menu "Assigné" ne propose que les membres du pôle choisi (§ workflow
  // d'assignation) — se recharge à chaque changement de board.
  const [membresEquipe, setMembresEquipe] = useState<MembreTache[]>(membres);
  useEffect(() => {
    if (!teamId && !horsPole) {
      queueMicrotask(() => setMembresEquipe(membres));
      return;
    }
    let annule = false;
    apiGet<{ data: MembreTache[] }>(`/api/taches/membres${horsPole ? '' : `?equipeId=${teamId}`}`)
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
  }, [teamId, horsPole]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!horsPole && assigneeId && !membresEquipe.some((m) => m.id === assigneeId)) setAssigneeId('');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membresEquipe]);

  function ajouterEtape() {
    const etape = etapeDraft.trim();
    if (!etape) return;
    setEtapes((prev) => [...prev, etape]);
    setEtapeDraft('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titre.trim() || !teamId) {
      setError('Le titre et le board sont requis');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // La checklist rejoint la description en cases Markdown : le modèle
      // Tache n'a pas de table d'étapes, et les perdre à l'enregistrement
      // serait pire que de ne pas les proposer.
      const corps = [description.trim(), etapes.map((etape) => `- [ ] ${etape}`).join('\n')]
        .filter(Boolean)
        .join('\n\n');
      const tache = await apiPost<Tache>('/api/taches', {
        titre: titre.trim(),
        description: corps || undefined,
        teamId,
        assigneeId: assigneeId || undefined,
        statut,
        priorite,
        etiquettes,
        dateEcheance: dateEcheance || undefined,
      });
      if (commentaire.trim()) {
        await apiPost(`/api/taches/${tache.id}/commentaires`, { texte: commentaire.trim(), mentionIds });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  const board = equipes.find((eq) => eq.id === teamId);
  const assigne = membresEquipe.find((m) => m.id === assigneeId);

  return (
    <div className="kdc-board kdc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="kdc-modal kdc-modal--wide" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="kdc-modal__head">
            <span className="kdc-modal__key">NOUVELLE TÂCHE</span>
            <button type="button" onClick={onClose} className="kdc-modal__close" aria-label="Fermer">
              <X className="h-4 w-4" />
            </button>
          </div>

          <input
            autoFocus
            className="kdc-titleinput"
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            placeholder="Titre de la tâche…"
            required
          />
          <p className="kdc-modal__meta">
            <span>{board ? board.nom : 'Aucun board'}</span>
            <span>·</span>
            <span>créée le {new Date().toLocaleDateString('fr-FR')}</span>
          </p>

          {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

          <div className="kdc-modal__grid">
            <div className="kdc-modal__col">
              <div className="kdc-field-label">DESCRIPTION</div>
              <textarea
                className="kdc-textarea mt-[9px] w-full px-3 py-2 text-[12.5px]"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Aucune description. Cliquez pour en ajouter une."
              />

              <div className="kdc-field-label kdc-field-label--icon">
                <CheckSquare className="h-3.5 w-3.5" aria-hidden /> CHECKLIST
                {etapes.length > 0 && <span className="kdc-field-count">({etapes.length})</span>}
              </div>
              <div className="kdc-check">
                <input
                  className="kdc-input"
                  value={etapeDraft}
                  onChange={(e) => setEtapeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Entrée ajoute l'étape sans soumettre le formulaire.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      ajouterEtape();
                    }
                  }}
                  placeholder="Ajouter une étape…"
                />
                <button type="button" className="kdc-check__add" onClick={ajouterEtape} disabled={!etapeDraft.trim()}>
                  Ajouter
                </button>
              </div>
              {etapes.length > 0 && (
                <div className="kdc-check__list">
                  {etapes.map((etape, i) => (
                    <div key={`${etape}-${i}`} className="kdc-check__item">
                      <span className="kdc-check__num">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{etape}</span>
                      <button
                        type="button"
                        className="kdc-check__x"
                        onClick={() => setEtapes((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Retirer l'étape ${etape}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="kdc-field-label kdc-field-label--icon">
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> DISCUSSION
                <span className="kdc-field-count">({commentaire.trim() ? 1 : 0})</span>
              </div>
              <p className="kdc-hint">Ce premier commentaire sera publié avec la tâche.</p>
              <div className="kdc-discuss">
                <div className="kdc-discuss__field">
                  <MentionTextarea
                    value={commentaire}
                    onChange={(texte, ids) => {
                      setCommentaire(texte);
                      setMentionIds(ids);
                    }}
                    membres={membresEquipe}
                    placeholder="Écrire un commentaire… (@ pour mentionner)"
                    rows={3}
                  />
                </div>
                <button
                  type="submit"
                  className="kdc-btn-primary kdc-discuss__send"
                  disabled={saving}
                  title="Crée la tâche et publie ce commentaire"
                >
                  <Send className="h-3.5 w-3.5" /> Publier
                </button>
              </div>

              <div className="kdc-field-label kdc-field-label--icon">
                <Activity className="h-3.5 w-3.5" aria-hidden /> ACTIVITÉ
              </div>
              <div className="kdc-activity">
                <p className="kdc-activity__row">
                  {rapporteur && (
                    <span className={`kdc-avatar ${avatarClassName(rapporteur)}`}>{initiales(rapporteur)}</span>
                  )}
                  <span>
                    {rapporteur ? <strong>{rapporteur}</strong> : <strong>Vous</strong>} créera la tâche à
                    l&apos;enregistrement
                  </span>
                </p>
                <p className="kdc-hint">Le reste du journal s&apos;écrit ensuite, à chaque modification.</p>
              </div>
            </div>

            <div className="kdc-modal__col kdc-modal__col--side">
              <div className="kdc-field-label">BOARD</div>
              <select className="kdc-select--full" value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                {equipes.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.nom}
                  </option>
                ))}
              </select>

              <div className="kdc-field-label">STATUT</div>
              <select
                className="kdc-select--full"
                value={statut}
                onChange={(e) => setStatut(e.target.value as typeof statut)}
              >
                {STATUTS_TACHE.map((s) => (
                  <option key={s} value={s}>
                    {LABELS_STATUT_TACHE[s]}
                  </option>
                ))}
              </select>

              <div className="kdc-field-label">PRIORITÉ</div>
              <select
                className="kdc-select--full"
                value={priorite}
                onChange={(e) => setPriorite(e.target.value as typeof priorite)}
              >
                {PRIORITES_TACHE.map((p) => (
                  <option key={p} value={p}>
                    {LABELS_PRIORITE_TACHE[p]}
                  </option>
                ))}
              </select>

              <div className="kdc-field-label">ÉCHÉANCE</div>
              <input
                type="date"
                className="kdc-input kdc-input--full"
                value={dateEcheance}
                onChange={(e) => setDateEcheance(e.target.value)}
              />

              {peutAssigner && (
                <>
                  {/* Une tâche ne porte qu'un assigné (Tache.assigneeId) :
                      choisir un autre membre remplace le jeton au lieu de
                      l'ajouter. */}
                  <div className="kdc-field-label">ASSIGNÉ</div>
                  {assigne ? (
                    <div className="kdc-options">
                      <span className="kdc-token">
                        <span className={`kdc-avatar ${avatarClassName(assigne.nomComplet)}`}>
                          {initiales(assigne.nomComplet)}
                        </span>
                        {assigne.nomComplet}
                        <button
                          type="button"
                          className="kdc-token__x"
                          onClick={() => setAssigneeId('')}
                          aria-label="Retirer l'assignation"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                  ) : (
                    <p className="kdc-side__empty">Non assigné</p>
                  )}
                  {membresEquipe.length > 0 ? (
                    <>
                      <button type="button" className="kdc-side__add" onClick={() => setPickerOuvert((v) => !v)}>
                        {pickerOuvert ? '− Fermer la liste' : '+ Choisir un membre'}
                      </button>
                      {peutAssignerHorsPole && (
                        <label className="kdc-invite__check" style={{ marginTop: 7 }}>
                          <input
                            type="checkbox"
                            checked={horsPole}
                            onChange={(e) => setHorsPole(e.target.checked)}
                          />
                          Chercher hors du board
                        </label>
                      )}
                      {pickerOuvert && (
                        <div className="kdc-side__picker">
                          {membresEquipe.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                setAssigneeId(m.id);
                                setPickerOuvert(false);
                              }}
                              className={`kdc-opt ${assigneeId === m.id ? 'kdc-opt--on' : ''}`}
                            >
                              <span className={`kdc-avatar ${avatarClassName(m.nomComplet)}`}>
                                {initiales(m.nomComplet)}
                              </span>
                              {m.nomComplet.split(' ')[0]}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="kdc-side__empty">Aucun membre dans ce board</p>
                  )}
                </>
              )}

              <div className="kdc-field-label">ÉTIQUETTES</div>
              <EtiquettesPicker
                catalogue={catalogueEtiquettes}
                selection={etiquettes}
                onChange={setEtiquettes}
                onCatalogueChange={onEtiquetteCreee}
                peutCreer={peutAssigner}
              />

              <div className="kdc-field-label">RAPPORTEUR</div>
              <p className="kdc-reporter">
                {rapporteur ? (
                  <>
                    <span className={`kdc-avatar ${avatarClassName(rapporteur)}`}>{initiales(rapporteur)}</span>
                    {rapporteur}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>Vous</span>
                )}
              </p>

              <hr className="kdc-side__hr" />
              <div className="kdc-side__foot">
                <button type="submit" className="kdc-btn-primary" disabled={saving}>
                  {saving ? 'Enregistrement…' : 'Créer la tâche'}
                </button>
                <button type="button" className="kdc-side__cancel" onClick={onClose} disabled={saving}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
