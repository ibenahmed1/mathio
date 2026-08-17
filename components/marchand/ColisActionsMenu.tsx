'use client';

import { useState } from 'react';
import { MoreVertical, MapPinned, SquarePen, Printer } from 'lucide-react';
import type { Commande } from '@/lib/types';
import { ColisTrackingModal } from './ColisTrackingModal';
import { ColisEditModal } from './ColisEditModal';

export function ColisActionsMenu({
  commande,
  onChanged,
  champsRestreints,
}: {
  commande: Commande;
  onChanged: () => void;
  // Depuis "Colis à relancer" : le colis a déjà été confirmé/traité en amont,
  // seule une erreur de coordonnées (téléphone/adresse) justifie une
  // correction avant de relancer — les autres champs (prix, marchandise…)
  // restent verrouillés pour éviter des modifications hors contexte.
  champsRestreints?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'suivi' | 'modifier' | null>(null);

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
        Actions
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-black">
            <button
              onClick={() => {
                setOpen(false);
                setModal('suivi');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <MapPinned className="h-4 w-4" /> Suivi du colis
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setModal('modifier');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <SquarePen className="h-4 w-4" /> Modifier le colis
            </button>
            <button
              onClick={() => {
                setOpen(false);
                window.open(`/marchand/colis/${commande.id}/ticket`, '_blank');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Printer className="h-4 w-4" /> Imprimer le ticket
            </button>
          </div>
        </>
      )}

      {modal === 'suivi' && <ColisTrackingModal commandeId={commande.id} onClose={() => setModal(null)} />}
      {modal === 'modifier' && (
        <ColisEditModal
          commande={commande}
          onClose={() => setModal(null)}
          onSaved={onChanged}
          champsRestreints={champsRestreints}
        />
      )}
    </div>
  );
}
