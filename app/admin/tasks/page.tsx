'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, UserCheck, Users, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Tache, EquipeTache, MembreTache, Etiquette } from '@/lib/types';
import {
  STATUTS_TACHE,
  LABELS_STATUT_TACHE,
  PRIORITES_TACHE,
  LABELS_PRIORITE_TACHE,
  STATUT_TACHE_DOT,
  STATUT_TACHE_COLONNE,
  EQUIPE_COULEUR_LABEL,
} from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';
import { TaskCard } from '@/components/admin/TaskCard';
import { TaskFormModal } from '@/components/admin/TaskFormModal';
import { TaskDetailModal } from '@/components/admin/TaskDetailModal';
import { TeamManagerModal } from '@/components/admin/TeamManagerModal';
import { TeamsBoardView } from '@/components/admin/TeamsBoardView';
import './board.css';

// Rôles cantonnés au Kanban (§ ROLES_KANBAN_UNIQUEMENT dans lib/auth.ts) :
// ils utilisent le tableau mais ne pilotent ni la composition des équipes ni
// l'assignation des tâches (droits réservés au reste du back-office).
const ROLES_SANS_GESTION = ['design', 'gestionnaire_hub'];

// Encadrement projet : peut attribuer une tâche à quelqu'un d'un autre pôle
// (§ ROLES_ASSIGNATION_TOUS_POLES dans lib/taches-scope.ts — la règle est
// tenue côté API, cette liste ne fait qu'afficher la commande). Recopiée ici
// plutôt qu'importée : taches-scope tire Prisma, hors de portée d'un
// composant client.
const ROLES_ASSIGNATION_TOUS_POLES = ['admin', 'responsable', 'superviseur'];

