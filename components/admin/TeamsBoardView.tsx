'use client';

import { Settings, Users } from 'lucide-react';
import type { EquipeTache, Tache } from '@/lib/types';
import { EQUIPE_COULEUR_LABEL } from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';

// Vue "Équipes" du Kanban (§ /admin/tasks) : une carte par pôle en grille,
// en-tête plein dégradé (la teinte de l'équipe) surmonté d'un filigrane, puis
// la pile d'avatars qui chevauche l'en-tête, l'effectif et l'accès à la
// gestion.
//
// Les dégradés viennent des jetons --label-*-grad (en-tête) et --av-* (membres)
// déjà posés dans app/globals.css : la maquette des cartes et la planche WSKZ
// partagent la même palette de cinq teintes, donc rien n'est figé en dur ici —
// la couleur suit `eq.couleur` et le mode sombre continue de fonctionner.
//
// Lecture seule — la composition des pôles se modifie via TeamManagerModal
// ("Gérer l'équipe").

// Au-delà de cinq pastilles la pile sortait du cadre de la carte (overflow
// hidden) et se faisait rogner : le reste passe dans un « +N » qui livre les
// noms au survol.
const MAX_PILE = 5;

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
  return (
    <div className="kdc-board kdc-teams">
      <div className="kdc-teams__list">
        {equipes.map((eq) => {
          const membres = eq.membres ?? [];
          const pile = membres.slice(0, MAX_PILE);
          const reste = membres.length - pile.length;
          const ouvertes = taches.filter((t) => t.teamId === eq.id && t.statut !== 'termine').length;
          const labelKey = EQUIPE_COULEUR_LABEL[eq.couleur] ?? 'docs';
          return (
            <article key={eq.id} className="kdc-teamcard">
              <header
                className="kdc-teamcard__head"
                style={{ background: `var(--label-${labelKey}-grad)`, color: `var(--label-${labelKey}-on)` }}
              >
                <div className="min-w-0">
                  <p className="kdc-teamcard__name">{eq.nom}</p>
                  <p className="kdc-teamcard__code">Code {eq.code}</p>
                </div>
                <span className="kdc-teamcard__pill">
                  {ouvertes} tâche{ouvertes > 1 ? 's' : ''} ouverte{ouvertes > 1 ? 's' : ''}
                </span>
                <Users className="kdc-teamcard__mark" size={72} strokeWidth={1.2} aria-hidden />
              </header>

              <div className="kdc-teamcard__body">
                {/* Pile chevauchante : l'effectif se lit d'un coup d'œil. Le
                    décompte de tâches par membre, qui n'a plus de place ici,
                    reste accessible au survol de chaque pastille. */}
                <div className="kdc-teamcard__stack">
                  {membres.length > 0 ? (
                    pile.map((m) => {
                      const open = taches.filter((t) => t.assigneeId === m.utilisateur.id && t.statut !== 'termine').length;
                      return (
                        <span
                          key={m.id}
                          title={`${m.utilisateur.nomComplet} — ${open} tâche${open > 1 ? 's' : ''} ouverte${open > 1 ? 's' : ''}`}
                          className={`kdc-avatar ${avatarClassName(m.utilisateur.nomComplet)}`}
                        >
                          {initiales(m.utilisateur.nomComplet)}
                        </span>
                      );
                    })
                  ) : (
                    <span className="kdc-avatar kdc-avatar--vide" aria-hidden>
                      —
                    </span>
                  )}
                  {reste > 0 && (
                    <span
                      className="kdc-avatar kdc-avatar--more"
                      title={membres.slice(MAX_PILE).map((m) => m.utilisateur.nomComplet).join(', ')}
                    >
                      +{reste}
                    </span>
                  )}
                </div>

                <div>
                  <p className="kdc-teamcard__count">
                    {membres.length} membre{membres.length > 1 ? 's' : ''}
                  </p>
                  <p className="kdc-teamcard__names">
                    {membres.length > 0
                      ? membres.map((m) => m.utilisateur.nomComplet).join(', ')
                      : 'Aucun membre pour le moment'}
                  </p>
                </div>

                {peutGerer && (
                  <button type="button" onClick={onManage} className="kdc-teamcard__manage">
                    <Settings className="h-3.5 w-3.5" aria-hidden />
                    Gérer l&apos;équipe
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {equipes.length === 0 && (
          <p className="kdc-teams__vide py-6 text-center text-sm" style={{ color: 'var(--text-2)' }}>
            Aucune équipe pour le moment
          </p>
        )}
      </div>
    </div>
  );
}
