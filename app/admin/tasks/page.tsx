'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Users, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Tache, EquipeTache, MembreTache } from '@/lib/types';
import { STATUTS_TACHE, LABELS_STATUT_TACHE, PRIORITES_TACHE, LABELS_PRIORITE_TACHE, STATUT_TACHE_DOT } from '@/lib/statuts';
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

export default function AdminTasksPage() {
  const [vue, setVue] = useState<'board' | 'equipes'>('board');
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [equipes, setEquipes] = useState<EquipeTache[]>([]);
  const [membres, setMembres] = useState<MembreTache[]>([]);
  const [membresAssignables, setMembresAssignables] = useState<MembreTache[]>([]);
  const [filtreEquipe, setFiltreEquipe] = useState('');
  const [filtreAssigne, setFiltreAssigne] = useState('');
  const [filtrePriorite, setFiltrePriorite] = useState<'all' | (typeof PRIORITES_TACHE)[number]>('all');
  const [recherche, setRecherche] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formOuvert, setFormOuvert] = useState(false);
  const [gestionEquipeOuverte, setGestionEquipeOuverte] = useState(false);
  const [tacheOuverteId, setTacheOuverteId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [composeIn, setComposeIn] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  async function loadEquipes() {
    try {
      const eq = await apiGet<{ data: EquipeTache[] }>('/api/taches/equipes');
      setEquipes(eq.data);
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
        const [mb] = await Promise.all([apiGet<{ data: MembreTache[] }>('/api/taches/membres'), loadEquipes()]);
        setMembres(mb.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur');
      }
    })();
    apiGet<{ id: string; role: string }>('/api/auth/me')
      .then((me) => {
        setRole(me.role);
        setUserId(me.id);
      })
      .catch(() => {});
  }, []);

  const peutGererEquipes = role !== null && !ROLES_SANS_GESTION.includes(role);
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

  const colonnes = useMemo(() => {
    const map: Record<string, Tache[]> = { a_faire: [], en_cours: [], termine: [] };
    for (const t of tachesVisibles) map[t.statut]?.push(t);
    return map;
  }, [tachesVisibles]);

  async function changerStatut(id: string, statut: string) {
    const avant = taches;
    setTaches((prev) => prev.map((t) => (t.id === id ? { ...t, statut: statut as Tache['statut'] } : t)));
    try {
      await apiPatch(`/api/taches/${id}`, { statut });
    } catch (err) {
      setTaches(avant);
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function creerRapide(statut: string) {
    const titre = draft.trim();
    if (!titre) {
      setComposeIn(null);
      return;
    }
    const teamId = filtreEquipe || equipes[0]?.id;
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

  return (
    <div className="kdc-board kdc-board-glow">
      <div className="kdc-board-glow__inner flex flex-col gap-3.5">
      <div className="kdc-topbar">
        <div>
          <h1 className="kdc-page-title">Tâches</h1>
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
          {peutGererEquipes && (
            <button className="kdc-btn-outline" onClick={() => setGestionEquipeOuverte(true)}>
              <Users className="h-3.5 w-3.5" /> Gérer les équipes
            </button>
          )}
          <button className="kdc-btn-primary" onClick={() => setFormOuvert(true)}>
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
                className="w-40 text-xs"
              />
            </div>
            <span className="kdc-filters__label">FILTRES</span>
            <button
              onClick={() => setFiltrePriorite('all')}
              className={`kdc-chip ${filtrePriorite === 'all' ? 'kdc-chip--active' : ''}`}
            >
              Toutes
            </button>
            {PRIORITES_TACHE.map((p) => (
              <button
                key={p}
                onClick={() => setFiltrePriorite(p)}
                className={`kdc-chip ${filtrePriorite === p ? 'kdc-chip--active' : ''}`}
              >
                {LABELS_PRIORITE_TACHE[p]}
              </button>
            ))}

            <select
              className="kdc-select ml-auto w-44 px-2.5 py-[7px] text-xs"
              value={filtreEquipe}
              onChange={(e) => setFiltreEquipe(e.target.value)}
            >
              <option value="">Équipe — Toutes</option>
              {equipes.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.nom}
                </option>
              ))}
            </select>

            <div className="kdc-assignees">
              <span>Assigné à</span>
              <button
                onClick={() => setFiltreAssigne('')}
                title="Tout le monde"
                aria-pressed={filtreAssigne === ''}
                className="kdc-avatar kdc-avatar--filter kdc-avatar--all"
              >
                ALL
              </button>
              {membresAssignables.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setFiltreAssigne(m.id)}
                  title={m.nomComplet}
                  aria-pressed={filtreAssigne === m.id}
                  className={`kdc-avatar kdc-avatar--filter ${avatarClassName(m.nomComplet)}`}
                >
                  {initiales(m.nomComplet)}
                </button>
              ))}
            </div>

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
          </div>

          <div className="kdc-columns">
            {STATUTS_TACHE.map((statut) => (
              <div
                key={statut}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) changerStatut(dragId, statut);
                  setDragId(null);
                }}
                className="kdc-column"
              >
                <div className="kdc-column__head">
                  <span className={`kdc-dot ${STATUT_TACHE_DOT[statut]}`} />
                  <span className="kdc-column__title">{LABELS_STATUT_TACHE[statut]}</span>
                  <span className="kdc-column__count">{colonnes[statut]?.length ?? 0}</span>
                  <button
                    onClick={() => {
                      setComposeIn(statut);
                      setDraft('');
                    }}
                    disabled={equipes.length === 0}
                    className="kdc-column__add"
                    aria-label={`Ajouter une tâche dans ${LABELS_STATUT_TACHE[statut]}`}
                  >
                    +
                  </button>
                </div>

                {composeIn === statut && (
                  <div className="kdc-composer">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') creerRapide(statut);
                        if (e.key === 'Escape') setComposeIn(null);
                      }}
                      placeholder="Titre de la tâche…"
                    />
                    <div className="kdc-composer__actions">
                      <button
                        onClick={() => creerRapide(statut)}
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
                    dragging={dragId === t.id}
                    peutDeplacer={peutDeplacerTache(t)}
                    onOpen={() => setTacheOuverteId(t.id)}
                    onStatutChange={(s) => changerStatut(t.id, s)}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                  />
                ))}
                {(colonnes[statut] ?? []).length === 0 && composeIn !== statut && (
                  <div className="kdc-dropzone">Déposez une tâche ici</div>
                )}
              </div>
            ))}
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
          onClose={() => setTacheOuverteId(null)}
          onChanged={loadTaches}
        />
      )}

      {gestionEquipeOuverte && (
        <TeamManagerModal
          equipes={equipes}
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
