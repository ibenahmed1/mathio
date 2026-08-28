'use client';

import { UserCog, Users } from 'lucide-react';
import type { EquipeTache, Tache } from '@/lib/types';
import { STATUTS_TACHE, LABELS_STATUT_TACHE, STATUT_TACHE_DOT, EQUIPE_COULEUR_LABEL } from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';

// Vue "Équipes" du Kanban (§ /admin/tasks), portée à l'identique de l'écran
// 3 du board Kadence (design_handoff_kanban) : une carte par pôle (membres +
// charge ouverte) à gauche, répartition des tâches par statut à droite.
// Lecture seule — la composition des pôles se modifie via TeamManagerModal
// ("Gérer les équipes").
export function TeamsBoardView({
  equipes,
  taches,
  onManage,
  peutGerer = true,
}: {
  equipes: EquipeTache[];
  taches: Tache[];
  onManage: () => void;
  peutGerer?: boolean;
}) {
  const max = Math.max(1, ...STATUTS_TACHE.map((s) => taches.filter((t) => t.statut === s).length));

  return (
    <div className="kdc-board kdc-teams">
      <div className="kdc-teams__list">
        {equipes.map((eq) => {
          const membres = eq.membres ?? [];
          const ouvertes = taches.filter((t) => t.teamId === eq.id && t.statut !== 'termine').length;
          const labelKey = EQUIPE_COULEUR_LABEL[eq.couleur] ?? 'docs';
          return (
            <div key={eq.id} className="kdc-panel">
              <div className="kdc-panel__head">
                <span
                  className="kdc-team-badge"
                  style={{ background: `var(--label-${labelKey}-grad)`, color: `var(--label-${labelKey}-on)` }}
                  aria-hidden
                >
                  <Users className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="kdc-panel__title">{eq.nom}</p>
                  <p className="kdc-panel__sub">Code {eq.code}</p>
                </div>
                <div className="kdc-panel__actions">
                  <span className={`kdc-pill ${ouvertes > 0 ? 'kdc-pill--actif' : ''}`}>
                    {ouvertes} tâche{ouvertes > 1 ? 's' : ''} ouverte{ouvertes > 1 ? 's' : ''}
                  </span>
                  {peutGerer && (
                    <button onClick={onManage} className="kdc-btn-accent flex items-center gap-1">
                      <UserCog className="h-3 w-3" /> Gérer
                    </button>
                  )}
                </div>
              </div>
              <div className="kdc-members">
                {membres.map((m) => {
                  const open = taches.filter((t) => t.assigneeId === m.utilisateur.id && t.statut !== 'termine').length;
                  return (
                    <div key={m.id} className="kdc-member">
                      <span className={`kdc-avatar kdc-avatar--member ${avatarClassName(m.utilisateur.nomComplet)}`}>
                        {initiales(m.utilisateur.nomComplet)}
                      </span>
                      <div className="leading-tight">
                        <p className="kdc-member__name">{m.utilisateur.nomComplet}</p>
                        <p className="kdc-member__meta">
                          {open} tâche{open > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {membres.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                    Aucun membre pour le moment
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {equipes.length === 0 && (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--text-2)' }}>
            Aucune équipe pour le moment
          </p>
        )}
      </div>

      <div className="kdc-teams__side">
        <div className="kdc-panel">
          <p className="kdc-panel__title">Charge par statut</p>
          <div className="kdc-loads">
            {STATUTS_TACHE.map((s) => {
              const count = taches.filter((t) => t.statut === s).length;
              return (
                <div key={s}>
                  <div className="kdc-load__row">
                    <span>{LABELS_STATUT_TACHE[s]}</span>
                    <span>{count}</span>
                  </div>
                  <div className="kdc-load__track">
                    <div className={`kdc-load__fill ${STATUT_TACHE_DOT[s]}`} style={{ width: `${(count / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
