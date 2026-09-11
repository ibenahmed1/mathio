'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  CalendarClock,
  CheckSquare,
  Download,
  FileText,
  Link2,
  Lock,
  MessagesSquare,
  Paperclip,
  Send,
  Trash2,
  Unlock,
  UploadCloud,
  X,
} from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api-client';
import type { Tache, EquipeTache, MembreTache, Etiquette, PieceJointeTache } from '@/lib/types';
import {
  STATUTS_TACHE,
  LABELS_STATUT_TACHE,
  PRIORITES_TACHE,
  LABELS_PRIORITE_TACHE,
  STATUT_TACHE_DOT,
  formatCleTache,
} from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';
import { MentionTextarea } from '@/components/admin/MentionTextarea';
import { EtiquettesPicker } from '@/components/admin/EtiquettesPicker';
import { Field } from '@/components/form/Field';
// Checklist : faute de table d'étapes côté modèle (§ Tache), les étapes vivent
// dans la description en cases Markdown. La convention est tenue en un seul
// endroit, partagé avec la fiche de création et la carte du board.
import { decouperDescription, recomposerDescription, type EtapeTache as Etape } from '@/lib/taches-description';
import {
  ACCEPT_PIECE_JOINTE,
  TAILLE_MAX_PIECE_JOINTE,
  analyserPieceJointe,
  libelleTaille,
} from '@/lib/pieces-jointes';

