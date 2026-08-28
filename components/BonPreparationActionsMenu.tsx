'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Info, PackageCheck, FileText, Tags, Ticket } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { BonDePreparation } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';
import { ActionsMenuPanel, actionsMenuItemClass } from '@/components/ActionsMenuPanel';

// § Gestion de stock (/admin/stock/bons-preparation) : mêmes actions qu'un
// Bon de Livraison (cf. BonLivraisonActionsMenu) — le BPR suit désormais
// exactement le même cycle manuel. "Détails du bon" navigue vers la page
// dédiée (tableau des colis + statuts), plutôt qu'une modale, pour garder la
// vue de vérification des articles déjà en place.
export function BonPreparationActionsMenu({ bon, onChanged }: { bon: BonDePreparation; onChanged: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [modal, setModal] = useState<'bien-recu' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeAll() {
    setOpen(false);
    setModal(null);
    setError(null);
  }

  function ouvrirDocument(format: 'etiquettes' | 'e-tickets') {
    setOpen(false);
    window.open(`/bons-preparation/${bon.id}?format=${format}`, '_blank');
  }

  async function confirmerBienRecu() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/bons-preparation/${bon.id}/bien-recu`);
      onChanged();
      closeAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-block text-left">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
        Actions
      </button>

      <ActionsMenuPanel anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} width={224}>
        <button
          onClick={() => {
            setOpen(false);
            router.push(`/admin/stock/bons-preparation/${bon.id}`);
          }}
          className={actionsMenuItemClass}
        >
          <Info className="h-4 w-4" /> Détails du bon
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setModal('bien-recu');
          }}
          className={actionsMenuItemClass}
        >
          <PackageCheck className="h-4 w-4" /> Bon bien reçu
        </button>
        <button
          onClick={() => window.open(`/bons-preparation/${bon.id}`, '_blank')}
          className={actionsMenuItemClass}
        >
          <FileText className="h-4 w-4" /> Voir en PDF
        </button>
        <button
          onClick={() => ouvrirDocument('etiquettes')}
          className={actionsMenuItemClass}
        >
          <Tags className="h-4 w-4" /> Voir les étiquettes
        </button>
        <button
          onClick={() => ouvrirDocument('e-tickets')}
          className={actionsMenuItemClass}
        >
          <Ticket className="h-4 w-4" /> e-Tickets
        </button>
      </ActionsMenuPanel>

      {modal === 'bien-recu' && (
        <Modal title="Bon bien reçu" onClose={closeAll}>
          <p className="text-sm">
            Confirmer la réception des colis du bon <span className="font-mono">{bon.numero}</span> ? Les colis en
            attente de ramassage passeront au statut « Ramassé ».
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
