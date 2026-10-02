'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';

// § Colivraison — l'état d'un colis qu'on leur a confié
// (GET/POST /api/commandes/[id]/colivraison/**).
//
// Plus court que le bloc Power Delivery : leur API ne permet ni correction, ni
// retour, ni relivraison — seulement de lire le suivi. Ne rend rien pour un
// colis jamais passé chez eux, ni pour qui n'a pas `bon_envoi:manage`.

interface EtatRemise {
  etat: 'acceptee' | 'refusee' | 'a_confirmer' | 'annulee';
  codeEnvoye: string;
  codeExterne: string | null;
  montantCodConfie: number;
  dernierStatutExterne: string | null;
  dernierEvenementLe: string | null;
  erreur: string | null;
}

const LIBELLES_ETAT: Record<EtatRemise['etat'], string> = {
  acceptee: 'Acceptée',
  refusee: 'Refusée',
  a_confirmer: 'À confirmer',
  annulee: 'Annulée',
};

function date(valeur: string | null): string {
  return valeur ? new Date(valeur).toLocaleString('fr-FR') : '—';
}

export function ColivraisonColis({ commandeId, onChanged }: { commandeId: string; onChanged: () => void }) {
  const [remise, setRemise] = useState<EtatRemise | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);

  const charger = useCallback(() => {
    apiGet<{ remise: EtatRemise | null }>(`/api/commandes/${commandeId}/colivraison`)
      .then((r) => setRemise(r.remise))
      .catch(() => setRemise(null));
  }, [commandeId]);

  useEffect(() => {
    charger();
  }, [charger]);

  async function actualiser() {
    setEnCours(true);
    setMessage(null);
    try {
      const r = await apiPost<{ issue: string; detail: string | null }>(`/api/commandes/${commandeId}/colivraison/actualiser`);
      setMessage({ texte: r.detail ? `Suivi actualisé — ${r.detail}` : 'Suivi actualisé', erreur: false });
      charger();
      onChanged();
    } catch (err) {
      setMessage({ texte: err instanceof Error ? err.message : 'Erreur', erreur: true });
    } finally {
      setEnCours(false);
    }
  }

  if (!remise) return null;
  const active = remise.etat === 'acceptee' || remise.etat === 'a_confirmer';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Colivraison</p>
        <span className="badge bg-black/10 dark:bg-white/10">Remise {LIBELLES_ETAT[remise.etat].toLowerCase()}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="opacity-60">Code chez eux</dt>
        <dd className="font-mono">{remise.codeExterne ?? '— pas encore connu'}</dd>
        <dt className="opacity-60">Notre référence</dt>
        <dd className="font-mono">{remise.codeEnvoye}</dd>
        <dt className="opacity-60">Dernier état reçu</dt>
        <dd>{remise.dernierStatutExterne ?? '—'}</dd>
        <dt className="opacity-60">Reçu le</dt>
        <dd>{date(remise.dernierEvenementLe)}</dd>
        <dt className="opacity-60">COD confié</dt>
        <dd>{remise.montantCodConfie} MAD</dd>
      </dl>

      {remise.erreur && <p className="text-red-600">{remise.erreur}</p>}

      {active && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={enCours} onClick={actualiser}>
            {enCours ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      )}

      {message && <p className={message.erreur ? 'font-medium text-red-600' : 'font-medium text-green-700'}>{message.texte}</p>}
    </div>
  );
}
