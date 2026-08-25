'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Hourglass, Printer, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { LivreurShell } from '@/components/livreur/LivreurShell';
import type { BonPaiementLivreur, ModeReglementLivreur, PaieLivreur, StatutBonPaiement } from '@/lib/types';

// § /livreur/bons-paiement — « Ma paie ». L'entrée existait dans la navigation
// (components/livreur/nav.ts) mais pointait vers une page absente : le livreur
// ne voyait qu'un solde global sur /livreur/bons-distribution, jamais le
// document qui le concerne.
//
// Trois choses que cet écran doit dire, et que le solde brut ne disait pas :
//   — où en est ma paie du mois (en préparation, arrêtée, versée) ;
//   — pourquoi mon net diffère de mes commissions (primes et pénalités,
//     lisibles ligne à ligne) ;
//   — ce qui n'est pas encore rattaché à un bon, et pour quel mois.

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

// Libellés tournés vers le livreur, pas vers le comptable : « brouillon » ne
// veut rien dire pour lui, « en préparation » si.
const LIBELLES: Record<StatutBonPaiement, string> = {
  brouillon: 'En préparation',
  valide: 'Arrêté — en attente de versement',
  paye: 'Versé',
  annule: 'Annulé',
};

const CLASSES: Record<StatutBonPaiement, string> = {
  brouillon: 'badge-neutral',
  valide: 'bg-amber-400 text-amber-950',
  paye: 'bg-green-600 text-white',
  annule: 'badge-danger',
};

const MODES: Record<ModeReglementLivreur, string> = {
  virement: 'virement',
  especes: 'espèces',
  cheque: 'chèque',
};

function dh(valeur: string | number | null) {
  return `${Number(valeur ?? 0).toFixed(2)} DH`;
}