// Fiche de détail d'une tâche (§ /admin/tasks) : même gabarit à deux volets
// que la fiche de création — titre en tête, le rédigé à gauche (description,
// checklist, pièces jointes, discussion, activité), les propriétés dans le
// rail de droite (board, statut, priorité, échéance, assigné, étiquettes,
// blocage, auteur). Chaque champ du rail enregistre à la volée, il n'y a pas
// de bouton « Enregistrer ».
export function TaskDetailModal({
  tacheId,
  equipes,
  membres,
  peutAssigner = true,
  peutModifier = true,
  catalogueEtiquettes = [],
  onEtiquetteCreee,
  peutAssignerHorsPole = false,
  onClose,
  onChanged,
}: {
  tacheId: string;
  equipes: EquipeTache[];
  membres: MembreTache[];
  peutAssigner?: boolean;
  peutModifier?: boolean;
  catalogueEtiquettes?: Etiquette[];
  onEtiquetteCreee?: (creee: Etiquette) => void;
  /** Encadrement projet (§ ROLES_ASSIGNATION_TOUS_POLES) : peut désigner
   *  quelqu'un hors du board de la tâche. */
  peutAssignerHorsPole?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tache, setTache] = useState<Tache | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titreDraft, setTitreDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [etapeDraft, setEtapeDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [commentaire, setCommentaire] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [raisonBlocageDraft, setRaisonBlocageDraft] = useState('');
  const [savingBlocage, setSavingBlocage] = useState(false);
  const [pieceNom, setPieceNom] = useState('');
  const [pieceUrl, setPieceUrl] = useState('');
  const [addingPiece, setAddingPiece] = useState(false);
  // Dépôt de fichiers : la zone se surligne pendant le survol d'un glisser, et
  // le bouton « Parcourir » déclenche l'input caché.
  const [surVol, setSurVol] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);
  const [pickerOuvert, setPickerOuvert] = useState(false);
  // Liste d'assignés élargie hors du board (encadrement projet uniquement).
  const [horsPole, setHorsPole] = useState(false);
  const [confirmeSuppression, setConfirmeSuppression] = useState(false);
  // Le menu "Assigner à" et les mentions "@" ne proposent que les membres du
  // pôle de la tâche (§ workflow d'assignation) — se recharge quand l'équipe
  // change (soit au chargement, soit si l'admin la réaffecte).
  const [membresEquipe, setMembresEquipe] = useState<MembreTache[]>(membres);
  const teamId = tache?.teamId;
  useEffect(() => {
    if (!teamId && !horsPole) return;
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

  async function load() {
    try {
      const data = await apiGet<Tache>(`/api/taches/${tacheId}`);
      setTache(data);
      setTitreDraft(data.titre);
      setDescriptionDraft(decouperDescription(data.description).texte);
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
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  const etapes = tache ? decouperDescription(tache.description).etapes : [];

  // Toute écriture de la description recompose texte libre + checklist : les
  // deux vivent dans le même champ, en écrire un seul effacerait l'autre.
  async function enregistrerDescription(texte: string, nouvellesEtapes: Etape[]) {
    setSavingDescription(true);
    const composee = recomposerDescription(texte, nouvellesEtapes);
    const updated = await patch({ description: composee || null });
    if (updated) setDescriptionDraft(decouperDescription(updated.description).texte);
    setSavingDescription(false);
  }

  async function ajouterEtape() {
    const texte = etapeDraft.trim();
    if (!texte) return;
    setEtapeDraft('');
    await enregistrerDescription(descriptionDraft, [...etapes, { texte, fait: false }]);
  }

  async function enregistrerTitre() {
    const titre = titreDraft.trim();
    if (!tache || !titre || titre === tache.titre) {
      if (tache && !titre) setTitreDraft(tache.titre);
      return;
    }
    await patch({ titre });
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

  async function ajouterLien(e: React.FormEvent) {
    e.preventDefault();
    if (!tache || !pieceUrl.trim()) return;
    // On refuse ici ce que le serveur refuserait, avec le même message : ça
    // évite un aller-retour pour un « javascript: » collé par erreur.
    const analyse = analyserPieceJointe(pieceUrl);
    if (analyse.statut === 'refus') {
      setError(analyse.message);
      return;
    }
    setAddingPiece(true);
    setError(null);
    try {
      // Le nom reste facultatif : sans lui, l'API retient l'hôte du lien.
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

  /** Un fichier lu en data URL — même conversion que les photos de compte
   *  (§ UserFormModal), c'est la seule forme que la base sait recevoir. */
  function lireEnDataUrl(fichier: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(String(lecteur.result));
      lecteur.onerror = () => reject(new Error(`Lecture impossible : ${fichier.name}`));
      lecteur.readAsDataURL(fichier);
    });
  }

  // Dépôt de fichiers, par glisser ou par « Parcourir ». Les fichiers partent
  // un par un plutôt qu'en lot : une pièce refusée (format, poids) ne doit pas
  // emporter celles qui l'accompagnaient.
  async function ajouterFichiers(fichiers: File[]) {
    if (!tache || fichiers.length === 0) return;
    setAddingPiece(true);
    setError(null);
    const refus: string[] = [];
    for (const fichier of fichiers) {
      // Contrôle du poids avant lecture : encoder 40 Mo pour se les faire
      // refuser fige l'onglet le temps de la conversion.
      if (fichier.size > TAILLE_MAX_PIECE_JOINTE) {
        refus.push(`${fichier.name} — trop lourd (${libelleTaille(fichier.size)}, maximum ${libelleTaille(TAILLE_MAX_PIECE_JOINTE)})`);
        continue;
      }
      try {
        const dataUrl = await lireEnDataUrl(fichier);
        const analyse = analyserPieceJointe(dataUrl);
        if (analyse.statut === 'refus') {
          refus.push(`${fichier.name} — ${analyse.message}`);
          continue;
        }
        await apiPost(`/api/taches/${tache.id}/pieces-jointes`, { nom: fichier.name, url: dataUrl });
      } catch (err) {
        refus.push(`${fichier.name} — ${err instanceof Error ? err.message : 'Erreur'}`);
      }
    }
    await load();
    onChanged();
    setError(refus.length > 0 ? refus.join(' · ') : null);
    setAddingPiece(false);
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

  // Suppression définitive (§ DELETE /api/taches/[id], refusée aux rôles
  // Kanban-only) : confirmée par un second clic, pas de boîte native.
  async function supprimerTache() {
    if (!tache) return;
    if (!confirmeSuppression) {
      setConfirmeSuppression(true);
      return;
    }
    setError(null);
    try {
      await apiDelete(`/api/taches/${tache.id}`);
      onChanged();
      onClose();
    } catch (err) {
      setConfirmeSuppression(false);
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

  const board = tache ? equipes.find((eq) => eq.id === tache.teamId) ?? tache.team : undefined;
  const commentaires = tache?.commentaires ?? [];
  const historique = tache?.historiqueStatuts ?? [];

  return (
    <div className="kdc-board kdc-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="kdc-modal kdc-modal--wide" onClick={(e) => e.stopPropagation()}>
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

            <input
              className="kdc-titleinput"
              value={titreDraft}
              onChange={(e) => setTitreDraft(e.target.value)}
              onBlur={enregistrerTitre}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setTitreDraft(tache.titre);
              }}
              disabled={!peutModifier}
              aria-label="Titre de la tâche"
            />
            <p className="kdc-modal__meta">
              <span>{board?.nom ?? 'Board inconnu'}</span>
              <span>·</span>
              <span>{formatCleTache(tache.numero)}</span>
              <span>·</span>
              <span>créée le {new Date(tache.dateCreation).toLocaleDateString('fr-FR')}</span>
              {tache.dateEcheance && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {new Date(tache.dateEcheance).toLocaleDateString('fr-FR')}
                  </span>
                </>
              )}
            </p>

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

            <div className="kdc-modal__grid">
              <div className="kdc-modal__col">
                <div className="kdc-field-label">DESCRIPTION</div>
                <textarea
                  className="kdc-textarea mt-[9px] w-full px-3 py-2 text-[12.5px]"
                  rows={4}
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onBlur={() => {
                    if (descriptionDraft !== decouperDescription(tache.description).texte) {
                      enregistrerDescription(descriptionDraft, etapes);
                    }
                  }}
                  placeholder="Aucune description. Cliquez pour en ajouter une."
                  disabled={!peutModifier}
                />
                {savingDescription && (
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    Enregistrement…
                  </span>
                )}

                <div className="kdc-field-label kdc-field-label--icon">
                  <CheckSquare className="h-3.5 w-3.5" aria-hidden /> CHECKLIST
                  {etapes.length > 0 && (
                    <span className="kdc-field-count">
                      ({etapes.filter((e) => e.fait).length}/{etapes.length})
                    </span>
                  )}
                </div>
                {peutModifier && (
                  <div className="kdc-check">
                    <input
                      className="kdc-input"
                      value={etapeDraft}
                      onChange={(e) => setEtapeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          ajouterEtape();
                        }
                      }}
                      placeholder="Ajouter une étape…"
                    />
                    <button
                      type="button"
                      className="kdc-check__add"
                      onClick={ajouterEtape}
                      disabled={!etapeDraft.trim() || savingDescription}
                    >
                      Ajouter
                    </button>
                  </div>
                )}
                {etapes.length > 0 ? (
                  <div className="kdc-check__list">
                    {etapes.map((etape, i) => (
                      // Ligne en <div> et non en <label> : le × de retrait
                      // est à l'intérieur, et un label aurait fait basculer
                      // la case en même temps que la suppression.
                      <div
                        key={`${etape.texte}-${i}`}
                        className={`kdc-check__item ${etape.fait ? 'kdc-check__item--fait' : ''}`}
                      >
                        <input
                          id={`etape-${tache.id}-${i}`}
                          type="checkbox"
                          checked={etape.fait}
                          disabled={!peutModifier || savingDescription}
                          onChange={() =>
                            enregistrerDescription(
                              descriptionDraft,
                              etapes.map((e, j) => (j === i ? { ...e, fait: !e.fait } : e))
                            )
                          }
                        />
                        <label htmlFor={`etape-${tache.id}-${i}`} className="min-w-0 flex-1 cursor-pointer">
                          {etape.texte}
                        </label>
                        {peutModifier && (
                          <button
                            type="button"
                            className="kdc-check__x"
                            onClick={() =>
                              enregistrerDescription(
                                descriptionDraft,
                                etapes.filter((_, j) => j !== i)
                              )
                            }
                            aria-label={`Retirer l'étape ${etape.texte}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="kdc-hint">Aucune étape pour le moment.</p>
                )}

                <div className="kdc-field-label kdc-field-label--icon">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden /> PIÈCES JOINTES
                  {(tache.piecesJointes ?? []).length > 0 && (
                    <span className="kdc-field-count">({(tache.piecesJointes ?? []).length})</span>
                  )}
                </div>
                {(tache.piecesJointes ?? []).length > 0 ? (
                  <div className="kdc-attachments">
                    {(tache.piecesJointes ?? []).map((p) => (
                      <AttachmentRow
                        key={p.id}
                        piece={p}
                        peutRetirer={peutModifier}
                        onRetirer={() => supprimerPieceJointe(p.id)}
                      />
                    ))}
                  </div>
                ) : (
                  !peutModifier && <p className="kdc-hint">Aucune pièce jointe.</p>
                )}
                {peutModifier && (
                  <>
                    {/* Zone de dépôt : c'est le geste attendu pour une capture
                        d'écran ou un PDF. Le champ « lien » reste dessous —
                        beaucoup de pièces sont des documents déjà en ligne. */}
                    <div
                      className={`kdc-drop ${surVol ? 'kdc-drop--over' : ''} ${addingPiece ? 'kdc-drop--busy' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setSurVol(true);
                      }}
                      onDragLeave={() => setSurVol(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setSurVol(false);
                        ajouterFichiers(Array.from(e.dataTransfer.files));
                      }}
                      onClick={() => champFichier.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          champFichier.current?.click();
                        }
                      }}
                    >
                      <UploadCloud className="h-5 w-5" aria-hidden />
                      <span className="kdc-drop__main">
                        {addingPiece ? 'Envoi en cours…' : 'Déposez un fichier ou cliquez pour parcourir'}
                      </span>
                      <span className="kdc-drop__hint">
                        Images, PDF, Word, Excel, PowerPoint, texte, CSV, ZIP — {libelleTaille(TAILLE_MAX_PIECE_JOINTE)}{' '}
                        maximum
                      </span>
                      <input
                        ref={champFichier}
                        type="file"
                        multiple
                        accept={ACCEPT_PIECE_JOINTE}
                        className="hidden"
                        onChange={(e) => {
                          ajouterFichiers(Array.from(e.target.files ?? []));
                          // Remis à zéro pour que redéposer le même fichier
                          // déclenche bien un nouvel évènement `change`.
                          e.target.value = '';
                        }}
                      />
                    </div>

                    <form onSubmit={ajouterLien} className="kdc-attachment-form">
                      <Field label="Ou coller un lien" className="flex-[2]">
                        <input
                          className="input-basic"
                          value={pieceUrl}
                          onChange={(e) => setPieceUrl(e.target.value)}
                          placeholder="drive.google.com/…"
                        />
                      </Field>
                      <Field label="Nom" optional className="flex-1">
                        <input className="input-basic" value={pieceNom} onChange={(e) => setPieceNom(e.target.value)} />
                      </Field>
                      <button type="submit" className="kdc-btn-outline" disabled={addingPiece || !pieceUrl.trim()}>
                        {addingPiece ? 'Ajout…' : 'Ajouter'}
                      </button>
                    </form>
                  </>
                )}

                <div className="kdc-field-label kdc-field-label--icon">
                  <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> DISCUSSION
                  <span className="kdc-field-count">({commentaires.length})</span>
                </div>
                {commentaires.length > 0 ? (
                  <div className="kdc-comments">
                    {commentaires.map((c) => (
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
                  </div>
                ) : (
                  <p className="kdc-hint">Aucun commentaire — lancez la conversation.</p>
                )}
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
                    type="button"
                    className="kdc-btn-primary kdc-discuss__send"
                    onClick={posterCommentaire}
                    disabled={posting || !commentaire.trim()}
                  >
                    <Send className="h-3.5 w-3.5" /> {posting ? 'Envoi…' : 'Publier'}
                  </button>
                </div>

                <div className="kdc-field-label kdc-field-label--icon">
                  <Activity className="h-3.5 w-3.5" aria-hidden /> ACTIVITÉ
                </div>
                {historique.length > 0 ? (
                  <div className="kdc-activity">
                    {[...historique].reverse().map((h) => (
                      <p key={h.id} className="kdc-activity__row">
                        <span className={`kdc-avatar ${avatarClassName(h.utilisateur?.nomComplet ?? null)}`}>
                          {initiales(h.utilisateur?.nomComplet ?? '?')}
                        </span>
                        <span>
                          <strong>{h.utilisateur?.nomComplet ?? 'Quelqu’un'}</strong>{' '}
                          {h.ancienStatut === null
                            ? 'a créé la tâche'
                            : `a déplacé la tâche vers « ${LABELS_STATUT_TACHE[h.nouveauStatut]} »`}
                        </span>
                        <span className="kdc-activity__when">{new Date(h.horodatage).toLocaleString('fr-FR')}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="kdc-hint">Aucun mouvement enregistré.</p>
                )}
              </div>

              <div className="kdc-modal__col kdc-modal__col--side">
                <div className="kdc-field-label">BOARD</div>
                <select
                  className="kdc-select--full"
                  value={tache.teamId}
                  onChange={(e) => patch({ teamId: e.target.value })}
                  disabled={!peutModifier}
                >
                  {equipes.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.nom}
                    </option>
                  ))}
                </select>

                <div className="kdc-field-label">STATUT</div>
                <select
                  className="kdc-select--full"
                  value={tache.statut}
                  onChange={(e) => patch({ statut: e.target.value })}
                  disabled={!peutModifier}
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
                  value={tache.priorite}
                  onChange={(e) => patch({ priorite: e.target.value })}
                  disabled={!peutModifier}
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
                  value={tache.dateEcheance ? tache.dateEcheance.slice(0, 10) : ''}
                  onChange={(e) => patch({ dateEcheance: e.target.value || null })}
                  disabled={!peutModifier}
                />

                {/* Une tâche ne porte qu'un assigné (Tache.assigneeId) :
                    choisir un autre membre remplace le jeton. */}
                <div className="kdc-field-label">ASSIGNÉ</div>
                {tache.assignee ? (
                  <div className="kdc-options">
                    <span className="kdc-token">
                      <span className={`kdc-avatar ${avatarClassName(tache.assignee.nomComplet)}`}>
                        {initiales(tache.assignee.nomComplet)}
                      </span>
                      {tache.assignee.nomComplet}
                      {peutAssigner && (
                        <button
                          type="button"
                          className="kdc-token__x"
                          onClick={() => patch({ assigneeId: null })}
                          aria-label="Retirer l'assignation"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                ) : (
                  <p className="kdc-side__empty">Non assigné</p>
                )}
                {peutAssigner &&
                  (membresEquipe.length > 0 ? (
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
                                patch({ assigneeId: m.id });
                                setPickerOuvert(false);
                              }}
                              className={`kdc-opt ${tache.assigneeId === m.id ? 'kdc-opt--on' : ''}`}
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
                  ))}

                <div className="kdc-field-label">ÉTIQUETTES</div>
                <EtiquettesPicker
                  catalogue={catalogueEtiquettes}
                  selection={tache.etiquettes}
                  onChange={(codes) => patch({ etiquettes: codes })}
                  onCatalogueChange={onEtiquetteCreee}
                  peutCreer={peutAssigner}
                  disabled={!peutModifier}
                />

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

                <div className="kdc-field-label">CRÉÉE PAR</div>
                <p className="kdc-reporter">
                  <span className={`kdc-avatar ${avatarClassName(tache.createur?.nomComplet ?? null)}`}>
                    {initiales(tache.createur?.nomComplet ?? '?')}
                  </span>
                  {tache.createur?.nomComplet ?? 'Inconnu'}
                </p>

                {peutAssigner && (
                  <>
                    <hr className="kdc-side__hr" />
                    <div className="kdc-side__foot">
                      <button type="button" className="kdc-side__danger" onClick={supprimerTache}>
                        <Trash2 className="h-3.5 w-3.5" />
                        {confirmeSuppression ? 'Confirmer la suppression' : 'Supprimer la tâche'}
                      </button>
                      {confirmeSuppression && (
                        <button
                          type="button"
                          className="kdc-side__cancel"
                          onClick={() => setConfirmeSuppression(false)}
                        >
                          Annuler
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Une pièce jointe dans la liste. Trois formes pour trois natures : la vignette
// de l'image elle-même, l'icône de format d'un document, l'hôte d'un lien
// externe — sur une seule ligne on ne distinguait ni l'un ni l'autre.
function AttachmentRow({
  piece,
  peutRetirer,
  onRetirer,
}: {
  piece: PieceJointeTache;
  peutRetirer: boolean;
  onRetirer: () => void;
}) {
  const meta = [
    piece.format.toUpperCase(),
    piece.poids !== null ? libelleTaille(piece.poids) : null,
    piece.auteur?.nomComplet,
    new Date(piece.dateAjout).toLocaleDateString('fr-FR'),
  ].filter(Boolean);

  return (
    <div className={`kdc-attachment kdc-attachment--${piece.type}`}>
      <a
        href={piece.url}
        target="_blank"
        rel="noreferrer"
        className="kdc-attachment__thumb"
        aria-label={`Ouvrir ${piece.nom}`}
      >
        {piece.type === 'image' ? (
          // Balise <img> nue : la route de contenu sert des octets déjà en
          // base, next/image n'aurait rien à optimiser et exigerait un domaine
          // déclaré pour les liens externes.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={piece.url} alt="" loading="lazy" />
        ) : piece.type === 'lien' ? (
          <Link2 className="h-4 w-4" aria-hidden />
        ) : (
          <FileText className="h-4 w-4" aria-hidden />
        )}
        {piece.type !== 'image' && <span className="kdc-attachment__ext">{piece.format}</span>}
      </a>

      <div className="kdc-attachment__body">
        <a href={piece.url} target="_blank" rel="noreferrer" className="kdc-attachment__link">
          {piece.nom}
        </a>
        <p className="kdc-attachment__meta">{meta.join(' · ')}</p>
      </div>

      <div className="kdc-attachment__actions">
        {/* `download` ne vaut que pour la route de contenu, servie par notre
            origine : sur un lien externe le navigateur l'ignore et ouvre la
            cible, ce qui est le comportement attendu là aussi. */}
        <a
          href={piece.url}
          download={piece.nom}
          target="_blank"
          rel="noreferrer"
          className="kdc-attachment__act"
          aria-label={`Télécharger ${piece.nom}`}
          title="Télécharger"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
        </a>
        {peutRetirer && (
          <button
            type="button"
            onClick={onRetirer}
            className="kdc-attachment__act kdc-attachment__act--danger"
            aria-label={`Retirer ${piece.nom}`}
            title="Retirer"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
