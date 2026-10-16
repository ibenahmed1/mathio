'use client';

import { useState } from 'react';
import { FileDown, PackageCheck, Send, Truck, ListChecks } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import type { BonEnvoi } from '@/lib/types';
import { attendRemise, suitCircuitShipeh } from '@/lib/circuit-shipeh';
import { annoncerEchec, annoncerSucces } from '@/lib/annonces';
import { ModaleConfirmation } from '@/components/admin/ModaleConfirmation';

// § Fiche d'un bon d'envoi — bandeau de TRANSMISSION, toujours affiché en tête
// de la fiche pour qui compose et remet les bons (admin, agent stock).
//
// Il regroupe ce qui était éparpillé en cinq blocs qui n'apparaissaient que
// selon le transporteur et l'état des colis (remise Power, Colivraison, Meta,
// EST, remise manuelle) : on ne trouvait plus le bouton. Désormais les quatre
// gestes sont toujours là, dans l'ordre où on les fait, et un geste qui ne sert
// à rien est GRISÉ avec sa raison écrite dessous plutôt que caché :
//   1. Exporter l'Excel            — toujours possible
//   2. Transmettre (API et/ou « marquer comme transmis »)
//   3. Bon bien reçu               — après la transmission
//   4. Mise en distribution        — une fois le bon reçu (liste plus bas)

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

// Transporteurs branchés par API : chemin de remise, avertissement avant envoi
// et libellé de leur refus. Les autres se remettent par l'Excel seulement.
const API_TRANSPORTEURS: Record<string, { chemin: string; avertissement: string; refus: Record<string, string> }> = {
  'Power Delivery': {
    chemin: 'remise-power-delivery',
    avertissement: 'Chaque colis sera créé chez eux. Les villes qu’ils n’identifient pas restent à remettre par l’Excel.',
    refus: { refuse_par_power: 'Refusé par Power' },
  },
  Colivraison: {
    chemin: 'remise-colivraison',
    avertissement: 'Chaque colis sera créé chez eux, et leur API ne permet pas de l’annuler.',
    refus: { refuse_par_colivraison: 'Refusé par Colivraison' },
  },
  'Meta Livraison': {
    chemin: 'remise-meta-livraison',
    avertissement: 'Chaque colis sera créé chez eux. Les villes qu’ils n’identifient pas restent à remettre par l’Excel.',
    refus: { refuse_par_meta: 'Refusé par Meta' },
  },
  'EST Livraison': {
    chemin: 'remise-est-livraison',
    avertissement:
      'Chaque colis sera créé chez eux et partira en livraison. Leur API ne permet pas d’annuler : une erreur se rattrape par téléphone.',
    refus: { refuse_par_est: 'Refusé par EST', colis_invalide: 'À corriger' },
  },
};

const LIBELLES_ISSUE: Record<string, { libelle: string; style: string }> = {
  remis: { libelle: 'Remis', style: 'bg-green-600 text-white' },
  a_confirmer: { libelle: 'À confirmer', style: 'bg-amber-300 text-amber-950' },
  deja_remis: { libelle: 'Déjà remis', style: 'bg-black/10 dark:bg-white/10' },
  ville_sans_correspondance: { libelle: 'Par Excel', style: 'bg-cyan-400 text-cyan-950' },
  statut_non_remettable: { libelle: 'Non remettable', style: 'bg-black/10 dark:bg-white/10' },
};

type Confirmation = 'api' | 'manuelle' | 'recu' | null;

