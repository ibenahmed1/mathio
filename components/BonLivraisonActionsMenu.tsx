'use client';

import { useState } from 'react';
import { MoreVertical, Info, PackageCheck, FileText, Tags, Ticket } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { BonDeLivraison } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { BonLivraisonDetailsModal } from '@/components/BonLivraisonDetailsModal';

type ModalKey = 'details' | 'bien-recu';

export function BonLivraisonActionsMenu({
  bon,
  role,
  onChanged,
}: {
  bon: BonDeLivraison;
  role: 'admin' | 'marchand';
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ModalKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeAll() {
    setOpen(false);
    setModal(null);
    setError(null);
  }

  function ouvrirDocument(format: 'a4' | 'etiquettes' | 'e-tickets') {
    setOpen(false);
    window.open(`/bons-livraison/${bon.id}?format=${format}`, '_blank');
  }

  async function confirmerBienRecu() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/bons-livraison/${bon.id}/bien-recu`);
      onChanged();
      closeAll();
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
                setModal('details');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Info className="h-4 w-4" /> Détails du bon
            </button>
            {role === 'admin' && (
              <button
                onClick={() => {
                  setOpen(false);
                  setModal('bien-recu');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <PackageCheck className="h-4 w-4" /> Bon bien reçu
              </button>
            )}
            <button
              onClick={() => ouvrirDocument('a4')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <FileText className="h-4 w-4" /> Voir en PDF
            </button>
            <button
              onClick={() => ouvrirDocument('etiquettes')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Tags className="h-4 w-4" /> Voir les étiquettes
            </button>
            <button
              onClick={() => ouvrirDocument('e-tickets')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Ticket className="h-4 w-4" /> e-Tickets
            </button>
          </div>
        </>
      )}

      {modal === 'details' && <BonLivraisonDetailsModal bonId={bon.id} role={role} onClose={closeAll} />}

      {modal === 'bien-recu' && (
        <Modal title="Bon bien reçu" onClose={closeAll}>
          <p className="text-sm">
            Confirmer la réception des colis du bon <span className="font-mono">{bon.numero}</span> ? Les colis en
            attente de ramassage ou ramassés passeront au statut « Reçu ».
          </p>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={closeAll} disabled={busy}>
              Annuler
            </button>
            <button className="btn-primary" disabled={busy} onClick={confirmerBienRecu}>
              Confirmer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
