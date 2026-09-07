'use client';

import { CalendarClock, Check, Lock } from 'lucide-react';
import type { Tache, Etiquette } from '@/lib/types';
import { decouperDescription } from '@/lib/taches-description';
import {
  STATUTS_TACHE,
  LABELS_STATUT_TACHE,
  LABELS_PRIORITE_TACHE,
  PRIORITE_TACHE_CLASS,
  STATUT_TACHE_BARRE,
  labelClassName,
  formatCleTache,
} from '@/lib/statuts';
import { initiales, avatarClassName } from '@/lib/avatar';

export function TaskCard({
  tache,
  etiquettes = [],
  onOpen,
  onStatutChange,
  onDragStart,
  onDragEnd,
  dragging,
  peutDeplacer = true,
}: {
  tache: Tache;
  /** Catalogue des étiquettes (§ /api/taches/etiquettes) : la tâche ne porte
   *  que des codes, le libellé et la couleur se lisent ici. */
  etiquettes?: Etiquette[];
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

  // La checklist vit dans la description, en cases Markdown (§
  // lib/taches-description). Sans ce découpage, le résumé de la carte
  // affichait « - [ ] Relancer le prestataire » tel quel, tirets et crochets
  // compris — et les deux premières étapes mangeaient la place du résumé.
  const { texte: resume, etapes } = decouperDescription(tache.description);
  // Deux avancements coexistent : les cases de la checklist, et
  // `Tache.progress`, saisi à la main (il pilote le passage automatique en
  // « En cours », cf. PATCH /api/taches/[id]). Une carte n'en montre qu'un —
  // la checklist prime, c'est celui que quelqu'un tient à jour geste après
  // geste, et les cases le disent mieux qu'une barre.
  const hasProgress = etapes.length === 0 && tache.progress > 0 && tache.statut !== 'termine';
  // Trois étapes visibles : au-delà, la carte devient plus haute que ce qu'une
  // colonne peut montrer d'un coup d'œil. Les non cochées d'abord — ce qui
  // reste à faire est ce qu'on vient chercher sur un board.
  const apercuEtapes = [...etapes].sort((a, b) => Number(a.fait) - Number(b.fait)).slice(0, 3);

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
          {tache.etiquettes.map((code) => {
            // Une étiquette supprimée entre deux chargements laisse son code
            // sur la carte : on l'affiche en gris plutôt que de le masquer.
            const et = etiquettes.find((x) => x.code === code);
            return (
              <span key={code} className={`kdc-label ${labelClassName(et?.couleur ?? 'docs')}`}>
                {et?.nom ?? code}
              </span>
            );
          })}
        </div>
        <span className={`kdc-prio ${PRIORITE_TACHE_CLASS[tache.priorite]}`}>
          {LABELS_PRIORITE_TACHE[tache.priorite]}
        </span>
      </div>

      <p className="kdc-card__title">{tache.titre}</p>
      {resume && <p className="kdc-card__summary">{resume}</p>}

      {etapes.length > 0 && (
        <ul className="kdc-steps">
          {apercuEtapes.map((etape, i) => (
            <li key={`${etape.texte}-${i}`} className={`kdc-steps__item ${etape.fait ? 'kdc-steps__item--fait' : ''}`}>
              <span className="kdc-steps__box" aria-hidden>
                {etape.fait && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
              </span>
              <span className="kdc-steps__texte">{etape.texte}</span>
            </li>
          ))}
          {etapes.length > apercuEtapes.length && (
            <li className="kdc-steps__reste">+{etapes.length - apercuEtapes.length} autres étapes</li>
          )}
        </ul>
      )}

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