export default function AdminTasksPage() {
  const [vue, setVue] = useState<'board' | 'equipes'>('board');
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Nom du compte courant : sert de « rapporteur » dans la fiche de création.
  const [userNom, setUserNom] = useState<string | null>(null);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [equipes, setEquipes] = useState<EquipeTache[]>([]);
  const [membres, setMembres] = useState<MembreTache[]>([]);
  const [membresAssignables, setMembresAssignables] = useState<MembreTache[]>([]);
  // Catalogue des étiquettes (§ /api/taches/etiquettes) : les tâches ne
  // portent que des codes, libellé et couleur se lisent ici.
  const [etiquettes, setEtiquettes] = useState<Etiquette[]>([]);
  // Liste complète des pôles, réservée à la modale de gestion : la liste
  // principale est cloisonnée aux pôles dont on est membre, or on rattache
  // justement des comptes à des pôles où l'on ne figure pas.
  const [tousLesPoles, setTousLesPoles] = useState<EquipeTache[]>([]);
  const [filtreEquipe, setFiltreEquipe] = useState('');
  const [filtreAssigne, setFiltreAssigne] = useState('');
  const [filtrePriorite, setFiltrePriorite] = useState<'all' | (typeof PRIORITES_TACHE)[number]>('all');
  const [recherche, setRecherche] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formOuvert, setFormOuvert] = useState(false);
  const [gestionEquipeOuverte, setGestionEquipeOuverte] = useState(false);
  const [tacheOuverteId, setTacheOuverteId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Composer inline : repéré par (board, statut) — la même colonne « À faire »
  // existe désormais dans chaque board, un statut seul ne l'identifie plus.
  const [composeIn, setComposeIn] = useState<{ teamId: string; statut: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [assigneesOuvert, setAssigneesOuvert] = useState(false);
  // Board pré-rempli à l'ouverture de « Nouvelle tâche » : celui de la pilule
  // retenue, pour ne pas le rechoisir dans la fiche.
  const [formTeamId, setFormTeamId] = useState<string | undefined>(undefined);

  async function loadEquipes() {
    try {
      const eq = await apiGet<{ data: EquipeTache[] }>('/api/taches/equipes');
      setEquipes(eq.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function loadEtiquettes() {
    try {
      const res = await apiGet<{ data: Etiquette[] }>('/api/taches/etiquettes');
      setEtiquettes(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function loadTaches() {
    try {
      const params = new URLSearchParams();
      if (filtreEquipe) params.set('teamId', filtreEquipe);
      if (filtreAssigne) params.set('assigneeId', filtreAssigne);
      const qs = params.toString();
      const res = await apiGet<{ data: Tache[] }>(`/api/taches${qs ? `?${qs}` : ''}`);
      setTaches(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [mb] = await Promise.all([
          apiGet<{ data: MembreTache[] }>('/api/taches/membres'),
          loadEquipes(),
          loadEtiquettes(),
        ]);
        setMembres(mb.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur');
      }
    })();
    apiGet<{ id: string; role: string; nomComplet: string }>('/api/auth/me')
      .then((me) => {
        setRole(me.role);
        setUserId(me.id);
        setUserNom(me.nomComplet);
      })
      .catch(() => {});
  }, []);

  const peutGererEquipes = role !== null && !ROLES_SANS_GESTION.includes(role);
  const peutAssignerHorsPole = role !== null && ROLES_ASSIGNATION_TOUS_POLES.includes(role);

  useEffect(() => {
    if (!peutGererEquipes) return;
    apiGet<{ data: EquipeTache[] }>('/api/taches/equipes?toutes=1')
      .then((res) => setTousLesPoles(res.data))
      .catch(() => {});
  }, [peutGererEquipes, gestionEquipeOuverte]);
  // Créer / renommer / supprimer un pôle reste réservé à l'admin (cf.
  // app/api/taches/equipes/[id]/route.ts) : le reste du back-office ne pilote
  // que la composition des pôles existants.
  const peutGererPoles = role === 'admin';

  // Rôles Kanban-only : ne peuvent déplacer/modifier que leurs propres cartes
  // (créées ou attribuées) — cf. lib/taches-scope.ts (peutModifierTache) côté API.
  function peutDeplacerTache(t: Tache) {
    if (role === null || !ROLES_SANS_GESTION.includes(role)) return true;
    return t.assigneeId === userId || t.createurId === userId;
  }

  // Le menu "Assigné à" ne propose que les membres du pôle sélectionné (§
  // workflow d'assignation) — évite une liste polluée par tout le
  // back-office quand une équipe précise est déjà choisie.
  useEffect(() => {
    (async () => {
      try {
        const qs = filtreEquipe ? `?equipeId=${filtreEquipe}` : '';
        const res = await apiGet<{ data: MembreTache[] }>(`/api/taches/membres${qs}`);
        setMembresAssignables(res.data);
        if (filtreAssigne && !res.data.some((m) => m.id === filtreAssigne)) setFiltreAssigne('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreEquipe]);

  useEffect(() => {
    Promise.resolve().then(() => loadTaches());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreEquipe, filtreAssigne]);

  const tachesVisibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return taches.filter(
      (t) => (filtrePriorite === 'all' || t.priorite === filtrePriorite) && (!q || t.titre.toLowerCase().includes(q))
    );
  }, [taches, filtrePriorite, recherche]);

  // Un couloir par board (§ vue Board) : le filtre « Équipe » ne masque plus
  // les autres pôles au sein d'une pile commune, il réduit le tableau au seul
  // board choisi.
  const boardsAffiches = useMemo(
    () => (filtreEquipe ? equipes.filter((eq) => eq.id === filtreEquipe) : equipes),
    [equipes, filtreEquipe]
  );

  // Statuts par board : map[teamId][statut]. Les tâches d'un pôle supprimé
  // entre deux chargements gardent malgré tout un seau, sinon elles
  // disparaîtraient du tableau sans que rien ne le signale.
  const parBoard = useMemo(() => {
    const map: Record<string, Record<string, Tache[]>> = {};
    const vide = () => ({ a_faire: [] as Tache[], en_cours: [] as Tache[], termine: [] as Tache[] });
    for (const eq of equipes) map[eq.id] = vide();
    for (const t of tachesVisibles) {
      if (!map[t.teamId]) map[t.teamId] = vide();
      map[t.teamId][t.statut]?.push(t);
    }
    return map;
  }, [tachesVisibles, equipes]);

  // Déplacement d'une carte : lâchée dans un autre couloir, elle change aussi
  // de board — c'est la réaffectation d'une tâche à un autre pôle, au même
  // geste que le changement de statut.
  async function deplacerTache(id: string, statut: string, teamId: string) {
    const avant = taches;
    const cible = avant.find((t) => t.id === id);
    if (!cible || (cible.statut === statut && cible.teamId === teamId)) return;
    const payload: Record<string, unknown> = {};
    if (cible.statut !== statut) payload.statut = statut;
    if (cible.teamId !== teamId) payload.teamId = teamId;
    setTaches((prev) =>
      prev.map((t) => (t.id === id ? { ...t, statut: statut as Tache['statut'], teamId } : t))
    );
    try {
      await apiPatch(`/api/taches/${id}`, payload);
      // Changer de board peut invalider l'assignation (l'assigné n'est pas
      // forcément membre du pôle d'arrivée) : on relit plutôt que de deviner.
      if (payload.teamId) await loadTaches();
    } catch (err) {
      setTaches(avant);
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function changerStatut(id: string, statut: string) {
    const tache = taches.find((t) => t.id === id);
    if (!tache) return;
    await deplacerTache(id, statut, tache.teamId);
  }

  async function creerRapide(teamId: string, statut: string) {
    const titre = draft.trim();
    if (!titre) {
      setComposeIn(null);
      return;
    }
    if (!teamId) {
      setError('Créez une équipe avant d’ajouter une tâche');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await apiPost('/api/taches', { titre, teamId, statut, priorite: 'moyenne' });
      setDraft('');
      setComposeIn(null);
      await loadTaches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setCreating(false);
    }
  }

  const filtresActifs = !!filtreEquipe || !!filtreAssigne || filtrePriorite !== 'all' || !!recherche;

  // Aperçu du déclencheur d'assignés : trois visages au plus, ou le seul
  // membre filtré. Le reste passe dans le « +N » et se lit dans le menu.
  const MAX_APERCU = 3;
  const membreFiltre = membresAssignables.find((m) => m.id === filtreAssigne);
  const apercuAssignes = membreFiltre ? [membreFiltre] : membresAssignables.slice(0, MAX_APERCU);
  const nbAutresMembres = membreFiltre ? 0 : membresAssignables.length - apercuAssignes.length;

  // Deux pôles peuvent porter le même nom : on repère les noms partagés pour
  // afficher leur code sur la pilule et les rendre distinguables.
  const nomsEnDoublon = useMemo(() => {
    const vus = new Set<string>();
    const doublons = new Set<string>();
    for (const eq of equipes) {
      const cle = eq.nom.trim().toLowerCase();
      if (vus.has(cle)) doublons.add(cle);
      vus.add(cle);
    }
    return doublons;
  }, [equipes]);

  return (
    <div className="kdc-board kdc-board-glow">
      <div className="kdc-board-glow__inner flex flex-col gap-3.5">
      <div className="kdc-topbar">
        <div>
          <h1 className="page-title">Tâches</h1>
          <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            {taches.length} tâche{taches.length > 1 ? 's' : ''} au total
          </p>
        </div>
        <div className="kdc-topbar__actions">
          <div className="kdc-viewswitch">
            <button aria-pressed={vue === 'board'} onClick={() => setVue('board')}>
              Board
            </button>
            <button aria-pressed={vue === 'equipes'} onClick={() => setVue('equipes')}>
              Équipes
            </button>
          </div>
          {/* Une seule action pleine dans l'en-tête, le CTA jaune : la gestion
              des équipes se replie sur son icône. */}
          {peutGererEquipes && (
            <button
              className="kdc-iconbtn"
              onClick={() => setGestionEquipeOuverte(true)}
              title="Gérer les équipes"
              aria-label="Gérer les équipes"
            >
              <Users className="h-4 w-4" />
            </button>
          )}
          <button
            className="kdc-btn-primary"
            onClick={() => {
              setFormTeamId(filtreEquipe || undefined);
              setFormOuvert(true);
            }}
          >
            <Plus className="h-4 w-4" /> Nouvelle tâche
          </button>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {vue === 'board' ? (
        <>
          <div className={`kdc-filters ${filtreAssigne === '' ? 'kdc-filters--all' : ''}`}>
            <div className="kdc-search">
              <Search className="h-3.5 w-3.5" style={{ color: 'var(--text-3)' }} />
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher une tâche"
                className="text-xs"
              />
            </div>
            <span className="kdc-filters__sep" aria-hidden />

            <select
              className={`kdc-filtre-select ${filtrePriorite !== 'all' ? 'kdc-filtre-select--on' : ''}`}
              value={filtrePriorite}
              onChange={(e) => setFiltrePriorite(e.target.value as typeof filtrePriorite)}
              aria-label="Priorité"
            >
              <option value="all">Priorité — Toutes</option>
              {PRIORITES_TACHE.map((p) => (
                <option key={p} value={p}>
                  {LABELS_PRIORITE_TACHE[p]}
                </option>
              ))}
            </select>

            {filtresActifs && (
              <button
                onClick={() => {
                  setFiltreEquipe('');
                  setFiltreAssigne('');
                  setFiltrePriorite('all');
                  setRecherche('');
                }}
                className="flex items-center gap-1 px-1.5 text-xs font-semibold transition hover:opacity-100"
                style={{ color: 'var(--text-2)' }}
              >
                <X className="h-3.5 w-3.5" /> Réinitialiser
              </button>
            )}

            {/* Assignés : un seul déclencheur (trois visages + « +N ») qui
                déplie la liste, au lieu d'un rang d'avatars qui mangeait la
                moitié de la barre dès sept membres. */}
            <div className="kdc-assignees">
              <button
                type="button"
                className={`kdc-assignee-trigger ${filtreAssigne ? 'kdc-assignee-trigger--on' : ''}`}
                aria-expanded={assigneesOuvert}
                onClick={() => setAssigneesOuvert((v) => !v)}
              >
                <span className="kdc-assignees__stack">
                  {apercuAssignes.map((m) => (
                    <span key={m.id} className={`kdc-avatar ${avatarClassName(m.nomComplet)}`}>
                      {initiales(m.nomComplet)}
                    </span>
                  ))}
                  {apercuAssignes.length === 0 && (
                    <span className="kdc-avatar kdc-avatar--all" aria-hidden>
                      ALL
                    </span>
                  )}
                </span>
                {membreFiltre ? membreFiltre.nomComplet.split(' ')[0] : nbAutresMembres > 0 ? `+${nbAutresMembres}` : 'Tous'}
              </button>

              {assigneesOuvert && (
                <>
                  <div className="kdc-pop__backdrop" onClick={() => setAssigneesOuvert(false)} aria-hidden />
                  <div className="kdc-pop" role="listbox" aria-label="Filtrer par assigné">
                    <button
                      type="button"
                      className="kdc-pop__item"
                      aria-pressed={filtreAssigne === ''}
                      onClick={() => {
                        setFiltreAssigne('');
                        setAssigneesOuvert(false);
                      }}
                    >
                      <span className="kdc-avatar kdc-avatar--all" aria-hidden>
                        ALL
                      </span>
                      Tout le monde
                    </button>
                    {userId && (
                      <button
                        type="button"
                        className="kdc-pop__item"
                        aria-pressed={filtreAssigne === userId}
                        onClick={() => {
                          setFiltreAssigne(userId);
                          setAssigneesOuvert(false);
                        }}
                      >
                        <UserCheck className="h-4 w-4" aria-hidden />
                        Mes tâches
                      </button>
                    )}
                    <div className="kdc-pop__sep" aria-hidden />
                    {membresAssignables.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="kdc-pop__item"
                        aria-pressed={filtreAssigne === m.id}
                        onClick={() => {
                          setFiltreAssigne(m.id);
                          setAssigneesOuvert(false);
                        }}
                      >
                        <span className={`kdc-avatar ${avatarClassName(m.nomComplet)}`}>{initiales(m.nomComplet)}</span>
                        {m.nomComplet}
                      </button>
                    ))}
                    {membresAssignables.length === 0 && (
                      <p className="kdc-hint" style={{ padding: '6px 9px', margin: 0 }}>
                        Aucun membre dans ce board.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Rang de boards : les pôles se lisent d'un coup d'œil, et la
              pilule retenue tient lieu de titre au tableau qui suit. */}
          {equipes.length > 0 && (
            <div className="kdc-teamsbar" role="group" aria-label="Boards">
              <span className="kdc-teamsbar__label">Boards</span>
              <button
                type="button"
                className="kdc-tab"
                aria-pressed={filtreEquipe === ''}
                onClick={() => setFiltreEquipe('')}
              >
                Tous
              </button>
              {equipes.map((eq) => (
                <button
                  key={eq.id}
                  type="button"
                  className="kdc-tab"
                  aria-pressed={filtreEquipe === eq.id}
                  // Re-cliquer le board affiché lève le filtre : sans ça, la
                  // seule sortie serait la pilule « Tous », qui peut avoir
                  // défilé hors de vue sur un rang long.
                  onClick={() => setFiltreEquipe(filtreEquipe === eq.id ? '' : eq.id)}
                >
                  {eq.nom}
                  {/* Deux pôles peuvent porter le même nom (le code, lui, est
                      unique) : on l'affiche alors pour les distinguer, plutôt
                      que deux pilules jumelles impossibles à départager. */}
                  {nomsEnDoublon.has(eq.nom.trim().toLowerCase()) && <span className="kdc-tab__code">{eq.code}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="kdc-boards">
            {boardsAffiches.map((board) => {
              const colonnes = parBoard[board.id] ?? { a_faire: [], en_cours: [], termine: [] };
              const labelKey = EQUIPE_COULEUR_LABEL[board.couleur] ?? 'docs';
              return (
                <section key={board.id} className="kdc-swimlane">
                  {/* Titre de couloir seulement quand plusieurs boards sont
                      empilés : filtré sur un seul, la pilule retenue le nomme
                      déjà juste au-dessus. */}
                  {boardsAffiches.length > 1 && (
                    <div className="kdc-swimlane__head">
                      <h2
                        className="kdc-swimlane__title"
                        style={{ '--tab-grad': `var(--label-${labelKey}-grad)` } as React.CSSProperties}
                      >
                        <span className="kdc-swimlane__dot" aria-hidden />
                        {board.nom}
                      </h2>
                    </div>
                  )}

                  <div className="kdc-columns">
                      {STATUTS_TACHE.map((statut) => {
                        const compose = composeIn?.teamId === board.id && composeIn.statut === statut;
                        return (
                          <div
                            key={statut}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (dragId) deplacerTache(dragId, statut, board.id);
                              setDragId(null);
                            }}
                            className={`kdc-column ${STATUT_TACHE_COLONNE[statut]}`}
                          >
                            <div className="kdc-column__head">
                              <span className={`kdc-dot ${STATUT_TACHE_DOT[statut]}`} />
                              <span className="kdc-column__title">{LABELS_STATUT_TACHE[statut]}</span>
                              <span className="kdc-column__count">{colonnes[statut]?.length ?? 0}</span>
                              <button
                                onClick={() => {
                                  setComposeIn({ teamId: board.id, statut });
                                  setDraft('');
                                }}
                                className="kdc-column__add"
                                aria-label={`Ajouter une tâche dans ${LABELS_STATUT_TACHE[statut]} du board ${board.nom}`}
                              >
                                +
                              </button>
                            </div>

                            {compose && (
                              <div className="kdc-composer">
                                <input
                                  autoFocus
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') creerRapide(board.id, statut);
                                    if (e.key === 'Escape') setComposeIn(null);
                                  }}
                                  placeholder="Titre de la tâche…"
                                />
                                <div className="kdc-composer__actions">
                                  <button
                                    onClick={() => creerRapide(board.id, statut)}
                                    disabled={creating}
                                    className="kdc-btn-primary kdc-btn-primary--block"
                                  >
                                    {creating ? 'Ajout…' : 'Ajouter'}
                                  </button>
                                  <button onClick={() => setComposeIn(null)} className="kdc-btn-muted">
                                    Annuler
                                  </button>
                                </div>
                              </div>
                            )}

                            {(colonnes[statut] ?? []).map((t) => (
                              <TaskCard
                                key={t.id}
                                tache={t}
                                etiquettes={etiquettes}
                                dragging={dragId === t.id}
                                peutDeplacer={peutDeplacerTache(t)}
                                onOpen={() => setTacheOuverteId(t.id)}
                                onStatutChange={(s) => changerStatut(t.id, s)}
                                onDragStart={() => setDragId(t.id)}
                                onDragEnd={() => setDragId(null)}
                              />
                            ))}
                            {(colonnes[statut] ?? []).length === 0 && !compose && (
                              <div className={`kdc-empty ${dragId ? 'kdc-empty--drop' : ''}`}>
                                {dragId ? 'Déposer ici' : 'Aucune tâche'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </section>
              );
            })}
            {boardsAffiches.length === 0 && (
              <p className="py-6 text-center text-sm" style={{ color: 'var(--text-2)' }}>
                Aucun board pour le moment — créez une équipe pour ouvrir un tableau.
              </p>
            )}
          </div>
        </>
      ) : (
        <TeamsBoardView
          equipes={equipes}
          taches={taches}
          onManage={() => setGestionEquipeOuverte(true)}
          peutGerer={peutGererEquipes}
        />
      )}

      {formOuvert && (
        <TaskFormModal
          equipes={equipes}
          membres={membres}
          peutAssigner={peutGererEquipes}
          teamIdInitial={formTeamId}
          rapporteur={userNom}
          catalogueEtiquettes={etiquettes}
          onEtiquetteCreee={(creee) => setEtiquettes((prev) => [...prev, creee])}
          peutAssignerHorsPole={peutAssignerHorsPole}
          onClose={() => setFormOuvert(false)}
          onSaved={() => {
            setFormOuvert(false);
            loadTaches();
          }}
        />
      )}

      {tacheOuverteId && (
        <TaskDetailModal
          tacheId={tacheOuverteId}
          equipes={equipes}
          membres={membres}
          peutAssigner={peutGererEquipes}
          peutModifier={(() => {
            const t = taches.find((x) => x.id === tacheOuverteId);
            return t ? peutDeplacerTache(t) : true;
          })()}
          catalogueEtiquettes={etiquettes}
          onEtiquetteCreee={(creee) => setEtiquettes((prev) => [...prev, creee])}
          peutAssignerHorsPole={peutAssignerHorsPole}
          onClose={() => setTacheOuverteId(null)}
          onChanged={loadTaches}
        />
      )}

      {gestionEquipeOuverte && (
        <TeamManagerModal
          equipes={tousLesPoles.length > 0 ? tousLesPoles : equipes}
          personnelInterne={membres}
          peutGererPoles={peutGererPoles}
          onClose={() => setGestionEquipeOuverte(false)}
          onChanged={async () => {
            await loadEquipes();
            const pool = await apiGet<{ data: MembreTache[] }>('/api/taches/membres');
            setMembres(pool.data);
            const qs = filtreEquipe ? `?equipeId=${filtreEquipe}` : '';
            const res = await apiGet<{ data: MembreTache[] }>(`/api/taches/membres${qs}`);
            setMembresAssignables(res.data);
            // Les tâches aussi : supprimer un pôle peut les avoir transférées
            // vers un autre (§ DELETE ?transfererVers), et le filtre équipe
            // courant peut porter sur un pôle qui n'existe plus.
            await loadTaches();
          }}
        />
      )}
      </div>
    </div>
  );
}