function libellePeriode(debut: string) {
  const d = new Date(debut);
  return `${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function Tuile({ label, valeur, aide }: { label: string; valeur: string; aide: string }) {
  return (
    <div className="card-tint-strong flex flex-col gap-0.5 px-4 py-3">
      <span className="text-xs font-semibold opacity-60">{label}</span>
      <span className="text-xl font-bold">{valeur}</span>
      <span className="text-xs opacity-60">{aide}</span>
    </div>
  );
}

function LigneBon({ bon }: { bon: BonPaiementLivreur }) {
  const [ouvert, setOuvert] = useState(false);
  const aDesAjustements = bon.ajustements.length > 0;

  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            onClick={() => setOuvert((v) => !v)}
            className="flex items-center gap-1 text-left font-medium"
            aria-expanded={ouvert}
          >
            {ouvert ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {libellePeriode(bon.periodeDebut)}
          </button>
          <span className="ml-5 block font-mono text-xs opacity-60">{bon.numero}</span>
        </td>
        <td>
          <span className={`badge ${CLASSES[bon.statut]}`}>{LIBELLES[bon.statut]}</span>
        </td>
        <td className="whitespace-nowrap">
          {bon.nbColisLivres} livré(s)
          {bon.nbColisRetournes > 0 && (
            <span className="block text-xs opacity-60">{bon.nbColisRetournes} retourné(s)</span>
          )}
        </td>
        <td className="whitespace-nowrap">{dh(bon.montantCommissions)}</td>
        <td className="whitespace-nowrap">
          {Number(bon.totalAjustements) === 0 ? (
            <span className="opacity-40">—</span>
          ) : (
            <span className={Number(bon.totalAjustements) < 0 ? 'font-bold text-red-600' : 'font-bold text-green-700'}>
              {Number(bon.totalAjustements) >= 0 ? '+' : '−'}
              {dh(Math.abs(Number(bon.totalAjustements)))}
            </span>
          )}
        </td>
        <td className="whitespace-nowrap font-bold">{dh(bon.montantTotal)}</td>
        <td>
          <a
            href={`/bons-paiement/${bon.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
            title="Ma fiche de paie"
          >
            <Printer className="h-4 w-4" />
          </a>
        </td>
      </tr>

      {ouvert && (
        <tr>
          <td colSpan={7} className="bg-black/[0.02] dark:bg-white/[0.03]">
            <div className="flex flex-col gap-2 px-2 py-3 text-sm">
              {aDesAjustements ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-bold uppercase tracking-wide opacity-60">Primes et pénalités</p>
                  {bon.ajustements.map((a) => (
                    <p key={a.id} className="flex items-center justify-between gap-4">
                      <span>{a.libelle}</span>
                      <span
                        className={`whitespace-nowrap font-mono font-bold ${a.type === 'penalite' ? 'text-red-600' : 'text-green-700'}`}
                      >
                        {a.type === 'penalite' ? '−' : '+'}
                        {dh(a.montant)}
                      </span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="opacity-60">
                  Aucune prime ni pénalité — le net est égal à la somme de vos commissions.
                </p>
              )}

              <p className="text-xs opacity-60">
                {bon.nbTournees} tournée(s){bon.hub && ` · Hub ${bon.hub.nom}`} · établi le{' '}
                {new Date(bon.dateGeneration).toLocaleDateString('fr-FR')}
              </p>

              {bon.statut === 'paye' && bon.dateReglement && (
                <p className="text-green-700 dark:text-green-400">
                  Versé le {new Date(bon.dateReglement).toLocaleDateString('fr-FR')}
                  {bon.modeReglement && ` par ${MODES[bon.modeReglement]}`}
                  {bon.referenceReglement && (
                    <>
                      {' '}
                      — réf. <span className="font-mono">{bon.referenceReglement}</span>
                    </>
                  )}
                  .
                </p>
              )}

              {bon.statut === 'brouillon' && (
                <p className="opacity-70">
                  Ce montant n&apos;est pas encore arrêté : la comptabilité peut encore y ajouter une prime ou
                  une pénalité avant validation.
                </p>
              )}

              {bon.statut === 'annule' && (
                <p className="text-red-600">
                  Annulé
                  {bon.dateAnnulation && ` le ${new Date(bon.dateAnnulation).toLocaleDateString('fr-FR')}`}
                  {bon.motifAnnulation && ` — ${bon.motifAnnulation}`}. Les tournées concernées repartent dans
                  vos gains à régler.
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PaieLivreurPage() {
  const [paie, setPaie] = useState<PaieLivreur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PaieLivreur>('/api/livreur/bons-paiement')
      .then(setPaie)
      .catch((err) => setErreur(err instanceof Error ? err.message : 'Erreur'));
  }, []);

  return (
    <LivreurShell>
      <div className="flex flex-col gap-5">
        <h1 className="page-title flex items-center gap-2">
          <Wallet className="h-6 w-6 text-brand-ink dark:text-brand" />
          Ma paie
        </h1>

        {erreur && <p className="text-sm font-medium text-red-600">{erreur}</p>}

        {paie && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tuile
                label="Total à percevoir"
                valeur={dh(paie.totalDu)}
                aide="Bons non versés + gains pas encore rattachés"
              />
              <Tuile
                label="Montant arrêté"
                valeur={dh(paie.totalArrete)}
                aide="Bons émis, primes et pénalités comprises"
              />
              <Tuile
                label="En cours d'accumulation"
                valeur={dh(paie.totalNonGenere)}
                aide="Tournées clôturées, bon pas encore établi"
              />
            </div>

            <p className="text-xs opacity-60">
              Vos gains sont figés colis par colis à la clôture de chaque tournée au dépôt. Ils sont réglés
              une fois par mois, séparément du cash que vous remettez au Planner.
            </p>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">Mes bons de paiement</h2>
              <div className="overflow-x-auto">
                <table className="table-basic min-w-[820px]">
                  <thead>
                    <tr>
                      <th>Période</th>
                      <th>État</th>
                      <th>Colis</th>
                      <th>Commissions</th>
                      <th>Ajustements</th>
                      <th>Net</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paie.bons.map((b) => (
                      <LigneBon key={b.id} bon={b} />
                    ))}
                    {paie.bons.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-4 text-center opacity-60">
                          Aucun bon de paiement pour le moment.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Le reliquat est affiché à part, et jamais mélangé aux bons : ce
                montant n'est pas encore un engagement, il peut encore bouger
                si une tournée du mois est rouverte ou si une pénalité est
                saisie à la génération. */}
            {paie.periodesNonGenerees.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide opacity-60">
                  <Hourglass className="h-4 w-4" />
                  Pas encore rattaché à un bon
                </h2>
                <div className="overflow-x-auto">
                  <table className="table-basic min-w-[520px]">
                    <thead>
                      <tr>
                        <th>Mois</th>
                        <th>Tournées</th>
                        <th>Colis livrés</th>
                        <th>Commissions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paie.periodesNonGenerees.map((p) => (
                        <tr key={`${p.annee}-${p.mois}`}>
                          <td className="font-medium">
                            {MOIS[p.mois - 1]} {p.annee}
                          </td>
                          <td>{p.nbTournees}</td>
                          <td>{p.nbColisLivres}</td>
                          <td className="whitespace-nowrap font-bold">{dh(p.montant)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs opacity-60">
                  Ces gains sont acquis : ils seront repris dans le bon de paiement du mois correspondant.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </LivreurShell>
  );
}