export function TransmissionBon({ bon, onChange }: { bon: BonEnvoi; onChange: () => void }) {
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [resultat, setResultat] = useState<ResultatBon | null>(null);

  const transporteur = bon.prestataire?.nom ?? bon.hubDestination?.prestataire?.nom ?? null;
  const destinataire = transporteur ?? bon.hubDestination?.nom ?? 'le destinataire';
  // Bon exceptionnel : rien ne part par API, sauf chez Power Delivery
  // (décision du 16/10/2026, § lib/bon-envoi-exceptionnel.ts).
  const apiCoupee = Boolean(bon.exceptionnel) && transporteur !== 'Power Delivery';
  const api = transporteur && !apiCoupee ? API_TRANSPORTEURS[transporteur] : undefined;
  const commandes = bon.commandes ?? [];
  const nbAttente = commandes.filter((c) =>
    attendRemise({ source: c.source ?? 'manuel', enStock: c.enStock, statut: c.statut })
  ).length;
  const nbRecus = commandes.filter((c) => c.statut === 'recu_au_hub').length;
  const recu = bon.statut === 'recu';

  // Raison du grisé de chaque geste (null = possible).
  const raisonExport = bon.nbColis === 0 ? 'Bon vide.' : null;
  const raisonApi = recu ? 'Bon déjà reçu : plus rien à remettre.' : null;
  // Deux règles coexistent (décision du 14/10) : un colis Shipeh attend ce
  // bouton pour partir en transit ; les colis de nos marchands y sont passés
  // dès leur ajout au bon. On le dit en clair, sinon le grisé paraît absurde.
  const nbMarchands = commandes.filter((c) => !suitCircuitShipeh({ source: c.source ?? 'manuel', enStock: c.enStock })).length;
  const raisonManuelle = recu
    ? 'Bon déjà reçu : plus rien à remettre.'
    : nbAttente === 0
      ? nbMarchands > 0
        ? 'Inutile ici : les colis de marchands passent « En transit » dès leur ajout au bon. Envoyez l’Excel au transporteur, puis « Bon bien reçu ».'
        : 'Aucun colis en attente : ils sont déjà en transit.'
      : null;
  const raisonRecu = recu
    ? `Reçu le ${new Date(bon.dateReception ?? bon.dateGeneration).toLocaleDateString('fr-FR')}.`
    : nbAttente > 0
      ? `Transmettez d’abord les ${nbAttente} colis en attente (étape 2).`
      : null;
  const raisonDistribution = !recu
    ? 'Après « Bon bien reçu ».'
    : nbRecus === 0
      ? 'Tous les colis sont déjà en distribution.'
      : null;

  function exporter() {
    window.open(`/api/bons-envoi/${bon.id}/export`, '_blank');
    annoncerSucces(`Excel du bon ${bon.numero} téléchargé — transmettez-le à ${destinataire}.`);
  }

  async function remettreParApi() {
    if (!api) return;
    try {
      const res = await apiPost<ResultatBon>(`/api/bons-envoi/${bon.id}/${api.chemin}`);
      setResultat(res);
      if (res.totalRemis > 0) annoncerSucces(`${res.totalRemis} colis remis à ${transporteur} par API.`);
      if (res.totalNonRemis > 0) {
        annoncerEchec(`${res.totalNonRemis} colis non remis par API — détail sous le bandeau.`);
      }
      setConfirmation(null);
      onChange();
    } catch (err) {
      annoncerEchec(err, { prefixe: `Remise à ${transporteur}` });
      throw err;
    }
  }

  async function marquerTransmis() {
    try {
      const res = await apiPost<{ remis: number }>(`/api/bons-envoi/${bon.id}/remis`);
      annoncerSucces(`${res.remis} colis transmis à ${destinataire} : en transit.`);
      setConfirmation(null);
      onChange();
    } catch (err) {
      annoncerEchec(err, { prefixe: 'Transmission' });
      throw err;
    }
  }

  async function marquerRecu() {
    try {
      await apiPost(`/api/bons-envoi/${bon.id}/marquer-recu`);
      annoncerSucces(`Bon ${bon.numero} reçu par ${destinataire}.`);
      setConfirmation(null);
      onChange();
    } catch (err) {
      annoncerEchec(err, { prefixe: 'Bon bien reçu' });
      throw err;
    }
  }

  const libellesIssue = { ...LIBELLES_ISSUE, ...Object.fromEntries(Object.entries(api?.refus ?? {}).map(([k, l]) => [k, { libelle: l, style: 'bg-red-600 text-white' }])) };

  return (
    <>
      <section className="card-tint-strong sticky top-0 z-20 flex flex-col gap-3 p-4 text-sm shadow-sm" aria-label="Transmission du bon">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">
            Transmission à {destinataire}
            {api && <span className="ml-2 badge bg-cyan-400 text-cyan-950">API</span>}
          </p>
          <p className="opacity-70">
            {recu ? 'Bon reçu' : nbAttente > 0 ? `${nbAttente} colis en attente de transmission` : 'Colis en transit'}
          </p>
        </div>

        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Etape numero={1} titre="Exporter l’Excel" raison={raisonExport}>
            <button type="button" className="btn-outline flex w-full items-center justify-center gap-1.5" disabled={!!raisonExport} onClick={exporter}>
              <FileDown className="h-4 w-4" /> Export Excel
            </button>
          </Etape>

          <Etape numero={2} titre="Transmettre" raison={api ? raisonApi : raisonManuelle}>
            <div className="flex flex-col gap-2">
              {api && (
                <button
                  type="button"
                  className="btn-primary flex w-full items-center justify-center gap-1.5"
                  disabled={!!raisonApi}
                  title={raisonApi ?? undefined}
                  onClick={() => setConfirmation('api')}
                >
                  <Send className="h-4 w-4" /> Remettre à {transporteur} par API
                </button>
              )}
              <button
                type="button"
                className={`${api ? 'btn-outline' : 'btn-primary'} flex w-full items-center justify-center gap-1.5`}
                disabled={!!raisonManuelle}
                title={raisonManuelle ?? undefined}
                onClick={() => setConfirmation('manuelle')}
              >
                <Truck className="h-4 w-4" /> Marquer comme transmis{nbAttente > 0 ? ` (${nbAttente})` : ''}
              </button>
              {api && !raisonApi && raisonManuelle && <p className="text-xs opacity-60">Par Excel : {raisonManuelle}</p>}
              {apiCoupee && transporteur && API_TRANSPORTEURS[transporteur] && (
                <p className="text-xs opacity-60">BE exceptionnel : rien n&apos;est transmis à {transporteur} par API.</p>
              )}
            </div>
          </Etape>

          <Etape numero={3} titre="Bon bien reçu" raison={raisonRecu}>
            <button
              type="button"
              className="btn-primary flex w-full items-center justify-center gap-1.5"
              disabled={!!raisonRecu}
              onClick={() => setConfirmation('recu')}
            >
              <PackageCheck className="h-4 w-4" /> Bon bien reçu
            </button>
          </Etape>

          <Etape numero={4} titre="Mise en distribution" raison={raisonDistribution}>
            <button
              type="button"
              className="btn-primary flex w-full items-center justify-center gap-1.5"
              disabled={!!raisonDistribution}
              onClick={() => document.getElementById('mise-en-distribution')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            >
              <ListChecks className="h-4 w-4" /> Choisir les colis ({nbRecus})
            </button>
          </Etape>
        </ol>
      </section>

      {resultat && (
        <div className="card-tint-strong flex flex-col gap-3 p-4 text-sm">
          <p className="font-medium">
            Remise par API : {resultat.totalRemis} remis · {resultat.totalNonRemis} non remis
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
                  const issue = libellesIssue[r.issue] ?? { libelle: r.issue, style: '' };
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
        </div>
      )}

      {confirmation === 'api' && api && (
        <ModaleConfirmation
          titre={`Remettre à ${transporteur}`}
          libelleAction="Remettre par API"
          onConfirmer={remettreParApi}
          onClose={() => setConfirmation(null)}
        >
          Remettre les colis du bon <span className="font-mono">{bon.numero}</span> à {transporteur} ? {api.avertissement}
        </ModaleConfirmation>
      )}
      {confirmation === 'manuelle' && (
        <ModaleConfirmation
          titre="Marquer comme transmis"
          libelleAction="Colis transmis"
          danger={false}
          onConfirmer={marquerTransmis}
          onClose={() => setConfirmation(null)}
        >
          Confirmer que les {nbAttente} colis en attente ont été transmis à {destinataire} (Excel envoyé, colis remis) ?
          Ils passeront « En transit ».
        </ModaleConfirmation>
      )}
      {confirmation === 'recu' && (
        <ModaleConfirmation
          titre="Bon bien reçu"
          danger={false}
          onConfirmer={marquerRecu}
          onClose={() => setConfirmation(null)}
        >
          {bon.prestataire ? (
            <>
              Confirmer la prise en charge du bon <span className="font-mono">{bon.numero}</span> par {bon.prestataire.nom} ?
              Les colis Shipeh passent « Reçu au hub » du transporteur ; les autres restent « En transit ».
            </>
          ) : (
            <>
              Confirmer la réception du bon <span className="font-mono">{bon.numero}</span> ? Tous ses colis passeront au
              statut « Reçu au Hub ».
            </>
          )}
        </ModaleConfirmation>
      )}
    </>
  );
}

function Etape({
  numero,
  titre,
  raison,
  children,
}: {
  numero: number;
  titre: string;
  raison: string | null;
  children: React.ReactNode;
}) {
  return (
    <li className={`flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10 ${raison ? 'opacity-60' : ''}`}>
      <p className="flex items-center gap-2 font-semibold">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-xs text-white dark:bg-white dark:text-black">
          {numero}
        </span>
        {titre}
      </p>
      {children}
      <p className="min-h-[1rem] text-xs opacity-80">{raison ?? ''}</p>
    </li>
  );
}
