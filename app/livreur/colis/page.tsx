'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, CalendarClock, CheckCircle2, DoorOpen, Phone, TriangleAlert, X, XCircle } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { readImageAsCompressedDataUrl } from '@/lib/read-file';
import { MOTIFS_ANNULATION_LIVREUR, MOTIFS_REPORT_LIVREUR, type ActionLivreur } from '@/lib/types';
import { CATALOGUE_STATUTS_PRESTATAIRE, colisResteALivrer } from '@/lib/statuts';
import { SignaturePad } from '@/components/livreur/SignaturePad';
import { StatutBadge } from '@/components/StatutBadge';
import { P } from '@/components/dashboard/composition';
import s from '@/components/admin/CompositionTableau.module.css';
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
  dateCreation: string;
  notes: string | null;
  ouvrir: boolean;
  fragile: boolean;
  aRemplacer: boolean;
  produitDescription: string | null;
  marchandise?: { nom: string } | null;
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
  bonsConfies: { id: string; numero: string; statut: string; dateReception: string | null; nbColis: number }[];
  colis: ColisFeuilleDeRoute[];
  // Colis d'un bon composé pour ce transporteur mais pas encore remis.
  colisEnAttenteRemise: ColisFeuilleDeRoute[];
  // § Saisie des statuts : coupée par le back-office pour ce transporteur.
  saisieStatutsActive: boolean;
  recap: {
    nbColis: number;
    nbLivres: number;
    nbEnCours: number;
    nbARetourner: number;
    cashEncaisse: string;
    codAttendu: string;
    nbEnAttenteRemise: number;
    codEnAttenteRemise: string;
  };
}

