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
import { LivreurShell } from '@/components/livreur/LivreurShell';
import { SignaturePad } from '@/components/livreur/SignaturePad';
import { StatutBadge } from '@/components/StatutBadge';

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
  hubActuel?: { ville: string } | null;
}

interface FeuilleDeRoute {
  tournees: { id: string; numero: string; dateGeneration: string; hubNom: string; nbColis: number }[];
  colis: ColisFeuilleDeRoute[];
  recap: { nbColis: number; nbLivres: number; nbEnCours: number; nbARetourner: number; cashEncaisse: string };
}

function isoAujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

function Tuile({ icone, libelle, valeur, accent }: { icone: React.ReactNode; libelle: string; valeur: string; accent?: string }) {
  return (
    <div className="card-tint-strong flex flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-xs font-semibold opacity-60">
        {icone}
        {libelle}
      </span>
      <span className={`text-2xl font-bold ${accent ?? ''}`}>{valeur}</span>
    </div>
  );
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

  const aTenter = feuille?.colis.filter((c) => c.statut === 'mise_en_distribution') ?? [];
  const traites = feuille?.colis.filter((c) => c.statut !== 'mise_en_distribution') ?? [];

  return (
    <LivreurShell>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="page-title">Mes colis</h1>
          {feuille && feuille.tournees.length > 0 ? (
            <p className="text-sm opacity-70">
              {feuille.tournees.map((t) => `${t.numero} (${t.hubNom})`).join(' · ')}
            </p>
          ) : (
            <p className="text-sm opacity-70">Aucune tournée ouverte.</p>
          )}
        </div>

        {erreur && <p className="text-sm font-medium text-red-600">{erreur}</p>}

        {feuille && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tuile icone={<Package className="h-3.5 w-3.5" />} libelle="À livrer" valeur={String(feuille.recap.nbEnCours)} />
            <Tuile
              icone={<PackageCheck className="h-3.5 w-3.5" />}
              libelle="Livrés"
              valeur={String(feuille.recap.nbLivres)}
              accent="text-green-700"
            />
            <Tuile
              icone={<Banknote className="h-3.5 w-3.5" />}
              libelle="Cash encaissé"
              valeur={`${feuille.recap.cashEncaisse} DH`}
            />
            <Tuile
              icone={<Undo2 className="h-3.5 w-3.5" />}
              libelle="À retourner"
              valeur={String(feuille.recap.nbARetourner)}
              accent={feuille.recap.nbARetourner > 0 ? 'text-orange-600' : undefined}
            />
          </div>
        )}

        {feuille && feuille.recap.nbLivres > 0 && (
          <p className="text-xs opacity-60">
            Vous remettez l&apos;intégralité du cash encaissé ({feuille.recap.cashEncaisse} DH) au Planner à votre
            retour au dépôt. Vos gains de tournée sont réglés séparément.
          </p>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold">À livrer ({aTenter.length})</h2>
          {aTenter.length === 0 ? (
            <p className="text-sm opacity-60">Rien à livrer pour le moment.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {aTenter.map((c) => (
                <li key={c.id} className="card-tint-strong flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-xs opacity-60">{c.codeSuivi}</span>
                    <span className="font-semibold">{c.clientNom}</span>
                    <span className="flex items-center gap-1 text-xs opacity-70">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {c.ville} — {c.adresse}
                    </span>
                    <a href={`tel:${c.clientTelephone}`} className="flex items-center gap-1 text-xs font-semibold hover:underline">
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
          <h2 className="text-sm font-bold">Traités sur cette tournée ({traites.length})</h2>
          {traites.length === 0 ? (
            <p className="text-sm opacity-60">Aucun colis traité pour l&apos;instant.</p>
          ) : (
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
                      <td className="text-right font-semibold">{Number(c.montantCod).toFixed(2)} DH</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
    </LivreurShell>
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
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-neutral-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{colis.clientNom}</h2>
            <p className="font-mono text-xs opacity-60">{colis.codeSuivi}</p>
            <p className="text-sm font-semibold">{Number(colis.montantCod).toFixed(2)} DH à encaisser</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Fermer">
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
            <label className="flex flex-col gap-1 text-xs font-semibold opacity-70">
              Motif
              <select className="input-basic" value={motif} onChange={(e) => setMotif(e.target.value)}>
                <option value="">Choisir un motif…</option>
                {motifs.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {action === 'reporte' && (
              <label className="flex flex-col gap-1 text-xs font-semibold opacity-70">
                Nouvelle tentative prévue le
                <input
                  type="date"
                  className="input-basic"
                  value={dateNouvelleLivraison}
                  min={isoAujourdhui()}
                  onChange={(e) => setDateNouvelleLivraison(e.target.value)}
                />
              </label>
            )}
            <p className="text-xs opacity-60">
              Le colis reste sur votre feuille de route jusqu&apos;à votre retour au dépôt : le Planner le scannera
              pour l&apos;enregistrer comme rentré au hub.
            </p>
          </div>
        )}

        {erreur && <p className="text-sm font-semibold text-red-600">{erreur}</p>}

        <button
          type="button"
          onClick={envoyer}
          disabled={!pretAEnvoyer || envoi}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {envoi ? 'Enregistrement…' : 'Confirmer'}
        </button>
      </div>
    </div>
  );
}
