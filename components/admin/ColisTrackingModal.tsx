'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { StatutBadge } from '@/components/StatutBadge';
import { Modal } from '@/components/admin/Modal';

interface EvenementCircuit {
  type: 'statut' | 'commentaire';
  horodatage: string;
  auteur: string;
  statut?: string;
  texte?: string;
}

// Timeline verticale à colonne unique, identique à celle du marchand
// (components/marchand/ColisTrackingModal.tsx), mais enrichie des
// commentaires internes — ce que seule la page /admin/colis/suivi
// affichait jusqu'ici.
function construireCircuit(commande: Commande): EvenementCircuit[] {
  const evenements: EvenementCircuit[] = [];
  for (const h of commande.historique ?? []) {
    evenements.push({
      type: 'statut',
      horodatage: h.horodatage,
      auteur: h.utilisateur?.nomComplet ?? '—',
      statut: h.nouveauStatut,
    });
  }
  for (const c of commande.commentaires ?? []) {
    evenements.push({
      type: 'commentaire',
      horodatage: c.dateCreation,
      auteur: c.utilisateur?.nomComplet ?? '—',
      texte: c.texte,
    });
  }
  return evenements.sort((a, b) => new Date(a.horodatage).getTime() - new Date(b.horodatage).getTime());
}

export function ColisTrackingModal({ commandeId, onClose }: { commandeId: string; onClose: () => void }) {
  const [commande, setCommande] = useState<Commande | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Commande>(`/api/commandes/${commandeId}`)
      .then(setCommande)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [commandeId]);

  const circuit = commande ? construireCircuit(commande) : [];
  const dernierStatutIndex = circuit.map((ev) => ev.type).lastIndexOf('statut');

  return (
    <Modal title={commande ? `Suivi — ${commande.codeSuivi}` : 'Suivi du colis'} onClose={onClose}>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {!commande && !error && <p className="text-sm opacity-60">Chargement…</p>}

      {commande && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/[0.05]">
            <div>
              <p className="font-semibold">{commande.clientNom}</p>
              <p className="text-xs opacity-60">
                {commande.ville} — {commande.marchand?.nomBoutique ?? '—'}
              </p>
            </div>
            <StatutBadge statut={commande.statut} />
          </div>

          <ol className="relative flex flex-col gap-5 border-l-2 border-black/10 pl-6 dark:border-white/10">
            {circuit.map((ev, i) => {
              const isCurrent = ev.type === 'statut' && i === dernierStatutIndex;
              return (
                <li key={i} className="relative">
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
                    {ev.type === 'statut' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <StatutBadge statut={ev.statut!} />
                        {isCurrent && (
                          <span className="text-xs font-bold uppercase tracking-wide text-brand">État actuel</span>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm italic opacity-90">« {ev.texte} »</p>
                    )}
                    <p className="mt-1 text-xs opacity-60">{new Date(ev.horodatage).toLocaleString('fr-FR')}</p>
                    <p className="text-xs opacity-50">par {ev.auteur}</p>
                  </div>
                </li>
              );
            })}
            {circuit.length === 0 && <li className="text-sm opacity-60">Aucun historique pour ce colis</li>}
          </ol>
        </div>
      )}
    </Modal>
  );
}
