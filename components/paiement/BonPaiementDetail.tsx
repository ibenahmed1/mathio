'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Ban, Check, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { ModaleReglement } from '@/components/paiement/ModaleReglement';
import type { BonPaiement, ModeReglementLivreur, TypeAjustementPaiement } from '@/lib/types';

// Détail d'un bon de paiement (§ /admin/bon-paiement) : l'assiette figée, les
// ajustements, et les trois transitions d'état. Tout ce qui fait bouger le
// montant est ici — le tableau de bord ne fait que lister et payer.

function montant(valeur: string | number) {
  return `${Number(valeur).toFixed(2)} DH`;
}

const LIBELLES_STATUT: Record<BonPaiement['statut'], string> = {
  brouillon: 'Brouillon',
  valide: 'Validé',
  paye: 'Payé',
  annule: 'Annulé',
};

const CLASSES_STATUT: Record<BonPaiement['statut'], string> = {
  brouillon: 'bg-amber-400 text-amber-950',
  valide: 'bg-indigo-600 text-white',
  paye: 'bg-green-600 text-white',
  annule: 'bg-neutral-400 text-neutral-900',
};

const LIBELLES_MODE: Record<ModeReglementLivreur, string> = {
  virement: 'Virement',
  especes: 'Espèces',
  cheque: 'Chèque',
};

function dateHeure(valeur: string | null) {
  return valeur
    ? new Date(valeur).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}

