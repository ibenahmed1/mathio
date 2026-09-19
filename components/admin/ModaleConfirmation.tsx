'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/admin/Modal';

// Confirmation d'un geste destructeur, en remplacement de `window.confirm`.
//
// Ce n'est pas une préférence esthétique. La boîte native affiche un texte brut
// non stylé, sans mise en forme ni hiérarchie, et certains navigateurs la
// tronquent : l'avertissement de la purge du bac à sable fait trois lignes et
// énumère ce qui ne sera PAS supprimé — exactement le genre de nuance qu'on
// perd dans un `confirm()` et qu'on ne peut pas se permettre de perdre avant
// une suppression irréversible.
//
// Elle porte aussi l'état d'envoi et l'erreur : un `confirm()` rend la main
// avant l'appel, et l'échec finissait alors dans un `alert()` détaché du geste.
export function ModaleConfirmation({
  titre,
  children,
  libelleAction = 'Confirmer',
  danger = true,
  onConfirmer,
  onClose,
}: {
  titre: string;
  children: ReactNode;
  libelleAction?: string;
  /** Faux pour un geste réversible — réactiver une plateforme, par exemple. */
  danger?: boolean;
  /** Rejette pour afficher l'erreur en place ; la fenêtre reste ouverte. */
  onConfirmer: () => Promise<void>;
  onClose: () => void;
}) {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function confirmer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await onConfirmer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Action impossible');
      setEnvoi(false);
    }
  }

  return (
    <Modal title={titre} onClose={onClose} size="sm">
      <div className="flex flex-col gap-4">
        <div
          className={
            danger
              ? 'flex items-start gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-300'
              : 'text-sm text-black/70 dark:text-white/70'
          }
        >
          {danger && <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <div className="[overflow-wrap:anywhere]">{children}</div>
        </div>

        {erreur && <p className="form-error">{erreur}</p>}

        <div className="btn-row justify-end">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={envoi}>
            Annuler
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => void confirmer()}
            disabled={envoi}
          >
            {envoi ? 'En cours…' : libelleAction}
          </button>
        </div>
      </div>
    </Modal>
  );
}
