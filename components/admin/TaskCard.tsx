'use client';

import { CalendarClock, Lock } from 'lucide-react';
import type { Tache } from '@/lib/types';
import {
  STATUTS_TACHE,
  LABELS_STATUT_TACHE,
  LABELS_PRIORITE_TACHE,
  PRIORITE_TACHE_CLASS,
  STATUT_TACHE_BARRE,
  LABELS_ETIQUETTE_TACHE,
  labelClassName,
  formatCleTache,
  type EtiquetteTache,
} from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';

export function TaskCard({
  tache,
  onOpen,
  onStatutChange,
  onDragStart,
  onDragEnd,
  dragging,
  peutDeplacer = true,
}: {
  tache: Tache;
  onOpen: () => void;
  onStatutChange: (statut: string) => void;
  onDragStart: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  peutDeplacer?: boolean;
}) {
  const echeance = tache.dateEcheance ? new Date(tache.dateEcheance) : null;
  // `Date.now()` est lu pendant le rendu à dessein : le badge « en retard » doit
  // refléter l'heure du rendu courant. Le déporter dans un effet retarderait son
  // apparition d'un cycle de rendu.
  // eslint-disable-next-line react-hooks/purity
  const enRetard = !!echeance && tache.statut !== 'termine' && echeance.getTime() < Date.now();
  const hasProgress = tache.progress > 0 && tache.statut !== 'termine';

  return (
    <div
      draggable={peutDeplacer}
      onDragStart={peutDeplacer ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`kdc-card ${STATUT_TACHE_BARRE[tache.statut]} ${dragging ? 'kdc-card--dragging' : ''}`}
    >
      {/* Ligne d'identité : la référence et les étiquettes à gauche, la
          priorité seule à droite — elle se lit d'un coup d'œil en balayant la
          colonne, ce qu'elle ne faisait pas noyée dans le pied de carte. */}
      <div className="kdc-card__head">
        <div className="kdc-card__labels">
          <span className="kdc-card__key">{formatCleTache(tache.numero)}</span>
          {tache.bloque && (
            <span className="kdc-label kdc-label--bloque" title={tache.raisonBlocage ?? undefined}>
              <Lock className="h-2.5 w-2.5" /> Bloqué
            </span>
          )}
          {tache.etiquettes.map((e) => (
            <span key={e} className={`kdc-label ${labelClassName(e)}`}>
              {LABELS_ETIQUETTE_TACHE[e as EtiquetteTache] ?? e}
            </span>
          ))}
        </div>
        <span className={`kdc-prio ${PRIORITE_TACHE_CLASS[tache.priorite]}`}>
          {LABELS_PRIORITE_TACHE[tache.priorite]}
        </span>
      </div>

      <p className="kdc-card__title">{tache.titre}</p>
      {tache.description && <p className="kdc-card__summary">{tache.description}</p>}

      {hasProgress && (
        <>
          <div className="kdc-progress">
            <div className="kdc-progress__fill" style={{ width: `${tache.progress}%` }} />
          </div>
          <div className="kdc-progress__label">{tache.progress}% terminé</div>
        </>
      )}

      {/* Pied : échéance à gauche, porteur à droite, séparés du corps par un
          filet — les deux informations qu'on cherche une carte déjà lue. */}
      <div className="kdc-card__foot">
        <span className={`kdc-card__due ${enRetard ? 'kdc-card__due--late' : ''}`}>
          <CalendarClock className="h-3.5 w-3.5" />
          {echeance ? echeance.toLocaleDateString('fr-FR') : '—'}
        </span>
        {tache.assignee && (
          <span
            className={`kdc-avatar kdc-avatar--card ${avatarClassName(tache.assignee.nomComplet)}`}
            title={tache.assignee.nomComplet}
          >
            {initiales(tache.assignee.nomComplet)}
          </span>
        )}
      </div>

      <select
        className="kdc-card__statut-select"
        value={tache.statut}
        disabled={!peutDeplacer}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onStatutChange(e.target.value)}
      >
        {STATUTS_TACHE.map((s) => (
          <option key={s} value={s}>
            {LABELS_STATUT_TACHE[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
