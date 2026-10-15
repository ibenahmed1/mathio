'use client';

import { useState } from 'react';
import { Truck } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';
import { annoncerEchec, annoncerSucces } from '@/lib/annonces';

// § Circuit transporteur (13/10/2026) — bon reçu : ses colis sont « Reçu au
// hub » de destination, chez le transporteur. On les passe à la main en
// « Mise en distribution » quand il les sort en livraison ; la suite vient de
// lui (POST /api/bons-envoi/[id]/mise-en-distribution).
export function MiseEnDistribution({ bon, onFait }: { bon: BonEnvoi; onFait: () => void }) {
  const recus = (bon.commandes ?? []).filter((c) => c.statut === 'recu_au_hub');
  const [choisis, setChoisis] = useState<Set<string>>(() => new Set(recus.map((c) => c.id)));
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  if (recus.length === 0) return null;
  const transporteur = bon.prestataire?.nom ?? bon.hubDestination?.prestataire?.nom ?? bon.hubDestination?.nom ?? 'le transporteur';

  function basculer(id: string) {
    setChoisis((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function valider() {
    setEnCours(true);
    setMessage(null);
    try {
      const res = await apiPost<{ misEnDistribution: number }>(`/api/bons-envoi/${bon.id}/mise-en-distribution`, {
        colisIds: Array.from(choisis),
      });
      setMessage({ ok: true, texte: `${res.misEnDistribution} colis en distribution chez ${transporteur}` });
      annoncerSucces(`${res.misEnDistribution} colis en distribution chez ${transporteur}.`);
      onFait();
    } catch (err) {
      setMessage({ ok: false, texte: err instanceof Error ? err.message : 'Erreur' });
      annoncerEchec(err, { prefixe: 'Mise en distribution' });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="card-tint-strong flex flex-col gap-3 p-4 text-sm">
      <p>
        <span className="font-semibold">{recus.length} colis reçus chez {transporteur}.</span> Cochez ceux qu&apos;il a
        sortis en livraison : ils passent « Mise en distribution », puis on attend son retour.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {recus.map((c) => (
          <label key={c.id} className="flex items-center gap-1.5 font-mono text-xs">
            <input type="checkbox" checked={choisis.has(c.id)} onChange={() => basculer(c.id)} />
            {c.codeSuivi} <span className="font-sans opacity-60">{c.ville}</span>
          </label>
        ))}
      </div>
      <div>
        <button className="btn-primary flex items-center gap-1.5" disabled={enCours || choisis.size === 0} onClick={valider}>
          <Truck className="h-4 w-4" /> {enCours ? 'Envoi…' : `Mettre en distribution (${choisis.size})`}
        </button>
      </div>
      {message && <p className={`font-medium ${message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>{message.texte}</p>}
    </div>
  );
}
