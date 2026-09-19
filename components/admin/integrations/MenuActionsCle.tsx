'use client';

import { useRef, useState } from 'react';
import { MoreVertical, RotateCcw, ShieldOff, SquarePen, Timer, Trash2 } from 'lucide-react';
import {
  ActionsMenuPanel,
  actionsMenuItemClass,
  actionsMenuItemDangerClass,
} from '@/components/ActionsMenuPanel';
import type { CleApi } from '@/lib/types';

export type ActionCle = 'modifier' | 'expirer' | 'annuler-expiration' | 'revoquer' | 'supprimer';

// Menu « ⋮ » d'une ligne de clé.
//
// Quatre boutons alignés dans la cellule tenaient tant qu'il y en avait deux ;
// à cinq gestes la rangée déborde et la table se met à défiler latéralement sur
// un portable. Même motif que les listes de colis, donc même composant.
//
// Chaque entrée n'apparaît que quand elle est POSSIBLE, et les conditions
// reprennent celles que le serveur applique : une clé révoquée ne se modifie
// plus, une clé qui a servi ne se supprime plus (ses compteurs sont la seule
// trace exploitable en cas de fuite), une expiration ne s'annule que tant que
// l'échéance est devant nous. Proposer un geste qui finira en 409 fait porter
// à l'utilisateur une règle qu'on connaît déjà.
export function MenuActionsCle({ cle, onAction }: { cle: CleApi; onAction: (action: ActionCle) => void }) {
  const ancre = useRef<HTMLButtonElement | null>(null);
  const [ouvert, setOuvert] = useState(false);

  const expirationEnCours = Boolean(cle.expireLe) && cle.active;

  const entrees: { action: ActionCle; libelle: string; icone: typeof Timer; danger?: boolean }[] = [];
  if (!cle.revoqueeLe) entrees.push({ action: 'modifier', libelle: 'Libellé et quota', icone: SquarePen });
  if (cle.active && !expirationEnCours) {
    entrees.push({ action: 'expirer', libelle: 'Expirer dans 7 jours', icone: Timer });
  }
  if (expirationEnCours) {
    entrees.push({ action: 'annuler-expiration', libelle: 'Annuler l’expiration', icone: RotateCcw });
  }
  if (cle.active) entrees.push({ action: 'revoquer', libelle: 'Révoquer', icone: ShieldOff, danger: true });
  if (cle.nbAppels === 0) {
    entrees.push({ action: 'supprimer', libelle: 'Supprimer', icone: Trash2, danger: true });
  }

  // Une clé révoquée qui a déjà servi n'offre plus rien : elle reste à
  // l'écran pour ses compteurs, et un menu vide vaut mieux qu'un bouton qui
  // n'ouvre rien.
  if (entrees.length === 0) return null;

  return (
    <>
      <button
        ref={ancre}
        type="button"
        className="btn-ghost btn-sm"
        aria-label="Actions sur la clé"
        onClick={() => setOuvert((o) => !o)}
      >
        <MoreVertical size={16} />
      </button>

      <ActionsMenuPanel anchorRef={ancre} open={ouvert} onClose={() => setOuvert(false)} width={224}>
        {entrees.map((e) => (
          <button
            key={e.action}
            onClick={() => {
              setOuvert(false);
              onAction(e.action);
            }}
            className={e.danger ? actionsMenuItemDangerClass : actionsMenuItemClass}
          >
            <e.icone className="h-4 w-4" /> {e.libelle}
          </button>
        ))}
      </ActionsMenuPanel>
    </>
  );
}
