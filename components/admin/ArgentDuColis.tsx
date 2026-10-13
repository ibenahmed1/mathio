'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';

// § Règlements transporteurs — le chemin de l'argent d'un colis livré par un
// transporteur : COD → part du transporteur → attendu → payé ou non. Rien
// n'est affiché pour un colis non concerné, ni pour un compte sans accès à la
// comptabilité (la route répond 403 : on se tait).
interface Argent {
  transporteur: string;
  montantCod: number;
  fraisTransporteur: number | null;
  montantAttendu: number;
  dateLivraison: string;
  etat: 'a_recevoir' | 'en_retard' | 'paye' | 'annulee';
  versement: { numero: number; date: string } | null;
}

const dh = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;

const ETATS: Record<Argent['etat'], { libelle: string; couleur: string }> = {
  a_recevoir: { libelle: 'À recevoir du transporteur', couleur: '#209EBB' },
  en_retard: { libelle: 'En retard (plus de 24 h)', couleur: '#E56A00' },
  paye: { libelle: 'Reçu', couleur: '#023047' },
  annulee: { libelle: 'Plus dû (colis non livré)', couleur: '#8C8C86' },
};

export function ArgentDuColis({ commandeId }: { commandeId: string }) {
  const [argent, setArgent] = useState<Argent | null>(null);

  useEffect(() => {
    apiGet<Argent | null>(`/api/reglements-transporteurs/colis/${commandeId}`)
      .then(setArgent)
      .catch(() => setArgent(null));
  }, [commandeId]);

  if (!argent) return null;
  const etat = ETATS[argent.etat];
  return (
    <div className="dashboard-card flex flex-col gap-2 text-sm">
      <p className="text-xs font-bold uppercase tracking-wide opacity-60">Argent du colis</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs opacity-60">COD encaissé par {argent.transporteur}</p>
          <p className="font-bold">{dh(argent.montantCod)}</p>
        </div>
        <div>
          <p className="text-xs opacity-60">Gardé par le transporteur</p>
          <p className="font-bold" style={{ color: argent.fraisTransporteur === null ? '#B85200' : undefined }}>
            {argent.fraisTransporteur === null ? 'Tarif manquant' : `− ${dh(argent.fraisTransporteur)}`}
          </p>
        </div>
        <div>
          <p className="text-xs opacity-60">À nous reverser</p>
          <p className="font-bold">{dh(argent.montantAttendu)}</p>
        </div>
      </div>
      <p className="font-semibold" style={{ color: etat.couleur }}>
        {etat.libelle}
        {argent.versement &&
          ` — versement n° ${argent.versement.numero} du ${new Date(argent.versement.date).toLocaleDateString('fr-FR')}`}
      </p>
    </div>
  );
}
