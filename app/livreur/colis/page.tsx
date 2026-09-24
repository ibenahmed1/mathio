'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  Camera,
  CalendarClock,
  CheckCircle2,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api-client';
import { readImageAsCompressedDataUrl } from '@/lib/read-file';
import { MOTIFS_ANNULATION_LIVREUR, MOTIFS_REPORT_LIVREUR, type ActionLivreur } from '@/lib/types';
import { STATUTS_TERMINAUX } from '@/lib/statuts';
import type { StatutCommande } from '@/app/generated/prisma/enums';
import { SignaturePad } from '@/components/livreur/SignaturePad';
import { StatutBadge } from '@/components/StatutBadge';
import { KpiCard } from '@/components/KpiCard';
import { Field } from '@/components/form/Field';

interface ColisFeuilleDeRoute {
  id: string;
  codeSuivi: string;
  clientNom: string;
  clientTelephone: string;
  ville: string;
  adresse: string;
  montantCod: string;
  statut: string;
  motifRetour: string | null;
  dateNouvelleLivraison: string | null;
  marchand?: { nomBoutique: string };
  bonDistribution?: { id: string; numero: string; hub?: { nom: string } } | null;
  // § Comptes transporteurs : renseigné à la place de la tournée pour un colis
  // confié par bon d'envoi. C'est lui qui distingue les deux provenances, et
  // donc ce qui reste « à livrer » (voir la partition plus bas).
  bonEnvoi?: { id: string; numero: string; statut: string } | null;
  hubActuel?: { ville: string } | null;
}

interface FeuilleDeRoute {
  tournees: { id: string; numero: string; dateGeneration: string; hubNom: string; nbColis: number }[];
  // § Comptes transporteurs : les bons d'envoi confiés à cette société, quand
  // le compte est celui d'un transporteur. Vide pour un livreur interne.
  bonsConfies: { id: string; numero: string; dateReception: string | null; nbColis: number }[];
  colis: ColisFeuilleDeRoute[];
  recap: { nbColis: number; nbLivres: number; nbEnCours: number; nbARetourner: number; cashEncaisse: string };
}

function isoAujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

