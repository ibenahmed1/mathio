'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Banknote, CheckCircle2, ChevronLeft, Image as ImageIcon, Lock, PackageCheck, ScanLine, Undo2, Wallet } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { BilanTournee, ColisTournee } from '@/lib/types';
import { QrScanner } from '@/components/QrScanner';
import { StatutBadge } from '@/components/StatutBadge';
import { PreuveLivraison } from '@/components/PreuveLivraison';
import { Affix, Field } from '@/components/form/Field';

type Toast = { type: 'success' | 'error'; text: string } | null;

function dh(valeur: number | string) {
  return `${Number(valeur).toFixed(2)} DH`;
}

function LigneColis({
  colis,
  montrerMotif,
  preuve,
}: {
  colis: ColisTournee;
  montrerMotif?: boolean;
  // Rendu seulement pour les colis livrés : la preuve justifie le CRBT que le
  // Planner s'apprête à encaisser.
  preuve?: React.ReactNode;
}) {
  return (
    <tr>
      <td className="font-mono">{colis.codeSuivi}</td>
      <td>
        <span className="font-semibold">{colis.clientNom}</span>
        <span className="block text-xs opacity-60">{colis.ville}</span>
      </td>
      <td>
        <StatutBadge statut={colis.statut} hubVille={colis.hubActuel?.ville} />
        {montrerMotif && colis.motifRetour && <span className="block text-xs opacity-60">{colis.motifRetour}</span>}
        {/* Colis jamais qualifié par le livreur : le scanner ne consigne pas
            une tentative de livraison, il tranche à sa place — le Planner doit
            le voir avant de scanner, pas seulement après. */}
        {montrerMotif && colis.statut === 'mise_en_distribution' && (
          <span className="block text-xs font-semibold text-orange-600">
            Non qualifié par le livreur — le scan vaudra réintégration par dérogation
          </span>
        )}
      </td>
      <td className="text-right font-semibold">{dh(colis.montantCod)}</td>
      {preuve !== undefined && <td>{preuve}</td>}
    </tr>
  );
}

// Preuve chargée à la demande (une data URL pèse plusieurs centaines de Ko :
// hors de question de les embarquer toutes dans le bilan, qui se rafraîchit à
// chaque scan de retour).
function CellulePreuve({ bonId, commandeId }: { bonId: string; commandeId: string }) {
  const [preuve, setPreuve] = useState<{ photoPreuveUrl: string | null; signatureUrl: string | null; dateLivraison: string | null } | null>(
    null
  );
  const [chargement, setChargement] = useState(false);

  if (preuve) {
    return (
      <PreuveLivraison
        photoPreuveUrl={preuve.photoPreuveUrl}
        signatureUrl={preuve.signatureUrl}
        dateLivraison={preuve.dateLivraison}
        compact
      />
    );
  }

  return (
    <button
      type="button"
      disabled={chargement}
      onClick={async () => {
        setChargement(true);
        try {
          setPreuve(await apiGet(`/api/bons-distribution/${bonId}/preuve?commandeId=${commandeId}`));
        } finally {
          setChargement(false);
        }
      }}
      className="flex items-center gap-1 text-xs font-semibold hover:underline disabled:opacity-50"
    >
      <ImageIcon className="h-3.5 w-3.5" />
      {chargement ? 'Chargement…' : 'Voir la preuve'}
    </button>
  );
}

// § Clôture de tournée (déchargement au retour au Hub) : l'écran du Planner
// présente les deux volets décrits par la règle métier, strictement séparés —
//   A. Caisse : le livreur remet 100 % du CRBT des colis livrés, sans aucune
//      déduction ; la fermeture est bloquée si le cash compté est inférieur.
//   B. Gains livreur : calculés et crédités à son solde à payer, réglés par
//      un processus comptable distinct — jamais soustraits de la caisse.
// Le scan des retours doit être terminé (aucun colis "dehors") avant que le
// bouton de clôture ne s'active.

