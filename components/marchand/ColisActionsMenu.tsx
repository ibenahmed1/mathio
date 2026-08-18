'use client';

import { useState } from 'react';
import { MoreVertical, MapPinned, SquarePen, Printer, Trash2 } from 'lucide-react';
import { apiDelete } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
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
  const [modal, setModal] = useState<'suivi' | 'modifier' | 'supprimer' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/commandes/${commande.id}`);
      onChanged();
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

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
            {commande.statut === 'nouveau_colis' && (
              <>
                <div className="my-1 border-t border-black/10 dark:border-white/10" />
                <button
                  onClick={() => {
                    setOpen(false);
                    setModal('supprimer');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-4 w-4" /> Supprimer le colis
                </button>
              </>
            )}
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
      {modal === 'supprimer' && (
        <Modal title="Supprimer le colis" onClose={() => setModal(null)}>
          <p className="text-sm">
            Supprimer définitivement le colis <span className="font-mono">{commande.codeSuivi}</span> ? Cette action est
            irréversible.
          </p>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setModal(null)} disabled={busy}>
              Annuler
            </button>
            <button className="btn-primary bg-red-600 hover:bg-red-700" disabled={busy} onClick={handleDelete}>
              Supprimer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