// § /livreur/colis : feuille de route du livreur. Les colis y apparaissent
// dès que le Planner ouvre la tournée, et en disparaissent quand il la
// clôture au retour au dépôt — la page ne connaît que les tournées non
// clôturées (GET /api/livreur/tournee), rien n'est jamais supprimé côté
// historique. Le récapitulatif de session (cash brut collecté, colis à
// retourner) est le même décompte que celui affiché au Planner à la clôture.
export default function FeuilleDeRouteLivreurPage() {
  const [feuille, setFeuille] = useState<FeuilleDeRoute | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [colisActif, setColisActif] = useState<ColisFeuilleDeRoute | null>(null);

  const rafraichir = useCallback(async () => {
    try {
      setFeuille(await apiGet<FeuilleDeRoute>('/api/livreur/tournee'));
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => rafraichir());
  }, [rafraichir]);

  // Ce qui reste à faire ne se lit pas au même statut selon la provenance :
  //
  //   TOURNÉE — un seul statut compte, `mise_en_distribution`. Un colis
  //     reporté ou refusé pendant la tournée est TRAITÉ : il rentre au dépôt
  //     le soir, et c'est le Planner qui le reprend, pas le livreur.
  //
  //   CONFIÉ — la société garde le colis tant qu'il n'est pas clos. Un report
  //     appelle une nouvelle tentative de SA part, elle doit donc pouvoir le
  //     redéclarer — c'est exactement ce qu'autorise la garde côté serveur
  //     (§ deciderActionColisLivreur), et l'écran doit s'y accorder.
  const resteAFaire = (c: ColisFeuilleDeRoute) =>
    c.bonDistribution
      ? c.statut === 'mise_en_distribution'
      : !STATUTS_TERMINAUX.includes(c.statut as StatutCommande);

  const aTenter = feuille?.colis.filter(resteAFaire) ?? [];
  const traites = feuille?.colis.filter((c) => !resteAFaire(c)) ?? [];

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="page-header">
          <div>
            <h1 className="page-title">Mes colis</h1>
            {/* Deux provenances possibles, et le sous-titre doit nommer la
                bonne : une tournée pour un livreur interne, un bon d'envoi
                pour une société de livraison à qui on a confié des colis. */}
            {feuille && (feuille.tournees.length > 0 || feuille.bonsConfies.length > 0) ? (
              <p className="page-subtitle">
                {[
                  ...feuille.tournees.map((t) => `${t.numero} (${t.hubNom})`),
                  ...feuille.bonsConfies.map((b) => `${b.numero} (${b.nbColis} colis confiés)`),
                ].join(' · ')}
              </p>
            ) : (
              <p className="page-subtitle">Aucun colis à livrer pour le moment.</p>
            )}
          </div>
        </div>

        {erreur && <p className="text-sm font-medium text-red-600">{erreur}</p>}

        {/* Mêmes cartes de KPI que le back-office (§ components/KpiCard.tsx),
            dont la variante « héros » réservée au chiffre principal — ici le
            cash, le seul dont le livreur répond au dépôt. */}
        {feuille && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard icon={Package} label="À livrer" value={String(feuille.recap.nbEnCours)} />
            <KpiCard icon={PackageCheck} label="Livrés" value={String(feuille.recap.nbLivres)} />
            <KpiCard
              icon={Banknote}
              label="Cash encaissé"
              value={`${feuille.recap.cashEncaisse} DH`}
              highlight
            />
            <KpiCard icon={Undo2} label="À retourner" value={String(feuille.recap.nbARetourner)} />
          </div>
        )}

        {/* La remise du cash au Planner ne concerne QUE les tournées internes :
            une société de livraison ne rentre pas au dépôt le soir, et lui
            écrire le contraire serait une consigne fausse. */}
        {feuille && feuille.recap.nbLivres > 0 && feuille.tournees.length > 0 && (
          <p className="text-xs opacity-60">
            Vous remettez l&apos;intégralité du cash encaissé ({feuille.recap.cashEncaisse} DH) au Planner à votre
            retour au dépôt. Vos gains de tournée sont réglés séparément.
          </p>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">À livrer ({aTenter.length})</h2>
          {aTenter.length === 0 ? (
            <div className="table-card">
              <div className="empty-state">Rien à livrer pour le moment.</div>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {aTenter.map((c) => (
                // Carte blanche du back-office (.dashboard-card) et non plus le
                // jaune plein : celui-ci est réservé au KPI « héros » de la
                // rangée du dessus. Répété sur chaque colis, il faisait de la
                // liste un bloc de couleur où plus rien ne ressortait.
                <li key={c.id} className="dashboard-card flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-xs opacity-60">{c.codeSuivi}</span>
                    <span className="font-semibold">{c.clientNom}</span>
                    <span className="flex items-center gap-1 text-xs opacity-70">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {c.ville} — {c.adresse}
                    </span>
                    <a
                      href={`tel:${c.clientTelephone}`}
                      className="flex items-center gap-1 text-xs font-semibold hover:underline pointer-coarse:-mx-2 pointer-coarse:min-h-11 pointer-coarse:gap-1.5 pointer-coarse:px-2 pointer-coarse:text-sm"
                    >
                      <Phone className="h-3 w-3" />
                      {c.clientTelephone}
                    </a>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="whitespace-nowrap font-bold">{Number(c.montantCod).toFixed(2)} DH</span>
                    <button type="button" className="btn-primary" onClick={() => setColisActif(c)}>
                      Traiter
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-60">
            {/* « Sur cette tournée » ne veut rien dire pour une société de
                livraison, qui n'en a pas. */}
            {feuille && feuille.tournees.length === 0 ? 'Déjà traités' : 'Traités sur cette tournée'} (
            {traites.length})
          </h2>
          {/* Cadre de table du back-office : .table-card porte le cadre et les
              coins, .table-scroll le défilement horizontal — une table large
              défile dans son cadre, jamais en poussant la page. */}
          <div className="table-card">
            <div className="table-scroll">
              <table className="table-basic min-w-[560px]">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Client</th>
                    <th>Statut</th>
                    <th className="cell-num">CRBT</th>
                  </tr>
                </thead>
                <tbody>
                  {traites.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono">{c.codeSuivi}</td>
                      <td>
                        <span className="font-semibold">{c.clientNom}</span>
                        <span className="block text-xs opacity-60">{c.ville}</span>
                      </td>
                      <td>
                        {/* La ville du hub où le colis se trouve, pas le nom du
                            hub de la tournée : le libellé attendu est
                            « Retourné au Hub (Casablanca) ». */}
                        <StatutBadge statut={c.statut} hubVille={c.hubActuel?.ville} />
                        {c.motifRetour && <span className="block text-xs opacity-60">{c.motifRetour}</span>}
                      </td>
                      <td className="cell-num font-semibold">{Number(c.montantCod).toFixed(2)} DH</td>
                    </tr>
                  ))}
                  {traites.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="empty-state">Aucun colis traité pour l&apos;instant.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {colisActif && (
        <ModaleAction
          colis={colisActif}
          onClose={() => setColisActif(null)}
          onDone={async () => {
            setColisActif(null);
            await rafraichir();
          }}
        />
      )}
    </>
  );
}

// Les 3 actions terrain (PATCH /api/livreur/colis/[id]/statut) : chacune a
// ses champs obligatoires propres — preuve pour "Livré" (RG-02), motif fermé
// + date pour "Reporté", motif fermé pour "Annulé".
function ModaleAction({
  colis,
  onClose,
  onDone,
}: {
  colis: ColisFeuilleDeRoute;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [action, setAction] = useState<ActionLivreur>('livre');
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [motif, setMotif] = useState('');
  const [dateNouvelleLivraison, setDateNouvelleLivraison] = useState(isoAujourdhui());
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await readImageAsCompressedDataUrl(file));
    } catch {
      setErreur("Impossible de lire cette photo.");
    }
  }

  async function envoyer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const body =
        action === 'livre'
          ? { action, photoPreuveUrl: photo ?? undefined, signatureUrl: signature ?? undefined }
          : action === 'reporte'
            ? { action, motif, dateNouvelleLivraison }
            : { action, motif };
      await apiPatch(`/api/livreur/colis/${colis.id}/statut`, body);
      await onDone();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
      setEnvoi(false);
    }
  }

  const motifs = action === 'reporte' ? MOTIFS_REPORT_LIVREUR : MOTIFS_ANNULATION_LIVREUR;
  const pretAEnvoyer =
    action === 'livre' ? Boolean(photo || signature) : Boolean(motif) && (action !== 'reporte' || Boolean(dateNouvelleLivraison));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      {/* Pas de padding bas sur la feuille : c'est la barre collante du bouton
          Confirmer (plus bas) qui le porte. Un padding bas sur le conteneur
          défilant rendrait `sticky bottom-0` ambigu — selon le moteur, la
          barre collerait au bord ou 20 px au-dessus, laissant le contenu
          défiler dessous. `dvh` : la barre d'adresse mobile ne fait pas
          partie de l'écran visible, avec `vh` le bas de la feuille passait
          dessous. */}
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-2xl bg-white px-5 pt-5 dark:bg-neutral-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{colis.clientNom}</h2>
            <p className="font-mono text-xs opacity-60">{colis.codeSuivi}</p>
            <p className="text-sm font-semibold">{Number(colis.montantCod).toFixed(2)} DH à encaisser</p>
          </div>
          <button type="button" onClick={onClose} className="-m-2 rounded-md p-3 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { cle: 'livre', label: 'Livré', icone: <CheckCircle2 className="h-4 w-4" /> },
              { cle: 'reporte', label: 'Reporté', icone: <CalendarClock className="h-4 w-4" /> },
              { cle: 'annule', label: 'Non livré', icone: <XCircle className="h-4 w-4" /> },
            ] as const
          ).map((o) => (
            <button
              key={o.cle}
              type="button"
              onClick={() => {
                setAction(o.cle);
                setMotif('');
              }}
              className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-semibold transition ${
                action === o.cle
                  ? 'border-transparent bg-brand text-brand-ink'
                  : 'border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10'
              }`}
            >
              {o.icone}
              {o.label}
            </button>
          ))}
        </div>

        {action === 'livre' ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs opacity-70">
              Une preuve est obligatoire : une photo du colis remis, ou la signature du client.
            </p>
            <label className="btn-outline flex cursor-pointer items-center justify-center gap-1.5">
              <Camera className="h-4 w-4" />
              {photo ? 'Reprendre la photo' : 'Prendre une photo'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={choisirPhoto} />
            </label>
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Preuve de livraison" className="max-h-48 w-full rounded-md object-contain" />
            )}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold opacity-70">Signature du client</span>
              <SignaturePad onChange={setSignature} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Motif">
              <select className="input-basic" value={motif} onChange={(e) => setMotif(e.target.value)}>
                <option value="">Choisir un motif…</option>
                {motifs.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            {action === 'reporte' && (
              <Field label="Nouvelle tentative prévue le">
                <input
                  type="date"
                  className="input-basic"
                  value={dateNouvelleLivraison}
                  min={isoAujourdhui()}
                  onChange={(e) => setDateNouvelleLivraison(e.target.value)}
                />
              </Field>
            )}
            <p className="text-xs opacity-60">
              Le colis reste sur votre feuille de route jusqu&apos;à votre retour au dépôt : le Planner le scannera
              pour l&apos;enregistrer comme rentré au hub.
            </p>
          </div>
        )}

        {erreur && <p className="text-sm font-semibold text-red-600">{erreur}</p>}

        {/* Barre collée au bas de la feuille : après la photo (jusqu'à 192 px)
            et la signature, « Confirmer » passait sous le pli et le livreur ne
            voyait plus l'action à faire. Marges négatives calées sur le
            padding horizontal de la feuille (px-5) pour que le fond couvre
            toute la largeur ; le padding bas tient compte de la barre système
            des iPhone. */}
        <div className="sticky bottom-0 -mx-5 border-t border-black/10 bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-neutral-900">
          <button
            type="button"
            onClick={envoyer}
            disabled={!pretAEnvoyer || envoi}
            className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {envoi ? 'Enregistrement…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}
