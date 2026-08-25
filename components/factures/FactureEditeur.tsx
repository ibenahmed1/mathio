'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  FileText,
  Plus,
  Save,
  Search,
  Trash2,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { StatutBadge } from '@/components/StatutBadge';
import type {
  Facture,
  FraisAnnexeSaisi,
  ModeReglementMarchand,
  PrevisualisationFacture,
} from '@/lib/types';

// § /admin/factures/nouvelle (étape 2) et /admin/factures/[id]/modifier.
//
// Un seul écran pour les deux cas : composer une facture neuve et reprendre un
// brouillon sont le même geste sur les mêmes données. Les dupliquer aurait
// garanti qu'ils divergent au premier correctif.
//
// Trois partis pris d'interface :
//
//  1. Tous les colis facturables arrivent PRÉ-COCHÉS. Le cas courant est
//     « facturer tout ce qui est dû » ; demander de tout cocher à la main
//     ferait payer le cas rare par le cas fréquent, et un oubli de case
//     coûterait au marchand un mois de reversement.
//
//  2. Le récapitulatif est COLLANT (sticky) à droite. Le net à reverser est le
//     seul chiffre qui engage : il doit rester sous les yeux pendant qu'on
//     décoche des lignes trente rangées plus bas, sinon on décoche à l'aveugle.
//
//  3. Les totaux se recalculent LOCALEMENT à partir des tarifs déjà renvoyés
//     par le serveur — décocher un colis ne doit pas provoquer un aller-retour
//     réseau. L'enregistrement, lui, recalcule côté serveur sur la sélection
//     réelle : c'est le chiffre serveur qui fait foi.

type Finalisation = 'brouillon' | 'emise' | 'payee';

const MODES: { valeur: ModeReglementMarchand; label: string; icone: typeof Banknote }[] = [
  { valeur: 'virement', label: 'Virement', icone: CreditCard },
  { valeur: 'cheque', label: 'Chèque', icone: FileText },
  { valeur: 'especes', label: 'Espèces', icone: Banknote },
];

// Libellés proposés en un clic : ce sont les trois qui reviennent, et les
// saisir à la main garantit trois orthographes différentes dans le journal.
const FRAIS_COURANTS = ['Emballage', 'Réexpédition', 'Service dédié'];

