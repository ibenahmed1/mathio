'use client';

import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import type { Commande } from '@/lib/types';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';

export function ColisTicket({ id, variant }: { id: string; variant: 'ticket' | 'e-ticket' }) {
  const [commande, setCommande] = useState<Commande | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Commande>(`/api/commandes/${id}`)
      .then(setCommande)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [id]);

  if (error) return <p className="p-6 text-sm font-medium text-red-600">{error}</p>;
  if (!commande) return <p className="p-6 opacity-60">Chargement…</p>;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <div className="print-hide flex justify-end">
        <button onClick={() => window.print()} className="btn-primary flex items-center gap-2">
          <Printer className="h-4 w-4" />
          Imprimer
        </button>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border-2 border-black p-5 dark:border-white">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest opacity-60">
            {variant === 'ticket' ? 'Ticket colis' : 'E-Ticket colis'}
          </p>
          <p className="mt-1 break-all font-mono text-2xl font-black tracking-widest">{commande.codeSuivi}</p>
        </div>

        <div className="grid grid-cols-1 gap-1 border-t border-dashed border-black/30 pt-3 text-sm dark:border-white/30">
          <p>
            <span className="opacity-60">Magasin :</span> {commande.marchand?.nomBoutique ?? '—'}
          </p>
          <p>
            <span className="opacity-60">Destinataire :</span> {commande.clientNom}
          </p>
          <p>
            <span className="opacity-60">Téléphone :</span> {commande.clientTelephone}
          </p>
          <p>
            <span className="opacity-60">Ville :</span> {commande.ville}
          </p>
          <p>
            <span className="opacity-60">Adresse :</span> {commande.adresse}
          </p>
          {variant === 'ticket' && (commande.marchandise?.nom ?? commande.produitDescription) && (
            <p>
              <span className="opacity-60">Produit :</span> {commande.marchandise?.nom ?? commande.produitDescription}
              {commande.quantite > 1 ? ` × ${commande.quantite}` : ''}
            </p>
          )}
          <p>
            <span className="opacity-60">Montant COD :</span> {commande.montantCod} DH
          </p>
          {commande.colisARemplacer && (
            <p>
              <span className="opacity-60">Remplace :</span> {commande.colisARemplacer.codeSuivi}
            </p>
          )}
          {(commande.ouvrir || commande.fragile) && (
            <p className="font-bold uppercase">
              {commande.ouvrir ? 'À ouvrir ' : ''}
              {commande.fragile ? '⚠ Fragile' : ''}
            </p>
          )}
          <p>
            <span className="opacity-60">Statut :</span>{' '}
            {LABELS_STATUT_COMMANDE[commande.statut as keyof typeof LABELS_STATUT_COMMANDE] ?? commande.statut}
          </p>
        </div>
      </div>
    </div>
  );
}