export function ClotureTournee() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [bilan, setBilan] = useState<BilanTournee | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [scanActif, setScanActif] = useState(false);
  const [scanEnCours, setScanEnCours] = useState(false);
  const [saisieCode, setSaisieCode] = useState('');
  const [montantRemis, setMontantRemis] = useState('');
  const [cloture, setCloture] = useState(false);

  const rafraichir = useCallback(async () => {
    try {
      const data = await apiGet<BilanTournee>(`/api/bons-distribution/${params.id}/bilan`);
      setBilan(data);
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setChargement(false);
    }
  }, [params.id]);

  useEffect(() => {
    Promise.resolve().then(() => rafraichir());
  }, [rafraichir]);

  // Pré-remplit le champ caisse avec le montant attendu : le Planner corrige
  // s'il compte autre chose, mais le cas nominal (montant exact) reste un
  // simple clic.
  useEffect(() => {
    queueMicrotask(() => {
      if (bilan && montantRemis === '') {
        setMontantRemis(bilan.montantCrbtAttendu.toFixed(2));
      }
    });
  }, [bilan, montantRemis]);

  async function scannerRetour(raw: string) {
    if (scanEnCours) return;
    setScanEnCours(true);
    setToast(null);
    try {
      const body = raw.includes('.') ? { qrPayload: raw } : { codeSuivi: raw };
      const res = await apiPost<{
        commande: { codeSuivi: string; clientNom: string };
        dejaScanne: boolean;
        parDerogation: boolean;
      }>(`/api/bons-distribution/${params.id}/scan-retour`, body);
      // La dérogation est annoncée telle quelle : le Planner doit savoir qu'il
      // vient de trancher à la place du livreur, pas croire à un retour
      // qualifié sur le terrain.
      setToast({
        type: 'success',
        text: res.dejaScanne
          ? `Colis ${res.commande.codeSuivi} déjà enregistré au retour.`
          : res.parDerogation
            ? `Colis ${res.commande.codeSuivi} — ${res.commande.clientNom} réintégré par dérogation : le livreur ne l'avait pas qualifié.`
            : `Colis ${res.commande.codeSuivi} — ${res.commande.clientNom} rentré au dépôt.`,
      });
      setSaisieCode('');
      await rafraichir();
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur de scan' });
    } finally {
      setScanEnCours(false);
    }
  }

  async function cloturerTournee() {
    if (!bilan || cloture) return;
    setCloture(true);
    setToast(null);
    try {
      await apiPost(`/api/bons-distribution/${params.id}/cloturer`, { montantRemis: Number(montantRemis) });
      router.push(`/admin/bon-distribution/${params.id}`);
    } catch (err) {
      setToast({ type: 'error', text: err instanceof Error ? err.message : 'Erreur' });
      setCloture(false);
    }
  }

  if (chargement) return <p className="opacity-60">Chargement…</p>;

  if (erreur || !bilan) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/admin/bon-distribution" className="flex items-center gap-1.5 text-sm font-semibold opacity-70 hover:opacity-100">
          <ChevronLeft className="h-4 w-4" />
          Retour aux Bons de Distribution
        </Link>
        <p className="text-sm font-medium text-red-600">{erreur ?? 'Tournée introuvable'}</p>
      </div>
    );
  }

  const dejaCloturee = bilan.statut === 'cloture';
  const montantSaisi = Number(montantRemis);
  const manquant = Number.isFinite(montantSaisi) ? bilan.montantCrbtAttendu - montantSaisi : bilan.montantCrbtAttendu;
  const caisseOk = Number.isFinite(montantSaisi) && manquant <= 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/bon-distribution/${bilan.bonId}`}
          className="flex items-center gap-1.5 text-sm font-semibold opacity-70 transition hover:opacity-100"
        >
          <ChevronLeft className="h-4 w-4" />
          Retour à la tournée {bilan.numero}
        </Link>
      </div>

      <div>
        <h1 className="page-title">Clôture de tournée {bilan.numero}</h1>
        <p className="text-sm opacity-70">
          {bilan.livreur.nomComplet} — Hub {bilan.hub.ville} — {bilan.nbColis} colis sortis
        </p>
      </div>

      {dejaCloturee && (
        <p className="card-tint-strong flex items-center gap-2 p-3 text-sm font-semibold">
          <Lock className="h-4 w-4" />
          Cette tournée est déjà clôturée — l&apos;écran est en lecture seule.
        </p>
      )}

      {toast && (
        <p className={`text-sm font-semibold ${toast.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {toast.text}
        </p>
      )}

      {/* Décompte de tête : ce que le système garantit au Planner avant même
          qu'il ne compte quoi que ce soit. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="card-tint-strong flex flex-col gap-1 p-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold opacity-60">
            <PackageCheck className="h-3.5 w-3.5" />
            Colis livrés
          </span>
          <span className="text-2xl font-bold">{bilan.colisLivres.length}</span>
        </div>
        <div className="card-tint-strong flex flex-col gap-1 p-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold opacity-60">
            <Banknote className="h-3.5 w-3.5" />
            CRBT à remettre
          </span>
          <span className="text-2xl font-bold">{dh(bilan.montantCrbtAttendu)}</span>
        </div>
        <div className="card-tint-strong flex flex-col gap-1 p-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold opacity-60">
            <Undo2 className="h-3.5 w-3.5" />
            Colis à récupérer
          </span>
          <span className={`text-2xl font-bold ${bilan.colisARecuperer.length > 0 ? 'text-orange-600' : ''}`}>
            {bilan.colisARecuperer.length}
          </span>
        </div>
        <div className="card-tint-strong flex flex-col gap-1 p-4">
          <span className="flex items-center gap-1.5 text-xs font-semibold opacity-60">
            <Wallet className="h-3.5 w-3.5" />
            Gains livreur
          </span>
          <span className="text-2xl font-bold">{dh(bilan.gainLivreur)}</span>
        </div>
      </div>

      {/* Réception & scan des retours */}
      {!dejaCloturee && (
        <section className="card-tint-strong flex flex-col gap-4 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <ScanLine className="h-4 w-4" />
            Réception des retours ({bilan.colisRetournes.length}/{bilan.colisRetournes.length + bilan.colisARecuperer.length})
          </h2>
          <p className="text-xs opacity-60">
            Scannez un par un les colis non livrés ramenés par le livreur. Le scan fait passer le colis de son état
            terrain à « Retourné au Hub ({bilan.hub.ville}) » — le motif du livreur est conservé dans
            l&apos;historique. Un colis livré ne peut jamais être scanné ici ; un colis que le livreur n&apos;a pas
            qualifié (« Mise en distribution ») peut l&apos;être par dérogation Planner/Admin, et la réintégration est
            alors tracée comme telle.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <button type="button" onClick={() => setScanActif((v) => !v)} className="btn-outline flex items-center gap-1.5">
              <ScanLine className="h-4 w-4" />
              {scanActif ? 'Fermer la caméra' : 'Scanner au QR'}
            </button>
            <form
              className="flex flex-1 flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (saisieCode.trim()) scannerRetour(saisieCode.trim());
              }}
            >
              <Field label="Saisie manuelle du code de suivi" className="flex-1">
                <input
                  className="input-basic"
                  placeholder="PD-000123"
                  value={saisieCode}
                  onChange={(e) => setSaisieCode(e.target.value)}
                  disabled={scanEnCours}
                />
              </Field>
              <button type="submit" className="btn-primary" disabled={scanEnCours || !saisieCode.trim()}>
                Enregistrer le retour
              </button>
            </form>
          </div>

          {scanActif && <QrScanner active={scanActif} disabled={scanEnCours} onScan={(raw) => scannerRetour(raw)} />}

          {bilan.colisARecuperer.length > 0 ? (
            <div className="overflow-x-auto">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-orange-600">
                <AlertTriangle className="h-4 w-4" />
                {bilan.colisARecuperer.length} colis encore dehors — à scanner avant clôture
              </p>
              <table className="table-basic min-w-[560px]">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Client</th>
                    <th>État terrain</th>
                    <th className="text-right">CRBT</th>
                  </tr>
                </thead>
                <tbody>
                  {bilan.colisARecuperer.map((c) => (
                    <LigneColis key={c.id} colis={c} montrerMotif />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Tous les colis non livrés ont été récupérés au dépôt.
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Volet A — Caisse */}
        <section className="card-tint-strong flex flex-col gap-4 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Banknote className="h-4 w-4" />
            Volet caisse — remise d&apos;argent
          </h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span>Nombre de colis livrés</span>
              <span className="font-semibold">{bilan.colisLivres.length}</span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>Montant total encaissé (CRBT)</span>
              <span className="font-bold">{dh(bilan.montantCrbtAttendu)}</span>
            </li>
          </ul>

          {dejaCloturee ? (
            <p className="text-sm opacity-70">Reddition enregistrée à la clôture de la tournée.</p>
          ) : (
            <>
              <Field label="Montant physique reçu par le Planner">
                <Affix suffix="DH">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    className="input-bare"
                    value={montantRemis}
                    onChange={(e) => setMontantRemis(e.target.value)}
                  />
                </Affix>
              </Field>
              <p className={`text-sm font-semibold ${caisseOk ? 'text-green-700' : 'text-red-600'}`}>
                {caisseOk
                  ? manquant < 0
                    ? `Excédent de caisse : ${dh(-manquant)}`
                    : 'Écart de caisse : 0.00 DH'
                  : `Manquant de caisse : ${dh(manquant)} — la fermeture est bloquée.`}
              </p>
              <p className="text-xs opacity-60">
                Le livreur remet l&apos;intégralité du cash collecté. Aucune déduction n&apos;est faite ici : sa
                rémunération est réglée séparément.
              </p>
            </>
          )}
        </section>

        {/* Volet B — Gains livreur */}
        <section className="card-tint-strong flex flex-col gap-4 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Wallet className="h-4 w-4" />
            Volet gains livreur — enregistrement séparé
          </h2>
          <table className="table-basic">
            <thead>
              <tr>
                <th>Ligne</th>
                <th className="text-right">Nb</th>
                <th className="text-right">Tarif</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {bilan.detailGain.map((l) => (
                <tr key={l.libelle}>
                  <td>{l.libelle}</td>
                  <td className="text-right">{l.nb}</td>
                  <td className="text-right">{dh(l.tarifMoyen)}</td>
                  <td className="text-right font-semibold">{dh(l.total)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="font-bold">
                  Ajouté au solde à payer
                </td>
                <td className="text-right font-bold">{dh(bilan.gainLivreur)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs opacity-60">
            Tarifs résolus par ville (barème du livreur), avec repli sur ses frais par défaut. Ce montant ne touche pas
            la caisse ci-contre : il alimente son solde à payer pour le prochain règlement.
          </p>
        </section>
      </div>

      {!dejaCloturee && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!bilan.pretACloturer && (
            <span className="text-sm font-semibold text-orange-600">
              Scannez les {bilan.colisARecuperer.length} colis restants pour débloquer la clôture.
            </span>
          )}
          <button
            type="button"
            onClick={cloturerTournee}
            disabled={!bilan.pretACloturer || !caisseOk || cloture}
            className="btn-primary flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            {cloture ? 'Clôture…' : 'Encaisser & clôturer la tournée'}
          </button>
        </div>
      )}

      {/* Détail des colis livrés — justificatif du montant attendu. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">Colis livrés ({bilan.colisLivres.length})</h2>
        <div className="overflow-x-auto">
          <table className="table-basic min-w-[680px]">
            <thead>
              <tr>
                <th>Code</th>
                <th>Client</th>
                <th>Statut</th>
                <th className="text-right">CRBT</th>
                <th>Preuve</th>
              </tr>
            </thead>
            <tbody>
              {bilan.colisLivres.map((c) => (
                <LigneColis key={c.id} colis={c} preuve={<CellulePreuve bonId={bilan.bonId} commandeId={c.id} />} />
              ))}
              {bilan.colisLivres.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center opacity-60">
                    Aucun colis livré sur cette tournée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {bilan.colisRetournes.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold">Colis rentrés au dépôt ({bilan.colisRetournes.length})</h2>
          <div className="overflow-x-auto">
            <table className="table-basic min-w-[560px]">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Client</th>
                  <th>Statut</th>
                  <th className="text-right">CRBT</th>
                </tr>
              </thead>
              <tbody>
                {bilan.colisRetournes.map((c) => (
                  <LigneColis key={c.id} colis={c} montrerMotif />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
