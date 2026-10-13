'use client';

import { useState } from 'react';
import { FileDown, Truck } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';

// § Circuit Shipeh (12/10/2026) — remise SANS API : l'admin exporte le bon en
// Excel, le transmet au transporteur, puis confirme ici. Les colis Shipeh du
// bon encore au hub de départ passent « En transit »
// (POST /api/bons-envoi/[id]/remis). Sert aussi aux colis qu'une API a
// refusés (« Par Excel »).
export function RemiseManuelle({ bon, nbAttente, onRemis }: { bon: BonEnvoi; nbAttente: number; onRemis: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  if (nbAttente === 0) return null;
  const destinataire = bon.prestataire?.nom ?? bon.hubDestination?.prestataire?.nom ?? bon.hubDestination?.nom ?? 'le transporteur';

  async function confirmer() {
    if (!window.confirm(`Confirmer que les ${nbAttente} colis en attente ont été transmis à ${destinataire} ? Ils passeront « En transit ».`)) return;
    setEnCours(true);
    setMessage(null);
    try {
      const res = await apiPost<{ remis: number }>(`/api/bons-envoi/${bon.id}/remis`);
      setMessage({ ok: true, texte: `${res.remis} colis en transit` });
      onRemis();
    } catch (err) {
      setMessage({ ok: false, texte: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="card-tint-strong flex flex-col gap-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span className="font-semibold">{nbAttente} colis en attente de remise.</span> Sans API : exportez le bon en
          Excel, transmettez-le à {destinataire}, puis confirmez.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline flex items-center gap-1.5" onClick={() => window.open(`/api/bons-envoi/${bon.id}/export`, '_blank')}>
            <FileDown className="h-4 w-4" /> Export Excel
          </button>
          <button className="btn-primary flex items-center gap-1.5" disabled={enCours} onClick={confirmer}>
            <Truck className="h-4 w-4" /> {enCours ? 'Envoi…' : 'Colis remis au transporteur'}
          </button>
        </div>
      </div>
      {message && <p className={`font-medium ${message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>{message.texte}</p>}
    </div>
  );
}