function montant(valeur: number) {
  return `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

export function FactureEditeur({
  marchandId,
  factureExistante,
  onRetour,
  retourLabel = 'Choisir un autre client',
}: {
  marchandId: string;
  /** Présente = reprise d'un brouillon ; absente = création. */
  factureExistante?: Facture;
  onRetour: () => void;
  retourLabel?: string;
}) {
  const router = useRouter();
  const brouillonId = factureExistante?.id ?? null;

  const [apercu, setApercu] = useState<PrevisualisationFacture | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [frais, setFrais] = useState<FraisAnnexeSaisi[]>(
    factureExistante?.fraisAnnexes?.map((f) => ({ libelle: f.libelle, montant: Number(f.montant) })) ?? []
  );
  const [libelleFrais, setLibelleFrais] = useState('');
  const [montantFrais, setMontantFrais] = useState('');
  const [recherche, setRecherche] = useState('');

  const [mode, setMode] = useState<ModeReglementMarchand>(factureExistante?.modeReglement ?? 'virement');
  const [reference, setReference] = useState(factureExistante?.referenceReglement ?? '');

  const [enCours, setEnCours] = useState<Finalisation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ marchandId });
    if (brouillonId) query.set('factureId', brouillonId);

    apiGet<PrevisualisationFacture>(`/api/factures/previsualiser?${query.toString()}`)
      .then((res) => {
        setApercu(res);
        // Reprise d'un brouillon : la sélection est celle DÉJÀ enregistrée, pas
        // toute l'assiette — un colis volontairement écarté la semaine dernière
        // ne doit pas revenir tout seul.
        setSelection(
          new Set(
            factureExistante?.lignes
              ? factureExistante.lignes.map((l) => l.commandeId)
              : res.colis.map((c) => c.id)
          )
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'));
    // `factureExistante` est figée pour la durée de l'écran : la relire à chaque
    // rendu réinitialiserait la sélection sous les doigts de l'utilisateur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marchandId, brouillonId]);

  const tarifParColis = useMemo(
    () => new Map((apercu?.total.lignes ?? []).map((l) => [l.commandeId, l])),
    [apercu]
  );

  const colisFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q || !apercu) return apercu?.colis ?? [];
    return apercu.colis.filter(
      (c) => c.codeSuivi.toLowerCase().includes(q) || c.clientNom.toLowerCase().includes(q) || c.ville.toLowerCase().includes(q)
    );
  }, [apercu, recherche]);

  const totaux = useMemo(() => {
    let cod = 0;
    let fraisLivraison = 0;
    let fraisRetour = 0;
    let livres = 0;
    let retours = 0;

    for (const ligne of tarifParColis.values()) {
      if (!selection.has(ligne.commandeId)) continue;
      if (ligne.livre) {
        livres += 1;
        cod += ligne.montantCod;
        fraisLivraison += ligne.frais;
      } else {
        retours += 1;
        fraisRetour += ligne.frais;
      }
    }

    const autres = frais.reduce((s, f) => s + f.montant, 0);
    return {
      cod,
      fraisLivraison,
      fraisRetour,
      autres,
      livres,
      retours,
      net: cod - fraisLivraison - fraisRetour - autres,
    };
  }, [tarifParColis, selection, frais]);

  const colisIds = useMemo(() => [...selection], [selection]);
  const toutCoche = colisFiltres.length > 0 && colisFiltres.every((c) => selection.has(c.id));

  function basculer(colisId: string) {
    setSelection((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(colisId)) suivant.delete(colisId);
      else suivant.add(colisId);
      return suivant;
    });
  }

  // La case d'en-tête agit sur ce qui est VISIBLE, pas sur toute l'assiette :
  // après un filtre « Casablanca », « tout décocher » doit retirer Casablanca
  // et rien d'autre — c'est ce que l'utilisateur voit et donc ce qu'il attend.
  function basculerTout() {
    setSelection((prev) => {
      const suivant = new Set(prev);
      for (const c of colisFiltres) {
        if (toutCoche) suivant.delete(c.id);
        else suivant.add(c.id);
      }
      return suivant;
    });
  }

  function ajouterFrais() {
    const libelle = libelleFrais.trim();
    const valeur = Number(montantFrais.replace(',', '.'));
    if (!libelle || !Number.isFinite(valeur) || valeur <= 0) return;
    setFrais((prev) => [...prev, { libelle, montant: Number(valeur.toFixed(2)) }]);
    setLibelleFrais('');
    setMontantFrais('');
  }

  const enregistrer = useCallback(
    async (finaliser: Finalisation) => {
      if (colisIds.length === 0 || enCours) return;
      if (finaliser === 'payee') {
        const question = `Confirmer le reversement de ${montant(totaux.net)} à ${apercu?.marchand.nomBoutique} ? Une écriture comptable de sortie de caisse sera générée.`;
        if (!window.confirm(question)) return;
      }

      setEnCours(finaliser);
      setError(null);
      try {
        let facture: Facture;

        if (brouillonId) {
          // Le brouillon est d'abord synchronisé, puis avancé dans son cycle :
          // émettre une facture dont la sélection à l'écran diffère de celle en
          // base figerait le mauvais montant.
          facture = await apiPatch<Facture>(`/api/factures/${brouillonId}`, {
            colisIds,
            autresFrais: frais,
          });
          if (finaliser !== 'brouillon') {
            facture = await apiPost<Facture>(`/api/factures/${brouillonId}/emettre`);
          }
          if (finaliser === 'payee') {
            facture = await apiPost<Facture>(`/api/factures/${brouillonId}/payer`, {
              modeReglement: mode,
              referenceReglement: reference,
            });
          }
        } else {
          // Création : les trois étapes tiennent dans une seule transaction
          // serveur, donc un seul appel — rien ne peut rester à moitié fait.
          facture = await apiPost<Facture>('/api/factures', {
            marchandId,
            colisIds,
            autresFrais: frais,
            finaliser,
            ...(finaliser === 'payee' ? { modeReglement: mode, referenceReglement: reference } : {}),
          });
        }

        // Un brouillon retourne à la liste des factures (il n'y a rien à
        // imprimer) ; une facture arrêtée ouvre son document.
        router.push(finaliser === 'brouillon' ? '/admin/factures/toutes' : `/factures/${facture.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur');
        setEnCours(null);
      }
    },
    [apercu, brouillonId, colisIds, enCours, frais, marchandId, mode, reference, router, totaux.net]
  );

  const referenceRequise = mode !== 'especes';
  const paiementPret = !referenceRequise || reference.trim().length > 0;

  if (!apercu) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={onRetour} className="flex w-fit items-center gap-1.5 text-sm opacity-70">
          <ArrowLeft className="h-4 w-4" />
          {retourLabel}
        </button>
        {error ? (
          <p className="text-sm font-medium text-red-600">{error}</p>
        ) : (
          <p className="opacity-60">Chargement de l&apos;assiette facturable…</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onRetour}
        className="flex w-fit items-center gap-1.5 text-sm opacity-70 hover:opacity-100"
      >
        <ArrowLeft className="h-4 w-4" />
        {retourLabel}
      </button>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="page-title">{apercu.marchand.nomBoutique}</h1>
          <p className="text-sm opacity-60">
            {[apercu.marchand.raisonSociale, apercu.marchand.ville].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        {factureExistante && (
          <span className="badge badge-warn">
            Brouillon {factureExistante.numero} — repris pour modification
          </span>
        )}
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ------------------------------------------------ colonne gauche */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* --- Colis ajoutés --- */}
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">
                Liste des colis ajoutés
                <span className="ml-2 font-mono opacity-60">
                  {selection.size} / {apercu.colis.length}
                </span>
              </h2>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
                <input
                  className="input-basic w-56 pl-9"
                  placeholder="Code, client, ville…"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                />
              </div>
            </div>

            <div className="table-card max-h-[32rem] overflow-auto">
              <table className="table-basic min-w-[720px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={toutCoche}
                        onChange={basculerTout}
                        aria-label={toutCoche ? 'Tout décocher' : 'Tout cocher'}
                      />
                    </th>
                    <th>Code suivi</th>
                    <th>Client</th>
                    <th>Ville</th>
                    <th>Nature</th>
                    <th className="text-right">CRBT</th>
                    <th className="text-right">Frais</th>
                    <th className="w-px"></th>
                  </tr>
                </thead>
                <tbody>
                  {colisFiltres.map((c) => {
                    const ligne = tarifParColis.get(c.id);
                    const retenu = selection.has(c.id);
                    return (
                      <tr key={c.id} className={retenu ? '' : 'opacity-45'}>
                        <td>
                          <input
                            type="checkbox"
                            checked={retenu}
                            onChange={() => basculer(c.id)}
                            aria-label={`Inclure ${c.codeSuivi}`}
                          />
                        </td>
                        <td className="font-mono font-semibold">{c.codeSuivi}</td>
                        <td>{c.clientNom}</td>
                        <td>{c.ville}</td>
                        <td>
                          <StatutBadge statut={c.statut} />
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {ligne?.livre ? montant(ligne.montantCod) : '—'}
                        </td>
                        <td className="text-right font-mono tabular-nums opacity-70">
                          −{montant(ligne?.frais ?? 0)}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => basculer(c.id)}
                            title={retenu ? 'Retirer de la facture' : 'Remettre dans la facture'}
                            className="rounded p-1.5 text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            {retenu ? <Trash2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {colisFiltres.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty-state">Aucun colis ne correspond à cette recherche.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Un colis retiré n'est pas perdu : le dire évite l'hésitation
                devant l'icône de suppression, qui a l'air définitive. */}
            <p className="text-xs opacity-60">
              Un colis décoché reste facturable et ressortira dans la prochaine facture de ce client.
            </p>
          </section>

          {/* --- Autres frais --- */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">
              Autres frais
              {frais.length > 0 && <span className="ml-2 font-mono opacity-60">{frais.length}</span>}
            </h2>

            <div className="table-card">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>Libellé</th>
                    <th className="text-right">Montant</th>
                    <th className="w-px"></th>
                  </tr>
                </thead>
                <tbody>
                  {frais.map((f, i) => (
                    <tr key={`${f.libelle}-${i}`}>
                      <td>{f.libelle}</td>
                      <td className="text-right font-mono tabular-nums">−{montant(f.montant)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setFrais((prev) => prev.filter((_, j) => j !== i))}
                          aria-label={`Retirer ${f.libelle}`}
                          className="rounded p-1.5 text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {frais.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-center text-sm opacity-60">
                        Aucun frais annexe. Emballage, réexpédition, service dédié…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] p-3 dark:border-white/[0.06]">
                <input
                  className="input-basic min-w-[10rem] flex-1"
                  placeholder="Libellé du frais"
                  value={libelleFrais}
                  onChange={(e) => setLibelleFrais(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && ajouterFrais()}
                />
                <input
                  className="input-basic w-32 text-right font-mono"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={montantFrais}
                  onChange={(e) => setMontantFrais(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && ajouterFrais()}
                />
                <button
                  type="button"
                  onClick={ajouterFrais}
                  disabled={!libelleFrais.trim() || !montantFrais.trim()}
                  className="btn-outline flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-black/[0.06] px-3 pb-3 pt-2 dark:border-white/[0.06]">
                <span className="text-xs opacity-50">Fréquents :</span>
                {FRAIS_COURANTS.map((libelle) => (
                  <button
                    key={libelle}
                    type="button"
                    onClick={() => setLibelleFrais(libelle)}
                    className="rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-semibold transition hover:bg-brand/25 dark:bg-white/10"
                  >
                    {libelle}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ----------------------------------------------- colonne droite */}
        <aside className="flex flex-col gap-3 xl:sticky xl:top-4 xl:self-start">
          <section className="dashboard-card flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider opacity-60">Récapitulatif</h2>

            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt>
                  CRBT encaissé
                  <span className="ml-1 text-xs opacity-50">{totaux.livres} livré(s)</span>
                </dt>
                <dd className="font-mono tabular-nums">{montant(totaux.cod)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 opacity-80">
                <dt>Frais de livraison</dt>
                <dd className="font-mono tabular-nums">−{montant(totaux.fraisLivraison)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 opacity-80">
                <dt>
                  Frais de retour
                  <span className="ml-1 text-xs opacity-50">{totaux.retours} retour(s)</span>
                </dt>
                <dd className="font-mono tabular-nums">−{montant(totaux.fraisRetour)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 opacity-80">
                <dt>Autres frais</dt>
                <dd className="font-mono tabular-nums">−{montant(totaux.autres)}</dd>
              </div>
            </dl>

            <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-black/10 pt-2 dark:border-white/15">
              <span className="text-sm font-bold uppercase tracking-wide">Net à reverser</span>
              <span className="font-mono text-xl font-black tabular-nums">{montant(totaux.net)}</span>
            </div>

            {totaux.net < 0 && (
              <p className="flex items-start gap-1.5 rounded-md bg-red-500/10 p-2 text-xs font-medium text-red-700 dark:text-red-400">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Net négatif : les frais dépassent le CRBT encaissé, c&apos;est donc le marchand qui doit à la
                plateforme. L&apos;écriture comptable sera enregistrée en recette.
              </p>
            )}
          </section>

          <section className="dashboard-card flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider opacity-60">Mode de règlement</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {MODES.map(({ valeur, label, icone: Icone }) => (
                <button
                  key={valeur}
                  type="button"
                  onClick={() => setMode(valeur)}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold transition ${
                    mode === valeur
                      ? 'border-brand bg-brand/15'
                      : 'border-black/10 hover:bg-black/[0.04] dark:border-white/15 dark:hover:bg-white/10'
                  }`}
                >
                  <Icone className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {referenceRequise && (
              <input
                className="input-basic"
                placeholder={mode === 'cheque' ? 'N° de chèque' : 'Référence du virement'}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
            <p className="text-xs opacity-55">
              {referenceRequise
                ? 'Obligatoire au règlement : sans référence, « payée » est invérifiable le jour d’une contestation.'
                : 'Espèces : la trace, c’est la signature sur le reçu papier.'}
            </p>
          </section>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => enregistrer('emise')}
              disabled={enCours !== null || selection.size === 0}
              className="btn-primary flex items-center justify-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              {enCours === 'emise' ? 'Émission…' : `Émettre la facture (${selection.size})`}
            </button>

            <button
              type="button"
              onClick={() => enregistrer('payee')}
              disabled={enCours !== null || selection.size === 0 || !paiementPret}
              title={paiementPret ? undefined : 'Renseignez la référence du règlement'}
              className="btn-outline flex items-center justify-center gap-1.5"
            >
              <Wallet className="h-4 w-4" />
              {enCours === 'payee' ? 'Enregistrement…' : 'Émettre et marquer payée'}
            </button>

            <button
              type="button"
              onClick={() => enregistrer('brouillon')}
              disabled={enCours !== null || selection.size === 0}
              className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold opacity-70 transition hover:bg-black/[0.05] hover:opacity-100 disabled:opacity-40 dark:hover:bg-white/10"
            >
              <Save className="h-4 w-4" />
              {enCours === 'brouillon' ? 'Enregistrement…' : 'Enregistrer en brouillon'}
            </button>

            <p className="text-xs opacity-55">
              Un brouillon réserve les colis mais reste modifiable et n&apos;est pas visible du marchand.
              L&apos;émission fige les montants ; le règlement génère l&apos;écriture comptable.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
