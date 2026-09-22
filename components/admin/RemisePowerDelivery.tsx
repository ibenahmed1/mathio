'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { apiPost } from '@/lib/api-client';

// § Power Delivery — remise par leur API des colis d'un bon d'envoi vers une de
// leurs agences (POST /api/bons-envoi/[id]/remise-power-delivery). Remplace
// l'export Excel pour les villes qu'ils identifient ; les autres gardent
// l'Excel, et le tableau de résultat le dit colis par colis.

interface ResultatColis {
  commandeId: string;
  codeSuivi: string;
  issue: string;
  message: string;
}

interface ResultatBon {
  totalRemis: number;
  totalNonRemis: number;
  resultats: ResultatColis[];
}

const LIBELLES_ISSUE: Record<string, { libelle: string; style: string }> = {
  remis: { libelle: 'Remis', style: 'bg-green-600 text-white' },
  a_confirmer: { libelle: 'À confirmer', style: 'bg-amber-300 text-amber-950' },
  refuse_par_power: { libelle: 'Refusé par Power', style: 'bg-red-600 text-white' },
  deja_remis: { libelle: 'Déjà remis', style: 'bg-black/10 dark:bg-white/10' },
  ville_sans_correspondance: { libelle: 'Par Excel', style: 'bg-cyan-400 text-cyan-950' },
  statut_non_remettable: { libelle: 'Non remettable', style: 'bg-black/10 dark:bg-white/10' },
};

export function RemisePowerDelivery({ bonId, onRemis }: { bonId: string; onRemis: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<ResultatBon | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function remettre() {
    // Chaque colis remis crée un vrai colis chez eux et déclenche un ramassage :
    // on demande confirmation, une fois, pour le bon entier.
    if (!window.confirm('Remettre les colis de ce bon à Power Delivery ? Chaque colis sera créé chez eux.')) return;
    setEnCours(true);
    setErreur(null);
    try {
      setResultat(await apiPost<ResultatBon>(`/api/bons-envoi/${bonId}/remise-power-delivery`));
      onRemis();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="card-tint-strong flex flex-col gap-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Remise à Power Delivery</p>
          <p className="opacity-60">
            Par leur API, à la place de l&apos;Excel. Les villes qu&apos;ils n&apos;identifient pas restent à remettre par
            l&apos;Excel.
          </p>
        </div>
        <button type="button" onClick={remettre} disabled={enCours} className="btn-primary flex items-center gap-1.5">
          <Send className="h-4 w-4" />
          {enCours ? 'Remise en cours…' : 'Remettre à Power Delivery'}
        </button>
      </div>

      {erreur && <p className="font-medium text-red-600">{erreur}</p>}

      {resultat && (
        <>
          <p className="font-medium">
            {resultat.totalRemis} remis · {resultat.totalNonRemis} non remis
          </p>
          <div className="overflow-x-auto">
            <table className="table-basic min-w-[520px]">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Issue</th>
                  <th>Détail</th>
                </tr>
              </thead>
              <tbody>
                {resultat.resultats.map((r) => {
                  const issue = LIBELLES_ISSUE[r.issue] ?? { libelle: r.issue, style: '' };
                  return (
                    <tr key={r.commandeId}>
                      <td className="font-mono font-semibold">{r.codeSuivi}</td>
                      <td>
                        <span className={`badge ${issue.style}`}>{issue.libelle}</span>
                      </td>
                      <td className="opacity-80">{r.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
