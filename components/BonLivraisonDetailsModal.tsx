'use client';

import { useEffect, useState } from 'react';
import { X, MapPinned } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { BonDeLivraison } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { ScannedBadge } from '@/components/ScannedBadge';
import { estColisScanne } from '@/lib/scan';
import { ColisTrackingModal as AdminColisTrackingModal } from '@/components/admin/ColisTrackingModal';
import { ColisTrackingModal as MarchandColisTrackingModal } from '@/components/marchand/ColisTrackingModal';

export function BonLivraisonDetailsModal({
  bonId,
  role,
  onClose,
}: {
  bonId: string;
  role: 'admin' | 'marchand';
  onClose: () => void;
}) {
  const [bon, setBon] = useState<BonDeLivraison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  useEffect(() => {
    apiGet<BonDeLivraison>(`/api/bons-livraison/${bonId}`)
      .then(setBon)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [bonId]);

  const ColisTrackingModal = role === 'admin' ? AdminColisTrackingModal : MarchandColisTrackingModal;
  const commandes = bon?.commandes ?? [];
  const total = commandes.reduce((sum, c) => sum + Number(c.montantCod), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col gap-4 overflow-y-auto rounded-lg bg-white p-5 dark:bg-black"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">Détails du bon</h2>
          <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        {!bon && !error && <p className="text-sm opacity-60">Chargement…</p>}

        {bon && (
          <>
            <div className="grid grid-cols-1 gap-3 rounded-lg bg-black/[0.03] p-3 text-sm dark:bg-white/[0.05] sm:grid-cols-2">
              <div>
                <p>
                  <span className="opacity-60">Client :</span> {bon.marchand?.nomBoutique ?? '—'}
                  {bon.marchand?.utilisateur?.nomComplet ? ` — ${bon.marchand.utilisateur.nomComplet}` : ''}
                </p>
                <p>
                  <span className="opacity-60">Téléphone :</span> {bon.marchand?.utilisateur?.telephone ?? '—'}
                </p>
              </div>
              <div>
                <p>
                  <span className="opacity-60">Bon de livraison :</span>{' '}
                  <span className="font-mono">{bon.numero}</span>
                </p>
                <p>
                  <span className="opacity-60">Date :</span>{' '}
                  {new Date(bon.dateGeneration).toLocaleString('fr-FR')}
                </p>
                <p>
                  <span className="opacity-60">Colis :</span> {bon.nbColis}
                  {'  —  '}
                  <span className="opacity-60">Total :</span> {total.toFixed(2)} DH
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="table-basic min-w-[900px]">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Code d&apos;envoi</th>
                    <th>Téléphone</th>
                    <th>Ville</th>
                    <th>Information</th>
                    <th>Status</th>
                    <th className="text-right">Crbt</th>
                    <th>Scanned</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {commandes.map((c, i) => (
                    <tr key={c.id}>
                      <td>{i + 1}</td>
                      <td className="font-mono text-xs font-semibold">{c.codeSuivi}</td>
                      <td className="whitespace-nowrap">{c.clientTelephone}</td>
                      <td>{c.ville}</td>
                      <td className="max-w-[200px] text-xs">
                        <p>
                          <span className="opacity-60">Adresse :</span> {c.adresse}
                        </p>
                        {c.notes && (
                          <p>
                            <span className="opacity-60">Commentaire :</span> {c.notes}
                          </p>
                        )}
                      </td>
                      <td>
                        <StatutBadge statut={c.statut} />
                      </td>
                      <td className="text-right font-semibold tabular-nums">{Number(c.montantCod).toFixed(2)} DH</td>
                      <td>
                        <ScannedBadge scanne={estColisScanne(c)} />
                      </td>
                      <td>
                        <button
                          onClick={() => setTrackingId(c.id)}
                          className="btn-outline flex items-center gap-1 px-2 py-1 text-xs"
                          title="Suivi du colis"
                        >
                          <MapPinned className="h-3 w-3" /> Suivi
                        </button>
                      </td>
                    </tr>
                  ))}
                  {commandes.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-4 text-center opacity-60">
                        Aucun colis dans ce bon.
                      </td>
                    </tr>
                  )}
                </tbody>
                {commandes.length > 0 && (
                  <tfoot>
                    <tr className="font-bold">
                      <td colSpan={6}>Total — {commandes.length} colis</td>
                      <td className="text-right">{total.toFixed(2)} DH</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>

      {trackingId && (
        <div onClick={(e) => e.stopPropagation()}>
          <ColisTrackingModal commandeId={trackingId} onClose={() => setTrackingId(null)} />
        </div>
      )}
    </div>
  );
}