function libellePeriode(debut: string) {
  return new Date(debut).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export function BonPaiementDetail({ bonId, onRetour }: { bonId: string; onRetour: () => void }) {
  const [bon, setBon] = useState<BonPaiement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [reglementOuvert, setReglementOuvert] = useState(false);

  // Formulaire d'ajustement, replié par défaut : dans le cas courant le bon
  // part tel quel, et un formulaire toujours ouvert invite à en ajouter.
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [type, setType] = useState<TypeAjustementPaiement>('prime');
  const [libelle, setLibelle] = useState('');
  const [valeur, setValeur] = useState('');

  const load = useCallback(() => {
    apiGet<BonPaiement>(`/api/bons-paiement/${bonId}`)
      .then(setBon)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
  }, [bonId]);

  useEffect(() => {
    load();
  }, [load]);

  async function agir(action: () => Promise<unknown>) {
    setEnCours(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setEnCours(false);
    }
  }

  function ajouterAjustement() {
    const nombre = Number(valeur.replace(',', '.'));
    if (!libelle.trim() || !Number.isFinite(nombre) || nombre <= 0) {
      setError('Renseignez un libellé et un montant positif.');
      return;
    }
    void agir(async () => {
      await apiPost(`/api/bons-paiement/${bonId}/ajustements`, {
        type,
        libelle: libelle.trim(),
        montant: nombre,
      });
      setLibelle('');
      setValeur('');
      setAjoutOuvert(false);
    });
  }

  function annuler() {
    const motif = window.prompt(
      "Motif de l'annulation ? Les tournées du bon redeviendront réglables sur la période."
    );
    if (!motif || !motif.trim()) return;
    void agir(() => apiPost(`/api/bons-paiement/${bonId}/annuler`, { motif: motif.trim() }));
  }

  function payer(modeReglement: ModeReglementLivreur, referenceReglement: string) {
    void agir(async () => {
      await apiPost(`/api/bons-paiement/${bonId}/payer`, { modeReglement, referenceReglement });
      setReglementOuvert(false);
    });
  }

  if (!bon) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={onRetour} className="flex w-fit items-center gap-1.5 text-sm opacity-70">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : <p className="opacity-60">Chargement…</p>}
      </div>
    );
  }

  const modifiable = bon.statut === 'brouillon';

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onRetour}
        className="flex w-fit items-center gap-1.5 text-sm opacity-70 hover:opacity-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au tableau de bord
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <span className="font-mono">{bon.numero}</span>
            <span className={`badge ${CLASSES_STATUT[bon.statut]}`}>{LIBELLES_STATUT[bon.statut]}</span>
          </h1>
          <p className="text-sm opacity-70">
            {bon.livreur?.nomComplet} · Paie de {libellePeriode(bon.periodeDebut)}
            {bon.hub && ` · Hub ${bon.hub.nom}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/bons-paiement/${bon.id}`}
            target="_blank"
            className="btn-outline flex items-center gap-1.5"
            title="Fiche de paie imprimable"
          >
            <Printer className="h-4 w-4" />
            Fiche de paie
          </Link>
          {bon.statut === 'brouillon' && (
            <button
              type="button"
              disabled={enCours}
              onClick={() => agir(() => apiPost(`/api/bons-paiement/${bon.id}/valider`))}
              className="btn-primary flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              Valider le montant
            </button>
          )}
          {bon.statut === 'valide' && (
            <button
              type="button"
              disabled={enCours}
              onClick={() => setReglementOuvert(true)}
              className="btn-primary flex items-center gap-1.5"
            >
              <Wallet className="h-4 w-4" />
              Marquer comme payé
            </button>
          )}
          {(bon.statut === 'brouillon' || bon.statut === 'valide') && (
            <button
              type="button"
              disabled={enCours}
              onClick={annuler}
              className="btn-outline flex items-center gap-1.5 text-red-700 dark:text-red-400"
            >
              <Ban className="h-4 w-4" />
              Annuler
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {bon.statut === 'annule' && bon.motifAnnulation && (
        <p className="rounded border border-neutral-300 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <span className="font-medium">Annulé</span>
          {bon.dateAnnulation && ` le ${new Date(bon.dateAnnulation).toLocaleDateString('fr-FR')}`} —{' '}
          {bon.motifAnnulation}. Les tournées ont été libérées et peuvent être régénérées.
        </p>
      )}

      {bon.statut === 'paye' && (
        <p className="rounded border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          Payé le {bon.dateReglement && new Date(bon.dateReglement).toLocaleDateString('fr-FR')}
          {bon.modeReglement && ` par ${LIBELLES_MODE[bon.modeReglement].toLowerCase()}`}
          {bon.referenceReglement && (
            <>
              {' '}
              — réf. <span className="font-mono">{bon.referenceReglement}</span>
            </>
          )}
          .
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">
          Commissions — {(bon.colis ?? []).length} colis sur {bon.nbTournees} tournée(s)
        </h2>
        <p className="text-sm opacity-70">
          Les frais ci-dessous ont été figés colis par colis à la clôture de chaque tournée. Ils ne sont jamais
          recalculés : modifier la grille tarifaire d&apos;un livreur ne change pas ce qu&apos;il a déjà gagné.
          Le CRBT est indiqué pour information — il a été remis intégralement au dépôt et n&apos;entre pas dans
          le net.
        </p>
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[860px]">
            <thead>
              <tr>
                <th>N°</th>
                <th>Code d&apos;envoi</th>
                <th>Client</th>
                <th>Ville</th>
                <th>Date de livraison</th>
                <th>Statut</th>
                <th>CRBT</th>
                <th>Frais</th>
              </tr>
            </thead>
            <tbody>
              {(bon.colis ?? []).map((c, index) => (
                <tr key={c.id}>
                  <td className="tabular-nums opacity-60">{index + 1}</td>
                  <td className="font-mono font-bold">{c.codeSuivi}</td>
                  <td>{c.clientNom}</td>
                  <td>{c.ville}</td>
                  <td>{dateHeure(c.dateLivraison ?? c.bonDistribution?.dateCloture ?? null)}</td>
                  <td>
                    <span className={`badge ${c.fraisLivreurLivre === false ? 'badge-warn' : 'bg-green-600 text-white'}`}>
                      {c.fraisLivreurLivre === false ? 'Retourné' : 'Livré'}
                    </span>
                  </td>
                  <td className="tabular-nums opacity-70">
                    {c.fraisLivreurLivre === false ? '—' : montant(c.montantCod)}
                  </td>
                  {/* « — » plutôt qu'un montant reconstitué : ces tournées ont
                      été clôturées avant l'introduction du détail au colis, et
                      le recalculer avec la grille d'aujourd'hui inventerait un
                      chiffre. Le total reste juste, il vient du gain figé. */}
                  <td className="font-mono font-bold tabular-nums">
                    {c.fraisLivreur === null ? '—' : montant(c.fraisLivreur)}
                  </td>
                </tr>
              ))}
              {(bon.colis ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center opacity-60">
                    Aucun colis rattaché à ce bon.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs opacity-60">
          Tournées couvertes : {(bon.tournees ?? []).map((t) => t.numero).join(', ') || '—'}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">Primes et pénalités</h2>
          {modifiable && !ajoutOuvert && (
            <button type="button" onClick={() => setAjoutOuvert(true)} className="btn-outline flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Ajouter un ajustement
            </button>
          )}
        </div>

        {ajoutOuvert && (
          <div className="flex flex-wrap items-end gap-2 rounded border border-black/10 p-3 dark:border-white/15">
            <label className="flex flex-col gap-1">
              <span className="text-xs opacity-60">Type</span>
              <select
                className="input-basic"
                value={type}
                onChange={(e) => setType(e.target.value as TypeAjustementPaiement)}
              >
                <option value="prime">Prime (+)</option>
                <option value="penalite">Pénalité (−)</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs opacity-60">Motif</span>
              <input
                className="input-basic"
                value={libelle}
                onChange={(e) => setLibelle(e.target.value)}
                placeholder={type === 'prime' ? 'Prime de performance' : 'Colis perdu — PD-000123'}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs opacity-60">Montant (DH)</span>
              <input
                className="input-basic w-32"
                inputMode="decimal"
                value={valeur}
                onChange={(e) => setValeur(e.target.value)}
                placeholder="150"
              />
            </label>
            <button type="button" className="btn-primary" disabled={enCours} onClick={ajouterAjustement}>
              Ajouter
            </button>
            <button type="button" className="btn-outline" onClick={() => setAjoutOuvert(false)}>
              Fermer
            </button>
          </div>
        )}

        {(bon.ajustements ?? []).length === 0 ? (
          <p className="text-sm opacity-60">
            Aucun ajustement — le net versé est égal à la somme des commissions.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-basic min-w-[560px]">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Motif</th>
                  <th>Saisi par</th>
                  <th>Effet</th>
                  {modifiable && <th></th>}
                </tr>
              </thead>
              <tbody>
                {(bon.ajustements ?? []).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className={`badge ${a.type === 'prime' ? 'bg-green-600 text-white' : 'badge-danger'}`}>
                        {a.type === 'prime' ? 'Prime' : 'Pénalité'}
                      </span>
                    </td>
                    <td>{a.libelle}</td>
                    <td className="opacity-70">{a.creePar?.nomComplet ?? '—'}</td>
                    <td className="font-mono font-bold tabular-nums">
                      {a.type === 'penalite' ? '−' : '+'}
                      {montant(a.montant)}
                    </td>
                    {modifiable && (
                      <td>
                        <button
                          type="button"
                          disabled={enCours}
                          onClick={() => agir(() => apiDelete(`/api/bons-paiement/${bon.id}/ajustements/${a.id}`))}
                          className="rounded p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950"
                          title="Retirer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex justify-end">
        <table className="w-72 text-sm">
          <tbody>
            <tr>
              <td className="py-0.5">Commissions</td>
              <td className="py-0.5 text-right font-mono tabular-nums">{montant(bon.montantCommissions)}</td>
            </tr>
            <tr>
              <td className="py-0.5">Ajustements</td>
              <td className="py-0.5 text-right font-mono tabular-nums">
                {Number(bon.totalAjustements) >= 0 ? '+' : '−'}
                {montant(Math.abs(Number(bon.totalAjustements)))}
              </td>
            </tr>
            <tr className="border-t-2 border-current font-black">
              <td className="pt-1.5">NET À VERSER</td>
              <td className="pt-1.5 text-right font-mono tabular-nums">{montant(bon.montantTotal)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {reglementOuvert && (
        <ModaleReglement
          numero={bon.numero}
          beneficiaire={bon.livreur?.nomComplet ?? ''}
          montant={montant(bon.montantTotal)}
          enCours={enCours}
          onClose={() => setReglementOuvert(false)}
          onConfirmer={payer}
        />
      )}
    </div>
  );
}
