'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Modal } from '@/components/admin/Modal';

// La valeur complète d'une clé n'existe QUE sur cet écran : seule son empreinte
// part en base (§ CleApiPlateforme.secretHash). Perdue, une clé ne se retrouve
// pas — elle se réémet.
export function ModaleCleEmise({ cle, onClose }: { cle: string; onClose: () => void }) {
  const [copie, setCopie] = useState(false);

  async function copier() {
    try {
      await navigator.clipboard.writeText(cle);
      setCopie(true);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : la clé
      // reste sélectionnable à la main juste au-dessus, il n'y a rien à
      // rattraper ici.
    }
  }

  return (
    <Modal title="Clé émise" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Cette valeur n’existe que sur cet écran : seule son empreinte est enregistrée. Une fois
            cette fenêtre fermée, elle ne peut plus être retrouvée — seulement réémise.
          </span>
        </div>

        <code className="block break-all rounded-xl bg-black/[0.05] px-4 py-3 font-mono text-sm dark:bg-white/10">
          {cle}
        </code>

        <div className="btn-row justify-end">
          <button className="btn-outline" onClick={() => void copier()}>
            {copie ? <Check size={15} /> : <Copy size={15} />} {copie ? 'Copiée' : 'Copier'}
          </button>
          <button className="btn-primary" onClick={onClose}>
            J’ai transmis la clé
          </button>
        </div>
      </div>
    </Modal>
  );
}
