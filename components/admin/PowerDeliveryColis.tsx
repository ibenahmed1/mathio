'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';

// § Power Delivery — l'état d'un colis qu'on leur a confié, et ce qu'on peut
// leur demander (GET/POST /api/commandes/[id]/power-delivery/**).
//
// Ne s'affiche que pour un colis passé par Power ET pour qui détient
// `bon_envoi:manage` : sans remise ou sans permission, le composant ne rend
// rien — il n'a pas à signaler une intégration à qui n'en a pas l'usage.

interface EtatRemise {
  etat: 'acceptee' | 'refusee' | 'a_confirmer' | 'annulee';
  codeEnvoye: string;
  codeExterne: string | null;
  montantCodConfie: number;
  dernierStatutExterne: string | null;
  dernierPaiementExterne: string | null;
  dernierEvenementLe: string | null;
  demandeRetourLe: string | null;
  demandeRelivraisonLe: string | null;
  erreur: string | null;
}

const LIBELLES_ETAT: Record<EtatRemise['etat'], string> = {
  acceptee: 'Acceptée',
  refusee: 'Refusée',
  a_confirmer: 'À confirmer',
  annulee: 'Annulée',
};

const LIBELLES_PAIEMENT: Record<string, string> = {
  NOT_PAID: 'COD non reversé',
  PAID: 'COD reversé',
  INVOICED: 'COD facturé',
};

function date(valeur: string | null): string {
  return valeur ? new Date(valeur).toLocaleString('fr-FR') : '—';
}

export function PowerDeliveryColis({ commandeId, onChanged }: { commandeId: string; onChanged: () => void }) {
  const [remise, setRemise] = useState<EtatRemise | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);

  const charger = useCallback(() => {
    apiGet<{ remise: EtatRemise | null }>(`/api/commandes/${commandeId}/power-delivery`)
      .then((r) => setRemise(r.remise))
      // 403 sans la permission, ou toute autre erreur : on ne rend rien.
      .catch(() => setRemise(null));
  }, [commandeId]);

  useEffect(() => {
    charger();
  }, [charger]);

  async function agir(action: string, libelle: string, corps?: Record<string, string>) {
    setEnCours(action);
    setMessage(null);
    try {
      await apiPost(`/api/commandes/${commandeId}/power-delivery/${action}`, corps);
      setMessage({ texte: libelle, erreur: false });
      charger();
      onChanged();
    } catch (err) {
      setMessage({ texte: err instanceof Error ? err.message : 'Erreur', erreur: true });
    } finally {
      setEnCours(null);
    }
  }

  function demanderRetour() {
    const raison = window.prompt('Raison du retour (facultatif, transmise à leur équipe) :');
    if (raison === null) return;
    agir('retour', 'Retour demandé — en attente de leur équipe', { raison });
  }

  function demanderRelivraison() {
    const raison = window.prompt('Raison de la relivraison (facultatif) :');
    if (raison === null) return;
    const nouvelleAdresse = window.prompt('Nouvelle adresse (laisser vide pour garder l’actuelle) :') ?? '';
    const nouveauTelephone = window.prompt('Nouveau téléphone (laisser vide pour garder l’actuel) :') ?? '';
    agir('relivraison', 'Relivraison demandée — en attente de leur équipe', { raison, nouvelleAdresse, nouveauTelephone });
  }

  if (!remise) return null;
  const active = remise.etat === 'acceptee' || remise.etat === 'a_confirmer';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Power Delivery</p>
        <span className="badge bg-black/10 dark:bg-white/10">Remise {LIBELLES_ETAT[remise.etat].toLowerCase()}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="opacity-60">Code chez eux</dt>
        <dd className="font-mono">{remise.codeExterne ?? remise.codeEnvoye}</dd>
        <dt className="opacity-60">Dernier statut reçu</dt>
        <dd>{remise.dernierStatutExterne ?? '—'}</dd>
        <dt className="opacity-60">Reçu le</dt>
        <dd>{date(remise.dernierEvenementLe)}</dd>
        <dt className="opacity-60">COD confié</dt>
        <dd>
          {remise.montantCodConfie} MAD
          {remise.dernierPaiementExterne && (
            <span className="opacity-60"> — {LIBELLES_PAIEMENT[remise.dernierPaiementExterne] ?? remise.dernierPaiementExterne}</span>
          )}
        </dd>
        {remise.demandeRetourLe && (
          <>
            <dt className="opacity-60">Retour demandé</dt>
            <dd>{date(remise.demandeRetourLe)}</dd>
          </>
        )}
        {remise.demandeRelivraisonLe && (
          <>
            <dt className="opacity-60">Relivraison demandée</dt>
            <dd>{date(remise.demandeRelivraisonLe)}</dd>
          </>
        )}
      </dl>

      {remise.erreur && <p className="text-red-600">{remise.erreur}</p>}

      {active && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={enCours !== null} onClick={() => agir('actualiser', 'Suivi actualisé')}>
            {enCours === 'actualiser' ? 'Actualisation…' : 'Actualiser'}
          </button>
          {remise.etat === 'acceptee' && (
            <>
              <button
                type="button"
                className="btn-secondary"
                disabled={enCours !== null}
                onClick={() => agir('modifier', 'Correction transmise à Power')}
                title="Transmet à Power l’état actuel du colis chez nous"
              >
                {enCours === 'modifier' ? 'Envoi…' : 'Transmettre les corrections'}
              </button>
              <button type="button" className="btn-secondary" disabled={enCours !== null} onClick={demanderRetour}>
                Demander un retour
              </button>
              <button type="button" className="btn-secondary" disabled={enCours !== null} onClick={demanderRelivraison}>
                Relivrer
              </button>
            </>
          )}
        </div>
      )}

      {message && <p className={message.erreur ? 'font-medium text-red-600' : 'font-medium text-green-700'}>{message.texte}</p>}
    </div>
  );
}