type Vue = 'a_livrer' | 'attente' | 'traites';

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
  // null = onglet choisi automatiquement selon ce qu'il y a à faire.
  const [vueChoisie, setVueChoisie] = useState<Vue | null>(null);

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

  // Ce qui reste à faire dépend de la provenance (§ colisResteALivrer) : en
  // tournée, seul un colis en distribution ; confié à un transporteur, tout
  // colis non clos et pas parti en retour — la société peut redéclarer un
  // report, exactement comme l'autorise la garde côté serveur.
  const resteAFaire = colisResteALivrer;

  const aTenter = feuille?.colis.filter(resteAFaire) ?? [];
  const traites = feuille?.colis.filter((c) => !resteAFaire(c)) ?? [];
  const enAttente = feuille?.colisEnAttenteRemise ?? [];
  // L'onglet ouvert par défaut est celui où il y a du travail.
  const vue: Vue = vueChoisie ?? (aTenter.length === 0 && enAttente.length > 0 ? 'attente' : 'a_livrer');
  const visibles = vue === 'a_livrer' ? aTenter : vue === 'attente' ? enAttente : traites;
  const peutTraiter = vue === 'a_livrer' && (feuille?.saisieStatutsActive ?? true);

  return (
    <>
      {/* Composition des écrans de travail du back-office (§ /admin/bon-envoi) :
          mêmes cadrans, mêmes onglets ; le tableau est celui de la liste des
          colis admin (§ /admin/commandes). */}
      <main className={s.main}>
        <header className={s.entete}>
          <div>
            <h1 className={s.titre}>Mes colis</h1>
            {/* Deux provenances possibles, et le sous-titre doit nommer la
                bonne : une tournée pour un livreur interne, un bon d'envoi
                pour une société de livraison à qui on a confié des colis. */}
            <p style={{ fontSize: 13, color: '#6B6B66', marginTop: 4 }}>
              {feuille && (feuille.tournees.length > 0 || feuille.bonsConfies.length > 0)
                ? [
                    ...feuille.tournees.map((t) => `${t.numero} (${t.hubNom})`),
                    ...feuille.bonsConfies.map((b) =>
                      b.statut === 'recu'
                        ? `${b.numero} (${b.nbColis} colis confiés)`
                        : `${b.numero} (${b.nbColis} colis en attente de remise)`
                    ),
                  ].join(' · ')
                : 'Aucun colis à livrer pour le moment.'}
            </p>
          </div>
        </header>

        {erreur && <p style={{ fontSize: 13, fontWeight: 600, color: '#E56A00' }}>{erreur}</p>}

        {feuille && (
          <section className={`${s.card} ${s.kpiRow}`}>
            <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#FFE14D 0%, #FFC400 55%, #FFB701 100%)', color: P.navy }}>
              <span className={s.kpiLabel}>À livrer</span>
              <span className={s.kpiValeur}>{feuille.recap.nbEnCours}</span>
              <span className={s.kpiNote}>COD à encaisser : {feuille.recap.codAttendu} DH</span>
            </div>
            <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#8ECAE6,#209EBB)', color: P.navy }}>
              <span className={s.kpiLabel}>En attente de remise</span>
              <span className={s.kpiValeur}>{feuille.recap.nbEnAttenteRemise}</span>
              <span className={s.kpiNote}>COD attendu : {feuille.recap.codEnAttenteRemise} DH</span>
            </div>
            <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#209EBB,#023047)', color: '#FFF' }}>
              <span className={s.kpiLabel} style={{ color: P.jaune }}>Livrés</span>
              <span className={s.kpiValeur}>{feuille.recap.nbLivres}</span>
              <span className={s.kpiNote}>Cash encaissé : {feuille.recap.cashEncaisse} DH</span>
            </div>
            <div className={s.kpi} style={{ background: 'linear-gradient(135deg,#023047,#4A4A45)', color: '#FFF' }}>
              <span className={s.kpiLabel}>À retourner</span>
              <span className={s.kpiValeur}>{feuille.recap.nbARetourner}</span>
              <span className={s.kpiNote}>Échecs définitifs</span>
            </div>
          </section>
        )}

        {/* La remise du cash au Planner ne concerne QUE les tournées internes :
            une société de livraison ne rentre pas au dépôt le soir, et lui
            écrire le contraire serait une consigne fausse. */}
        {feuille && feuille.recap.nbLivres > 0 && feuille.tournees.length > 0 && (
          <p style={{ fontSize: 12, color: '#6B6B66' }}>
            Vous remettez l&apos;intégralité du cash encaissé ({feuille.recap.cashEncaisse} DH) au Planner à votre
            retour au dépôt. Vos gains de tournée sont réglés séparément.
          </p>
        )}

        {/* § Saisie des statuts coupée : les colis restent visibles, leurs
            statuts nous arrivent par l'API du transporteur. */}
        {feuille && !feuille.saisieStatutsActive && (
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: P.navy,
              background: '#FFF4CC',
              border: '1px solid #FFE14D',
              borderRadius: 12,
              padding: '10px 14px',
            }}
          >
            La saisie des statuts depuis votre espace est désactivée : vos statuts nous parviennent par votre API. Vous
            pouvez consulter vos colis ; contactez-nous en cas de panne.
          </p>
        )}

        <div className={s.listeTete}>
          <h2 className={s.sectionTitre}>
            {vue === 'a_livrer' ? 'À livrer' : vue === 'attente' ? 'En attente de remise' : 'Déjà traités'}
          </h2>
          <div className={s.onglets} role="tablist">
            {(
              [
                ['a_livrer', `À livrer (${aTenter.length})`],
                ['attente', `En attente de remise (${enAttente.length})`],
                ['traites', `Traités (${traites.length})`],
              ] as [Vue, string][]
            ).map(([cle, libelle]) => (
              <button
                key={cle}
                type="button"
                role="tab"
                aria-selected={vue === cle}
                className={`${s.onglet} ${vue === cle ? s.ongletActif : ''}`}
                onClick={() => setVueChoisie(cle)}
              >
                {libelle}
              </button>
            ))}
          </div>
        </div>

        {/* § Comptes transporteurs : un colis « en attente de remise » est
            visible (la société sait ce qui arrive et le COD en jeu) mais pas
            traitable tant que le bon n'est pas marqué reçu. */}
        {vue === 'attente' && enAttente.length > 0 && (
          <p style={{ fontSize: 12, color: '#6B6B66', marginTop: -8 }}>
            Ces colis vous seront remis prochainement : vous pourrez les traiter dès que leur bon sera marqué reçu.
          </p>
        )}

        <div className="table-card">
          <div className="overflow-x-auto">
            <table className="table-basic min-w-[1300px]">
              <thead>
                <tr>
                  <th>Code d&apos;envoi</th>
                  <th>Date d&apos;expédition</th>
                  <th>Destinataire</th>
                  <th>Téléphone</th>
                  <th>Nom du magasin</th>
                  <th>Marchandise</th>
                  <th>Ville</th>
                  <th>Adresse</th>
                  <th className="text-right">Prix</th>
                  <th>Bon</th>
                  <th>Status</th>
                  <th>Options</th>
                  <th>Notes</th>
                  {peutTraiter && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-xs font-semibold">{c.codeSuivi}</td>
                    <td className="whitespace-nowrap text-xs opacity-70">{new Date(c.dateCreation).toLocaleString('fr-FR')}</td>
                    <td>{c.clientNom}</td>
                    <td className="whitespace-nowrap">
                      <a href={`tel:${c.clientTelephone}`} className="inline-flex items-center gap-1 hover:underline">
                        <Phone className="h-3 w-3" />
                        {c.clientTelephone}
                      </a>
                    </td>
                    <td>{c.marchand?.nomBoutique ?? '—'}</td>
                    <td>{c.marchandise?.nom ?? c.produitDescription ?? <span className="opacity-40">—</span>}</td>
                    <td>{c.ville}</td>
                    <td className="max-w-[200px] truncate text-xs" title={c.adresse}>
                      {c.adresse}
                    </td>
                    <td className="text-right font-semibold tabular-nums">{Number(c.montantCod).toFixed(2)} DH</td>
                    <td className="font-mono text-xs">{c.bonEnvoi?.numero ?? c.bonDistribution?.numero ?? '—'}</td>
                    <td>
                      {/* La ville du hub où le colis se trouve, pas le nom du
                          hub de la tournée : le libellé attendu est
                          « Retourné au Hub (Casablanca) ». */}
                      <StatutBadge statut={c.statut} hubVille={c.hubActuel?.ville} />
                      {c.motifRetour && <p className="mt-1 text-xs opacity-60">{c.motifRetour}</p>}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {c.ouvrir && (
                          <span className="badge badge-neutral">
                            <DoorOpen className="h-3 w-3" /> Ouvrir
                          </span>
                        )}
                        {c.fragile && (
                          <span className="badge badge-warn">
                            <TriangleAlert className="h-3 w-3" /> Fragile
                          </span>
                        )}
                        {c.aRemplacer && <span className="badge badge-brand">Échange</span>}
                      </div>
                    </td>
                    <td className="max-w-[160px] truncate text-xs opacity-70" title={c.notes ?? undefined}>
                      {c.notes ?? '—'}
                    </td>
                    {peutTraiter && (
                      <td>
                        <button type="button" className="btn-primary btn-sm" onClick={() => setColisActif(c)}>
                          Traiter
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={peutTraiter ? 14 : 13} className="py-4 text-center opacity-60">
                      {vue === 'a_livrer'
                        ? 'Rien à livrer pour le moment.'
                        : vue === 'attente'
                          ? 'Aucun colis en attente de remise.'
                          : "Aucun colis traité pour l'instant."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Colis confié par bon d'envoi : le transporteur déclare l'un des
          statuts de sa documentation API. Colis de tournée : les 3 actions
          du livreur interne. */}
      {colisActif && colisActif.bonEnvoi && !colisActif.bonDistribution ? (
        <ModaleStatutTransporteur
          colis={colisActif}
          onClose={() => setColisActif(null)}
          onDone={async () => {
            setColisActif(null);
            await rafraichir();
          }}
        />
      ) : (
        colisActif && (
          <ModaleAction
            colis={colisActif}
            onClose={() => setColisActif(null)}
            onDone={async () => {
              setColisActif(null);
              await rafraichir();
            }}
          />
        )
      )}
    </>
  );
}

// § Saisie des statuts par un transporteur (POST
// /api/livreur/colis/[id]/statut-transporteur) : les statuts du catalogue de
// sa documentation API (CATALOGUE_STATUTS_PRESTATAIRE), avec les mêmes
// exigences — date de prochaine tentative pour « Reporté » et « Programmé »,
// note libre de 150 caractères. La preuve de livraison est facultative,
// comme par l'API.
function ModaleStatutTransporteur({
  colis,
  onClose,
  onDone,
}: {
  colis: ColisFeuilleDeRoute;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [statut, setStatut] = useState<string>('');
  const [date, setDate] = useState(isoAujourdhui());
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const choisi = CATALOGUE_STATUTS_PRESTATAIRE.find((x) => x.statut === statut) ?? null;
  const pretAEnvoyer = Boolean(choisi) && (!choisi?.dateRequise || Boolean(date));

  async function choisirPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await readImageAsCompressedDataUrl(file));
    } catch {
      setErreur('Impossible de lire cette photo.');
    }
  }

  async function envoyer() {
    if (!choisi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await apiPost(`/api/livreur/colis/${colis.id}/statut-transporteur`, {
        statut: choisi.statut,
        ...(choisi.dateRequise && { date }),
        ...(note.trim() && { note: note.trim() }),
        ...(choisi.statut === 'livre' && { photoPreuveUrl: photo ?? undefined, signatureUrl: signature ?? undefined }),
      });
      await onDone();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Erreur');
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
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

        <Field label="Nouveau statut">
          <select className="input-basic" value={statut} onChange={(e) => setStatut(e.target.value)} autoFocus>
            <option value="">Choisir un statut…</option>
            {CATALOGUE_STATUTS_PRESTATAIRE.map((x) => (
              <option key={x.statut} value={x.statut}>
                {x.libelle}
                {x.terminal ? ' (clôture le colis)' : ''}
              </option>
            ))}
          </select>
        </Field>
        {choisi && <p className="-mt-2 text-xs opacity-70">{choisi.description}</p>}

        {choisi?.dateRequise && (
          <Field label="Date de la prochaine tentative">
            <input type="date" className="input-basic" value={date} min={isoAujourdhui()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}

        {choisi?.statut === 'livre' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs opacity-70">Preuve facultative : une photo du colis remis ou la signature du client.</p>
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
        )}

        <Field label="Note" optional>
          <textarea
            className="input-basic"
            rows={2}
            maxLength={150}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex. client absent, rappelle demain"
          />
        </Field>

        {choisi?.terminal && (
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            Ce statut clôture le colis : il ne pourra plus être modifié ensuite.
          </p>
        )}

        {erreur && <p className="text-sm font-semibold text-red-600">{erreur}</p>}

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
