'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Info, PackageCheck, FileText, FileDown, SquarePen } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';
import { Modal } from '@/components/admin/Modal';

// § /admin/bon-envoi : mêmes actions qu'un Bon de Livraison/Préparation (cf.
// BonLivraisonActionsMenu, BonPreparationActionsMenu) — Détails, Bon bien
// reçu, Voir en PDF —, plus deux actions propres au BE : "Modifier le bon"
// (ajouter/retirer des colis tant que le BE est encore 'nouveau', admin
// only) et "Export Excel". "Bon bien reçu" et "Modifier le bon" disparaissent
// une fois le BE 'recu' (rien à confirmer/modifier après réception).
export function BonEnvoiActionsMenu({
  bon,
  role,
  onChanged,
  hideDetails,
}: {
  bon: BonEnvoi;
  role: 'admin' | 'agent_hub';
  onChanged: () => void;
  hideDetails?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'bien-recu' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeAll() {
    setOpen(false);
    setModal(null);
    setError(null);
  }

  async function confirmerBienRecu() {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/bons-envoi/${bon.id}/marquer-recu`);
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
            {!hideDetails && (
              <button
                onClick={() => {
                  setOpen(false);
                  router.push(`/admin/bon-envoi/${bon.id}`);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <Info className="h-4 w-4" /> Détails du bon
              </button>
            )}
            {bon.statut === 'nouveau' && (
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
            {role === 'admin' && bon.statut === 'nouveau' && (
              <button
                onClick={() => {
                  setOpen(false);
                  router.push(`/admin/bon-envoi/${bon.id}/modifier`);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <SquarePen className="h-4 w-4" /> Modifier le bon
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                window.open(`/bons-envoi/${bon.id}`, '_blank');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <FileText className="h-4 w-4" /> Voir en PDF
            </button>
            {role === 'admin' && (
              <button
                onClick={() => {
                  setOpen(false);
                  window.open(`/api/bons-envoi/${bon.id}/export`, '_blank');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
              >
                <FileDown className="h-4 w-4" /> Export Excel
              </button>
            )}
          </div>
        </>
      )}

      {modal === 'bien-recu' && (
        <Modal title="Bon bien reçu" onClose={closeAll}>
          <p className="text-sm">
            Confirmer la réception du bon <span className="font-mono">{bon.numero}</span> ? Tous ses colis passeront
            au statut « Reçu au Hub ».
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
