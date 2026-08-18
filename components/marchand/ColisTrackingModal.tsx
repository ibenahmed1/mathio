'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import type { Commande, HistoriqueStatut } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { Modal } from '@/components/admin/Modal';
import { PreuveLivraison } from '@/components/PreuveLivraison';

// Timeline verticale à colonne unique (tout le texte du même côté de la
// ligne, contrairement au zigzag gauche/droite d'une frise classique) :
// événement le plus ancien en haut, état actuel mis en avant en bas.
export function ColisTrackingModal({ commandeId, onClose }: { commandeId: string; onClose: () => void }) {
  const [commande, setCommande] = useState<(Commande & { historique?: HistoriqueStatut[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Commande & { historique?: HistoriqueStatut[] }>(`/api/commandes/${commandeId}`)
      .then(setCommande)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [commandeId]);

  const historique = commande?.historique ?? [];

  return (
    <Modal title={commande ? `Suivi — ${commande.codeSuivi}` : 'Suivi du colis'} onClose={onClose}>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {!commande && !error && <p className="text-sm opacity-60">Chargement…</p>}

      {commande && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/[0.05]">
            <div>
              <p className="font-semibold">{commande.clientNom}</p>
              <p className="text-xs opacity-60">{commande.ville}</p>
            </div>
            <StatutBadge statut={commande.statut} hubVille={commande.hubActuel?.ville} />
          </div>

          {/* § Preuve de livraison : le marchand voit la photo/signature
              recueillie par le livreur — c'est son justificatif de remise en
              cas de contestation du client. */}
          <PreuveLivraison
            photoPreuveUrl={commande.photoPreuveUrl}
            signatureUrl={commande.signatureUrl}
            dateLivraison={commande.dateLivraison}
            compact
          />

          <ol className="relative flex flex-col gap-5 border-l-2 border-black/10 pl-6 dark:border-white/10">
            {historique.map((h, i) => {
              const isCurrent = i === historique.length - 1;
              return (
                <li key={h.id} className="relative">
                  <span
                    className={`absolute -left-[29px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      isCurrent
                        ? 'border-brand bg-brand'
                        : 'border-black/20 bg-white dark:border-white/30 dark:bg-black'
                    }`}
                  >
                    {isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-brand-foreground" />}
                  </span>
                  <div className={isCurrent ? 'rounded-lg border border-brand/40 bg-brand/5 p-3' : ''}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatutBadge statut={h.nouveauStatut} />
                      {isCurrent && <span className="text-xs font-bold uppercase tracking-wide text-brand">État actuel</span>}
                    </div>
                    {/* § Qui livre, pas seulement qui a agi : la note porte
                        l'info métier (ex. affecté au livreur X) quand elle existe. */}
                    {h.note && <p className="mt-1 text-sm font-medium opacity-90">{h.note}</p>}
                    <p className="mt-1 text-xs opacity-60">{new Date(h.horodatage).toLocaleString('fr-FR')}</p>
                    {h.utilisateur && <p className="text-xs opacity-50">par {h.utilisateur.nomComplet}</p>}
                  </div>
                </li>
              );
            })}
            {historique.length === 0 && <li className="text-sm opacity-60">Aucun historique pour ce colis</li>}
          </ol>
        </div>
      )}
    </Modal>
  );
}
