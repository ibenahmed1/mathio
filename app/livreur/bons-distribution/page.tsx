'use client';

import { useEffect, useState } from 'react';
import { Share2, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { LABELS_STATUT_BON_DISTRIBUTION, STYLE_STATUT_BON_DISTRIBUTION } from '@/lib/statuts';
import { LivreurShell } from '@/components/livreur/LivreurShell';
import type { StatutBonDistribution } from '@/app/generated/prisma/enums';

interface TourneeLivreur {
  id: string;
  numero: string;
  statut: StatutBonDistribution;
  nbColis: number;
  dateGeneration: string;
  dateCloture: string | null;
  nbColisLivres: number | null;
  nbColisRetournes: number | null;
  montantRemis: string | null;
  gainLivreur: string | null;
  hub: { nom: string };
  cloturePar: { nomComplet: string } | null;
}

function dh(valeur: string | number | null) {
  return `${Number(valeur ?? 0).toFixed(2)} DH`;
}

// § /livreur/bons-distribution : historique des tournées du livreur. Une
// tournée clôturée sort de sa feuille de route (/livreur/colis) mais reste
// ici, avec le détail de la reddition faite au dépôt — rien n'est effacé.
export default function TourneesLivreurPage() {
  const [tournees, setTournees] = useState<TourneeLivreur[]>([]);
  const [soldeAPayer, setSoldeAPayer] = useState('0');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ data: TourneeLivreur[]; soldeAPayer: string }>('/api/livreur/bons-distribution')
      .then((res) => {
        setTournees(res.data);
        setSoldeAPayer(res.soldeAPayer);
      })
      .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  return (
    <LivreurShell>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="page-title flex items-center gap-2">
            <Share2 className="h-6 w-6 text-brand-ink dark:text-brand" />
            Mes tournées
          </h1>
          <div className="card-tint-strong flex flex-col gap-0.5 px-4 py-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold opacity-60">
              <Wallet className="h-3.5 w-3.5" />
              Solde à payer
            </span>
            <span className="text-xl font-bold">{dh(soldeAPayer)}</span>
          </div>
        </div>

        <p className="text-xs opacity-60">
          Vos gains de tournée sont crédités à votre solde à la clôture au dépôt, et réglés séparément du cash que vous
          remettez au Planner.
        </p>

        {erreur && <p className="text-sm font-medium text-red-600">{erreur}</p>}

        <div className="overflow-x-auto">
          <table className="table-basic min-w-[720px]">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Hub</th>
                <th>Statut</th>
                <th>Colis</th>
                <th>Caisse remise</th>
                <th>Gain</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {tournees.map((t) => (
                <tr key={t.id}>
                  <td className="font-mono">{t.numero}</td>
                  <td>{t.hub.nom}</td>
                  <td>
                    <span className={`badge ${STYLE_STATUT_BON_DISTRIBUTION[t.statut]}`}>
                      {LABELS_STATUT_BON_DISTRIBUTION[t.statut]}
                    </span>
                  </td>
                  <td>
                    {t.statut === 'cloture' ? (
                      <span title="livrés / retournés">
                        {t.nbColisLivres ?? 0} / {t.nbColisRetournes ?? 0}
                      </span>
                    ) : (
                      t.nbColis
                    )}
                  </td>
                  <td className="whitespace-nowrap">{t.statut === 'cloture' ? dh(t.montantRemis) : '—'}</td>
                  <td className="whitespace-nowrap">{t.statut === 'cloture' ? dh(t.gainLivreur) : '—'}</td>
                  <td className="whitespace-nowrap">
                    {new Date(t.dateGeneration).toLocaleDateString('fr-FR')}
                    {t.dateCloture && (
                      <span className="block text-xs opacity-60">
                        clôturée le {new Date(t.dateCloture).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {tournees.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center opacity-60">
                    Aucune tournée pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </LivreurShell>
  );
}
