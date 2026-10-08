'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CopyPlus,
  FileDown,
  FilePlus2,
  Info,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DEVISES,
  ENTREES_DEFAUT,
  LIBELLES_DEVISE,
  LIBELLES_VERDICT,
  SEUILS_VERDICT,
  TAUX_DEFAUT,
  courbeProfit,
  cplMarketing,
  normaliserEntrees,
  normaliserNomSimulation,
  normaliserTaux,
  parametres,
  simuler,
  verdict,
  type Devise,
  type EntreesSimulation,
  type Resultats,
  type StatutVerdict,
  type TauxChange,
  type Verdict,
} from '@/lib/simulateur-rentabilite';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { SimulationEnregistree } from '@/lib/simulations-rentabilite';
import ComparaisonSimulations, { MAX_COMPARES } from './ComparaisonSimulations';
import { compact, formateurMonnaie, nombre, pourcent, ratio } from './format';
import s from './Simulateur.module.css';

// § Simulateur de rentabilité COD — l'écran, commun à /admin/simulateur et
// /marchand/simulateur. Tout est calculé dans le navigateur
// (lib/simulateur-rentabilite.ts).
//
// Deux mémoires, à ne pas confondre :
//  - la saisie EN COURS est gardée dans le navigateur (localStorage), pour
//    la retrouver après un rechargement — une commodité ;
//  - les scénarios ENREGISTRÉS vivent en base (/api/simulations), partagés
//    par l'équipe de la boutique, et alimentent l'onglet « Comparer ».

const CLE_STOCKAGE = 'simulateur-rentabilite:v1';
const CLE_SELECTION = 'simulateur-rentabilite:comparaison';

interface Etat {
  nomProduit: string;
  entrees: EntreesSimulation;
  taux: TauxChange;
  // Scénario enregistré dont la saisie est issue ; `null` = brouillon.
  simulationId: string | null;
}

const ETAT_DEFAUT: Etat = {
  nomProduit: '',
  entrees: ENTREES_DEFAUT,
  taux: TAUX_DEFAUT,
  simulationId: null,
};

// Empreinte comparable d'une saisie : sert à savoir si l'écran diffère du
// scénario enregistré. Les deux côtés passent par la même normalisation,
// donc par le même ordre de clés.
function empreinte(nom: string, entrees: EntreesSimulation, taux: TauxChange): string {
  return JSON.stringify([normaliserNomSimulation(nom) ?? '', normaliserEntrees(entrees), normaliserTaux(taux)]);
}

function messageErreur(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return 'Le serveur n’a pas répondu. Réessayez.';
}

const dateCourte = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

function lireEtat(): Etat {
  try {
    const brut = window.localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return ETAT_DEFAUT;
    const lu = JSON.parse(brut) as Partial<Etat>;
    // Fusion avec les défauts : un champ ajouté depuis la dernière visite ne
    // doit pas arriver `undefined` dans le calcul.
    return {
      nomProduit: typeof lu.nomProduit === 'string' ? lu.nomProduit : '',
      entrees: normaliserEntrees(lu.entrees),
      taux: normaliserTaux(lu.taux),
      simulationId: typeof lu.simulationId === 'string' ? lu.simulationId : null,
    };
  } catch {
    return ETAT_DEFAUT;
  }
}

// --- Champs ------------------------------------------------------------------

// Champ numérique qui tolère la saisie en cours (« 2, », champ vidé) : la
// valeur affichée est une chaîne locale, le nombre n'est remonté que s'il est
// lisible. Accepte la virgule décimale, comme on l'écrit en français.
function ChampNombre({
  label,
  valeur,
  onChange,
  suffixe,
  devise,
  onDevise,
  pas = 'any',
  aide,
  className,
}: {
  label: string;
  valeur: number;
  onChange: (n: number) => void;
  suffixe?: string;
  devise?: Devise;
  onDevise?: (d: Devise) => void;
  pas?: string;
  aide?: string;
  className?: string;
}) {
  const [texte, setTexte] = useState(String(valeur));
  const [valeurVue, setValeurVue] = useState(valeur);
  // Resynchronise quand la valeur change d'ailleurs (réinitialisation,
  // stockage relu), sans écraser une saisie équivalente en cours (« 2, »).
  // Ajustement pendant le rendu plutôt qu'un effet : pas de rendu en cascade.
  if (valeurVue !== valeur) {
    setValeurVue(valeur);
    if (Number(texte.replace(',', '.')) !== valeur) setTexte(String(valeur));
  }

  return (
    <label className={`${s.field} ${className ?? ''}`}>
      <span className={s.label}>{label}</span>
      <span className={s.inputWrap}>
        <input
          className={s.input}
          inputMode="decimal"
          step={pas}
          value={texte}
          onChange={(e) => {
            setTexte(e.target.value);
            const n = Number(e.target.value.replace(',', '.'));
            if (e.target.value.trim() === '') onChange(0);
            else if (Number.isFinite(n)) onChange(n);
          }}
        />
        {onDevise && devise ? (
          <select
            className={s.suffixSelect}
            value={devise}
            onChange={(e) => onDevise(e.target.value as Devise)}
            aria-label={`Devise — ${label}`}
          >
            {DEVISES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        ) : (
          suffixe && <span className={s.suffix}>{suffixe}</span>
        )}
      </span>
      {aide && <span className={s.hint}>{aide}</span>}
    </label>
  );
}

function Segments<T extends string>({
  valeur,
  options,
  onChange,
  label,
}: {
  valeur: T;
  options: { valeur: T; libelle: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={s.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.valeur}
          type="button"
          role="radio"
          aria-checked={valeur === o.valeur}
          className={`${s.segment} ${valeur === o.valeur ? s.segmentOn : ''}`}
          onClick={() => onChange(o.valeur)}
        >
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

function Carte({
  lettre,
  titre,
  action,
  children,
}: {
  lettre?: string;
  titre: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}>
          {lettre && <span className={s.badge}>{lettre}</span>}
          {titre}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// --- Verdict -----------------------------------------------------------------

const ICONES_VERDICT: Record<StatutVerdict, typeof CheckCircle2> = {
  viable: CheckCircle2,
  risque_logistique: AlertTriangle,
  marge_incoherente: XCircle,
};

// « prix de vente, budget publicitaire et coût par prospect »
function enumerer(mots: string[]): string {
  return mots.length <= 1 ? (mots[0] ?? '') : `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

function BandeauVerdict({ v, manquants }: { v: Verdict | null; manquants: string[] }) {
  if (!v) {
    return (
      <div className={`${s.verdict} ${s.neutre}`} role="status">
        <Info size={22} />
        <div>
          <p className={s.verdictTitle}>En attente de données</p>
          <p className={s.hint}>
            Renseignez {enumerer(manquants)} pour lancer le calcul. Le bouton « Réinitialiser » recharge un exemple
            complet.
          </p>
        </div>
      </div>
    );
  }
  const Icone = ICONES_VERDICT[v.statut];
  return (
    <div className={`${s.verdict} ${s[v.statut]}`} role="status">
      <Icone size={22} />
      <div>
        <p className={s.verdictTitle}>{LIBELLES_VERDICT[v.statut]}</p>
        <ul className={s.verdictReasons}>
          {v.raisons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- Écran -------------------------------------------------------------------

export default function SimulateurRentabilite() {
  const [etat, setEtat] = useState<Etat>(ETAT_DEFAUT);
  const [charge, setCharge] = useState(false);
  // Taux de livraison du stress-test, en points. `null` = suit la saisie.
  const [stress, setStress] = useState<number | null>(null);
  const [voirTaux, setVoirTaux] = useState(false);
  const [onglet, setOnglet] = useState<'simuler' | 'comparer'>('simuler');
  const [simulations, setSimulations] = useState<SimulationEnregistree[]>([]);
  const [chargementListe, setChargementListe] = useState(true);
  const [selection, setSelection] = useState<string[]>([]);
  const [enregistrement, setEnregistrement] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'erreur'; texte: string } | null>(null);
  const champNom = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  // Relu après le montage, jamais au premier rendu : le serveur ne voit pas le
  // stockage du navigateur, et l'hydratation doit partir du même état.
  // Différé d'un tour de boucle comme les autres écrans
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    Promise.resolve().then(() => {
      setEtat(lireEtat());
      try {
        const lue: unknown = JSON.parse(window.localStorage.getItem(CLE_SELECTION) ?? '[]');
        if (Array.isArray(lue)) setSelection(lue.filter((x): x is string => typeof x === 'string'));
      } catch {
        // Sélection illisible : on repart d'une comparaison vide.
      }
      setCharge(true);
    });
    apiGet<{ data: SimulationEnregistree[] }>('/api/simulations')
      .then((r) => setSimulations(r.data))
      .catch((err) => setMessage({ type: 'erreur', texte: messageErreur(err) }))
      .finally(() => setChargementListe(false));
  }, []);

  useEffect(() => {
    if (!charge) return;
    try {
      window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat));
      window.localStorage.setItem(CLE_SELECTION, JSON.stringify(selection));
    } catch {
      // Stockage indisponible (navigateur privé, quota) : sans conséquence.
    }
  }, [etat, selection, charge]);

  // La sélection ne garde que des scénarios qui existent encore (supprimés
  // par un collègue, par exemple) — sauf pendant le premier chargement.
  const selectionValide = chargementListe
    ? selection
    : selection.filter((id) => simulations.some((sim) => sim.id === id)).slice(0, MAX_COMPARES);

  const courante = simulations.find((sim) => sim.id === etat.simulationId) ?? null;
  const modifiee =
    !courante ||
    empreinte(courante.nom, courante.entrees, courante.taux) !== empreinte(etat.nomProduit, etat.entrees, etat.taux);

  function confirmerAbandon(): boolean {
    // Un brouillon resté aux valeurs d'exemple n'a rien à perdre.
    const brouillonVide =
      !etat.simulationId &&
      empreinte(etat.nomProduit, etat.entrees, etat.taux) === empreinte('', ENTREES_DEFAUT, TAUX_DEFAUT);
    if (!modifiee || brouillonVide) return true;
    return window.confirm('Les modifications non enregistrées de cette simulation seront perdues. Continuer ?');
  }

  async function enregistrer(commeNouvelle: boolean) {
    const nom = normaliserNomSimulation(etat.nomProduit);
    if (!nom) {
      setMessage({ type: 'erreur', texte: 'Donnez un nom au produit avant d’enregistrer.' });
      champNom.current?.focus();
      return;
    }
    setEnregistrement(true);
    setMessage(null);
    try {
      const corps = { nom, entrees: etat.entrees, taux: etat.taux };
      const misAJour = !!courante && !commeNouvelle;
      const sim = misAJour
        ? await apiPatch<SimulationEnregistree>(`/api/simulations/${courante.id}`, corps)
        : await apiPost<SimulationEnregistree>('/api/simulations', corps);
      setSimulations((liste) => [sim, ...liste.filter((x) => x.id !== sim.id)]);
      setEtat((x) => ({ ...x, nomProduit: sim.nom, simulationId: sim.id }));
      setMessage({
        type: 'ok',
        texte: misAJour ? `« ${sim.nom} » mise à jour.` : `« ${sim.nom} » enregistrée.`,
      });
    } catch (err) {
      setMessage({ type: 'erreur', texte: messageErreur(err) });
    } finally {
      setEnregistrement(false);
    }
  }

  function ouvrir(id: string) {
    const sim = simulations.find((x) => x.id === id);
    if (!sim || !confirmerAbandon()) return;
    setEtat({ nomProduit: sim.nom, entrees: sim.entrees, taux: sim.taux, simulationId: sim.id });
    setStress(null);
    setMessage(null);
    setOnglet('simuler');
    if (menu.current) menu.current.open = false;
  }

  async function supprimer(id: string) {
    const sim = simulations.find((x) => x.id === id);
    if (!sim || !window.confirm(`Supprimer définitivement « ${sim.nom} » ? Toute l’équipe la perdra.`)) return;
    try {
      await apiDelete(`/api/simulations/${id}`);
      setSimulations((liste) => liste.filter((x) => x.id !== id));
      setSelection((sel) => sel.filter((x) => x !== id));
      // La saisie à l'écran reste : elle redevient un brouillon.
      if (etat.simulationId === id) setEtat((x) => ({ ...x, simulationId: null }));
      setMessage({ type: 'ok', texte: `« ${sim.nom} » supprimée.` });
    } catch (err) {
      setMessage({ type: 'erreur', texte: messageErreur(err) });
    }
  }

  const { entrees: e, taux } = etat;
  const maj = <K extends keyof EntreesSimulation>(cle: K, v: EntreesSimulation[K]) =>
    setEtat((x) => ({ ...x, entrees: { ...x.entrees, [cle]: v } }));
  const majTaux = (d: Devise, v: number) => setEtat((x) => ({ ...x, taux: { ...x.taux, [d]: v } }));

  const monnaie = useMemo(() => formateurMonnaie(e.deviseVente), [e.deviseVente]);
  const monnaieMkt = useMemo(() => formateurMonnaie(e.deviseMarketing), [e.deviseMarketing]);

  const p = useMemo(() => parametres(e, taux), [e, taux]);
  const r = useMemo(() => simuler(p), [p]);
  const v = r.complet ? verdict(p, r) : null;

  const pAcompte = useMemo(() => parametres(e, taux, { avecAcompte: true }), [e, taux]);
  const rAcompte = useMemo(() => (e.acompteActif ? simuler(pAcompte) : null), [e.acompteActif, pAcompte]);

  const tauxStress = stress ?? Math.round(e.tauxLivraison);
  const rStress = useMemo(() => simuler({ ...p, tauxLivraison: tauxStress / 100 }), [p, tauxStress]);
  const courbe = useMemo(() => courbeProfit(p, 20, 100, 1), [p]);
  // Domaine de l'axe Y : il contient toujours zéro (la ligne de flottaison
  // du profit), et une courbe PLATE — 0 % de confirmation, par exemple —
  // reçoit une marge, faute de quoi recharts répète la même graduation.
  const domaineY = useMemo<[number, number]>(() => {
    const valeurs = courbe.map((pt) => pt.profit);
    let min = Math.min(0, ...valeurs);
    let max = Math.max(0, ...valeurs);
    if (max - min < 1e-6) {
      min -= 1;
      max += 1;
    }
    const marge = (max - min) * 0.08;
    return [min < 0 ? min - marge : 0, max > 0 ? max + marge : 0];
  }, [courbe]);

  const cplSaisi = cplMarketing(e);

  function nouvelleSimulation() {
    if (!confirmerAbandon()) return;
    setEtat(ETAT_DEFAUT);
    setStress(null);
    setMessage(null);
  }

  // Le coût produit est le seul poste qui ne se lit pas tout seul : il ne
  // compte pas tous les colis expédiés. On montre donc d'où vient le montant,
  // et ce que deviennent les retours intacts.
  const detailProduit =
    `${nombre(r.livrees, 1)} livrés + ${nombre(r.retoursPerdus, 1)} retours invendables, ` +
    `× ${monnaie(p.coutUnitaire)} l’unité. Les ${nombre(r.retoursRemisEnStock, 1)} retours intacts ` +
    `réintègrent le stock : aucun coût produit ne leur est imputé.`;
  const couts: { libelle: string; valeur: number; detail?: string }[] = [
    { libelle: 'Publicité', valeur: r.couts.publicite },
    { libelle: 'Produits (livrés + retours invendables)', valeur: r.couts.produit, detail: detailProduit },
    { libelle: 'Livraisons réussies', valeur: r.couts.livraison },
    { libelle: 'Frais de retour', valeur: r.couts.retour },
    { libelle: 'Call center', valeur: r.couts.callCenter },
    { libelle: 'Emballage & préparation', valeur: r.couts.emballage },
  ];
  const maxCout = Math.max(...couts.map((c) => c.valeur), 1);
  const signe = (n: number) => (n >= 0 ? s.pos : s.neg);

  return (
    <div className={s.root}>
      {/* La fiche imprimée remplace tout l'écran à l'impression : la règle
          vit ici, hors du module CSS, parce qu'elle doit masquer la coquille
          (barre latérale, en-têtes) qui n'appartient pas à ce composant. */}
      <style media="print">{`
        @page { margin: 14mm; }
        body * { visibility: hidden !important; }
        .${s.fiche}, .${s.fiche} * { visibility: visible !important; }
        .${s.fiche} { display: block !important; position: absolute; inset: 0 auto auto 0; width: 100%; color: #14171c; background: #fff; font-family: var(--font-app); }
      `}</style>

      <header className={s.head}>
        <div>
          <h1 className={s.title}>Simulateur de rentabilité</h1>
          <p className={s.subtitle}>
            Du budget publicitaire au profit net, en passant par la confirmation et la livraison : testez un produit
            avant de le lancer en paiement à la livraison.
          </p>
        </div>
      </header>

      <div className={s.toolbar}>
        <div className={s.tabs} role="tablist" aria-label="Vue">
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'simuler'}
            className={`${s.tab} ${onglet === 'simuler' ? s.tabOn : ''}`}
            onClick={() => setOnglet('simuler')}
          >
            Simulateur
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'comparer'}
            className={`${s.tab} ${onglet === 'comparer' ? s.tabOn : ''}`}
            onClick={() => setOnglet('comparer')}
          >
            Comparer
            <span className={s.compteur}>{simulations.length}</span>
          </button>
        </div>

        {onglet === 'simuler' && (
          <div className={s.saveBar}>
            <span className={s.saveStatus} aria-live="polite">
              {courante ? (
                <>
                  <strong>{courante.nom}</strong> ·{' '}
                  {modifiee ? <span className={s.dirty}>modifications non enregistrées</span> : 'enregistrée'}
                </>
              ) : (
                'Brouillon non enregistré'
              )}
            </span>
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={() => enregistrer(false)}
              disabled={enregistrement || (!!courante && !modifiee)}
            >
              <Save size={16} /> {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {courante && (
              <button type="button" className={s.btn} onClick={() => enregistrer(true)} disabled={enregistrement}>
                <CopyPlus size={16} /> Enregistrer comme nouvelle
              </button>
            )}
            <button type="button" className={s.btn} onClick={nouvelleSimulation}>
              <FilePlus2 size={16} /> Nouvelle
            </button>
            <details className={s.menu} ref={menu}>
              <summary className={s.btn}>
                Mes simulations <ChevronDown size={16} />
              </summary>
              <div className={s.menuPanel}>
                {chargementListe ? (
                  <p className={s.hint} style={{ padding: 8 }}>
                    Chargement…
                  </p>
                ) : simulations.length === 0 ? (
                  <p className={s.hint} style={{ padding: 8 }}>
                    Aucune simulation enregistrée pour l’instant.
                  </p>
                ) : (
                  simulations.map((sim) => (
                    <div
                      key={sim.id}
                      className={`${s.menuItem} ${sim.id === etat.simulationId ? s.menuItemCourant : ''}`}
                    >
                      <button type="button" className={s.menuItemTexte} onClick={() => ouvrir(sim.id)}>
                        <span className={s.menuItemNom}>{sim.nom}</span>
                        <span className={s.menuItemMeta}>
                          {dateCourte.format(new Date(sim.dateModification))}
                          {sim.auteur ? ` · ${sim.auteur}` : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`${s.iconBtn} ${s.iconBtnDanger}`}
                        onClick={() => supprimer(sim.id)}
                        title="Supprimer"
                      >
                        <Trash2 size={15} />
                        <span className={s.srOnly}>Supprimer {sim.nom}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </details>
            <button type="button" className={s.btn} onClick={() => window.print()}>
              <FileDown size={16} /> Fiche PDF
            </button>
          </div>
        )}
      </div>

      {message && (
        <p className={`${s.message} ${message.type === 'erreur' ? s.messageErreur : s.messageOk}`} role="status">
          {message.texte}
        </p>
      )}

      {onglet === 'comparer' ? (
        <ComparaisonSimulations
          simulations={simulations}
          selection={selectionValide}
          onSelection={setSelection}
          onOuvrir={ouvrir}
          chargement={chargementListe}
        />
      ) : (
        <div className={s.grid}>
          {/* ---------------- Saisie ---------------- */}
          <div className={s.col}>
            <Carte titre="Produit & devises">
              <div className={s.fields}>
                <label className={`${s.field} ${s.full}`}>
                  <span className={s.label}>Nom du produit</span>
                  <span className={s.inputWrap}>
                    <input
                      ref={champNom}
                      maxLength={120}
                      className={s.input}
                      value={etat.nomProduit}
                      placeholder="Ex. : Montre connectée X8"
                      onChange={(ev) => setEtat((x) => ({ ...x, nomProduit: ev.target.value }))}
                    />
                  </span>
                </label>
                <label className={`${s.field} ${s.full}`}>
                  <span className={s.label}>Devise de vente</span>
                  <span className={s.inputWrap}>
                    <select
                      className={s.select}
                      value={e.deviseVente}
                      onChange={(ev) => maj('deviseVente', ev.target.value as Devise)}
                    >
                      {DEVISES.map((d) => (
                        <option key={d} value={d}>
                          {LIBELLES_DEVISE[d]}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className={s.hint}>Prix, frais d’opérations et résultats sont exprimés dans cette devise.</span>
                </label>
              </div>
            </Carte>

            <Carte lettre="A" titre="Produit & approvisionnement">
              <div className={s.fields}>
                <ChampNombre
                  label="Prix d’achat unitaire (COGS)"
                  valeur={e.prixAchat}
                  onChange={(n) => maj('prixAchat', n)}
                  devise={e.deviseAchat}
                  onDevise={(d) => maj('deviseAchat', d)}
                />
                <ChampNombre
                  label="Transit / douane / inbound (par unité)"
                  valeur={e.fraisApproche}
                  onChange={(n) => maj('fraisApproche', n)}
                  devise={e.deviseApproche}
                  onDevise={(d) => maj('deviseApproche', d)}
                />
                <ChampNombre
                  label="Prix de vente catalogue"
                  valeur={e.prixVente}
                  onChange={(n) => maj('prixVente', n)}
                  suffixe={e.deviseVente}
                />
                <div className={`${s.field} ${s.derive}`}>
                  Coût de revient rendu stock : <strong>{monnaie(p.coutUnitaire)}</strong>
                </div>
              </div>
            </Carte>

            <Carte
              lettre="B"
              titre="Marketing & acquisition"
              action={
                <Segments
                  label="Mode de saisie du coût par prospect"
                  valeur={e.modeCpl}
                  onChange={(m) => maj('modeCpl', m)}
                  options={[
                    { valeur: 'direct', libelle: 'CPL' },
                    { valeur: 'avance', libelle: 'CPM / CTR' },
                  ]}
                />
              }
            >
              <div className={s.fields}>
                <ChampNombre
                  label="Budget publicitaire total"
                  valeur={e.budgetPub}
                  onChange={(n) => maj('budgetPub', n)}
                  devise={e.deviseMarketing}
                  onDevise={(d) => maj('deviseMarketing', d)}
                />
                {e.modeCpl === 'direct' ? (
                  <ChampNombre
                    label="Coût par prospect (CPL)"
                    valeur={e.cpl}
                    onChange={(n) => maj('cpl', n)}
                    suffixe={e.deviseMarketing}
                  />
                ) : (
                  <>
                    <ChampNombre
                      label="CPM (1 000 impressions)"
                      valeur={e.cpm}
                      onChange={(n) => maj('cpm', n)}
                      suffixe={e.deviseMarketing}
                    />
                    <ChampNombre
                      label="Taux de clic (CTR)"
                      valeur={e.ctr}
                      onChange={(n) => maj('ctr', n)}
                      suffixe="%"
                    />
                    <ChampNombre
                      label="Conversion page → prospect"
                      valeur={e.tauxConversionPage}
                      onChange={(n) => maj('tauxConversionPage', n)}
                      suffixe="%"
                    />
                    <div className={`${s.field} ${s.derive}`}>
                      CPL déduit : <strong>{cplSaisi > 0 ? monnaieMkt(cplSaisi) : '—'}</strong>
                    </div>
                  </>
                )}
              </div>
            </Carte>

            <Carte lettre="C" titre="Opérations COD">
              <div className={s.fields}>
                <ChampNombre
                  label="Taux de confirmation"
                  valeur={e.tauxConfirmation}
                  onChange={(n) => maj('tauxConfirmation', n)}
                  suffixe="%"
                  aide="Prospects qui confirment au téléphone."
                />
                <ChampNombre
                  label="Emballage & préparation (par colis)"
                  valeur={e.fraisEmballage}
                  onChange={(n) => maj('fraisEmballage', n)}
                  suffixe={e.deviseVente}
                />
                <ChampNombre
                  label="Coût du call center"
                  valeur={e.coutCallCenter}
                  onChange={(n) => maj('coutCallCenter', n)}
                  suffixe={e.deviseVente}
                />
                <div className={s.field}>
                  <span className={s.label}>Facturé par</span>
                  <Segments
                    label="Base de facturation du call center"
                    valeur={e.baseCallCenter}
                    onChange={(b) => maj('baseCallCenter', b)}
                    options={[
                      { valeur: 'confirmee', libelle: 'Commande confirmée' },
                      { valeur: 'prospect', libelle: 'Appel (prospect)' },
                    ]}
                  />
                </div>
              </div>
            </Carte>

            <Carte lettre="D" titre="Logistique & dernier kilomètre">
              <div className={s.fields}>
                <ChampNombre
                  label="Taux de livraison"
                  valeur={e.tauxLivraison}
                  onChange={(n) => {
                    maj('tauxLivraison', n);
                    setStress(null);
                  }}
                  suffixe="%"
                  aide="Commandes confirmées réellement livrées et encaissées."
                />
                <ChampNombre
                  label="Tarif de livraison réussie"
                  valeur={e.fraisLivraison}
                  onChange={(n) => maj('fraisLivraison', n)}
                  suffixe={e.deviseVente}
                />
                <ChampNombre
                  label="Frais de retour / refus"
                  valeur={e.fraisRetour}
                  onChange={(n) => maj('fraisRetour', n)}
                  suffixe={e.deviseVente}
                />
                <ChampNombre
                  label="Retours invendables"
                  valeur={e.tauxPerteRetours}
                  onChange={(n) => maj('tauxPerteRetours', n)}
                  suffixe="%"
                  aide="Colis revenus abîmés ou perdus : leur coût produit est imputé. Les autres retournent en stock, sans coût."
                />
              </div>
            </Carte>

            <Carte
              titre="Acompte à la commande"
              action={
                <label className={s.toggle}>
                  <input
                    type="checkbox"
                    checked={e.acompteActif}
                    onChange={(ev) => maj('acompteActif', ev.target.checked)}
                  />
                  Simuler
                </label>
              }
            >
              {e.acompteActif ? (
                <div className={s.fields}>
                  <ChampNombre
                    label="Montant de l’acompte"
                    valeur={e.montantAcompte}
                    onChange={(n) => maj('montantAcompte', n)}
                    suffixe={e.deviseVente}
                    className={s.full}
                    aide="Gardé si le client refuse le colis ; déduit du prix s’il est livré."
                  />
                  <ChampNombre
                    label="Confirmation avec acompte"
                    valeur={e.tauxConfirmationAcompte}
                    onChange={(n) => maj('tauxConfirmationAcompte', n)}
                    suffixe="%"
                    aide="Une partie des prospects renonce à payer d’avance."
                  />
                  <ChampNombre
                    label="Livraison avec acompte"
                    valeur={e.tauxLivraisonAcompte}
                    onChange={(n) => maj('tauxLivraisonAcompte', n)}
                    suffixe="%"
                    aide="Ceux qui ont payé refusent beaucoup moins."
                  />
                </div>
              ) : (
                <p className={s.hint}>
                  Comparez votre scénario à une variante où le client verse une avance (ex. 20 DH) : moins de
                  confirmations, mais moins de refus.
                </p>
              )}
            </Carte>

            <section className={s.card}>
              <details className={s.fold} open={voirTaux} onToggle={(ev) => setVoirTaux(ev.currentTarget.open)}>
                <summary>
                  Taux de change <span className={s.hint}>{voirTaux ? 'Masquer' : 'Ajuster'}</span>
                </summary>
                <p className={s.hint} style={{ marginBottom: 10 }}>
                  Valeur d’une unité en dirhams. Taux indicatifs, à remplacer par le cours du jour : seuls SAR, AED
                  (ancrés au dollar) et XOF (ancré à l’euro) sont fixes.
                </p>
                <div className={s.rates}>
                  {DEVISES.filter((d) => d !== 'MAD').map((d) => (
                    <ChampNombre
                      key={d}
                      label={`1 ${d} =`}
                      valeur={taux[d]}
                      onChange={(n) => majTaux(d, n)}
                      suffixe="MAD"
                    />
                  ))}
                </div>
              </details>
            </section>
          </div>

          {/* ---------------- Résultats ---------------- */}
          <div className={`${s.col} ${s.sticky}`}>
            <BandeauVerdict v={v} manquants={r.manquants} />

            {!r.complet ? (
              <EtatIncomplet />
            ) : (
              <>
                <div className={s.kpis}>
                  <div className={`${s.kpi} ${s.kpiHero}`}>
                    <div className={s.kpiLabel}>Profit net</div>
                    <div className={`${s.kpiValue} ${signe(r.profit)}`}>{monnaie(r.profit)}</div>
                    <div className={s.kpiSub}>
                      {r.profitParLivree !== null ? `${monnaie(r.profitParLivree)} par commande livrée` : '—'}
                    </div>
                  </div>
                  <div className={s.kpi}>
                    <div className={s.kpiLabel}>Marge nette</div>
                    <div className={`${s.kpiValue} ${signe(r.profit)}`}>{pourcent(r.margeNette)}</div>
                  </div>
                  <div className={s.kpi}>
                    <div className={s.kpiLabel}>CA encaissé</div>
                    <div className={s.kpiValue}>{monnaie(r.ca)}</div>
                    {r.acomptesRetenus > 0 && (
                      <div className={s.kpiSub}>dont {monnaie(r.acomptesRetenus)} d’acomptes</div>
                    )}
                  </div>
                  <div className={s.kpi}>
                    <div className={s.kpiLabel}>CAC réel</div>
                    <div className={s.kpiValue}>{monnaie(r.cacReel)}</div>
                    <div className={s.kpiSub}>pub ÷ commandes livrées</div>
                  </div>
                  <div className={s.kpi}>
                    <div className={s.kpiLabel}>ROAS</div>
                    <div className={s.kpiValue}>{ratio(r.roas)}</div>
                    <div className={s.kpiSub}>
                      seuil : {r.roasSeuil === null ? 'inatteignable' : ratio(r.roasSeuil)}
                    </div>
                  </div>
                </div>

                <Carte titre="Seuils de rentabilité">
                  <div className={s.seuils}>
                    <div className={s.seuil}>
                      <div className={s.kpiLabel}>Break-even ROAS</div>
                      <div className={s.seuilValue}>{r.roasSeuil === null ? 'Aucun' : ratio(r.roasSeuil)}</div>
                      <p className={s.hint}>CA ÷ budget pub sous lequel on perd de l’argent.</p>
                    </div>
                    <div className={s.seuil}>
                      <div className={s.kpiLabel}>CPL maximal</div>
                      <div className={s.seuilValue}>{r.cplMax === null ? 'Aucun' : monnaie(r.cplMax)}</div>
                      <p className={s.hint}>Vous payez {p.cpl > 0 ? monnaie(p.cpl) : '—'} par prospect.</p>
                    </div>
                    <div className={s.seuil}>
                      <div className={s.kpiLabel}>Livraison minimale</div>
                      <div className={s.seuilValue}>
                        {r.tauxLivraisonSeuil === null ? '> 100 %' : pourcent(r.tauxLivraisonSeuil)}
                      </div>
                      <p className={s.hint}>Taux de livraison sous lequel le produit passe à perte.</p>
                    </div>
                  </div>
                </Carte>

                <Carte titre="Stress-test : et si la livraison chutait ?">
                  <div className={s.stressHead}>
                    <div>
                      <div className={s.kpiLabel}>Taux de livraison testé</div>
                      <div className={s.stressValue}>{tauxStress} %</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className={s.kpiLabel}>Profit à ce taux</div>
                      <div className={`${s.stressValue} ${signe(rStress.profit)}`}>{monnaie(rStress.profit)}</div>
                      <div className={`${s.delta} ${signe(rStress.profit - r.profit)}`}>
                        {rStress.profit - r.profit >= 0 ? '+' : ''}
                        {monnaie(rStress.profit - r.profit)} vs {nombre(e.tauxLivraison, 1)} %
                      </div>
                    </div>
                  </div>
                  <input
                    type="range"
                    className={s.slider}
                    min={20}
                    max={100}
                    step={1}
                    value={tauxStress}
                    onChange={(ev) => setStress(Number(ev.target.value))}
                    aria-label="Taux de livraison testé"
                  />
                  <div className={s.chart}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={courbe} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                        <CartesianGrid stroke="var(--sim-line)" strokeDasharray="0" vertical={false} />
                        <XAxis
                          dataKey="taux"
                          type="number"
                          domain={[20, 100]}
                          ticks={[20, 40, 60, 80, 100]}
                          tickFormatter={(t: number) => `${t} %`}
                          tick={{ fill: 'var(--sim-muted)', fontSize: 11 }}
                          axisLine={{ stroke: 'var(--sim-line)' }}
                          tickLine={false}
                        />
                        <YAxis
                          domain={domaineY}
                          allowDataOverflow={false}
                          tickCount={5}
                          tickFormatter={(n: number) => compact(n)}
                          tick={{ fill: 'var(--sim-muted)', fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          width={48}
                        />
                        <ReferenceLine y={0} stroke="var(--sim-muted)" />
                        {r.tauxLivraisonSeuil !== null && r.tauxLivraisonSeuil * 100 >= 20 && (
                          <ReferenceLine
                            x={r.tauxLivraisonSeuil * 100}
                            stroke="var(--sim-bad)"
                            strokeDasharray="4 4"
                            label={{
                              value: 'seuil',
                              position: 'insideTopRight',
                              fill: 'var(--sim-bad)',
                              fontSize: 11,
                            }}
                          />
                        )}
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const pt = payload[0].payload as {
                              taux: number;
                              profit: number;
                            };
                            return (
                              <div className={s.tooltip}>
                                {pt.taux} % livrés → <strong>{monnaie(pt.profit)}</strong>
                              </div>
                            );
                          }}
                        />
                        <Line
                          type="linear"
                          dataKey="profit"
                          stroke="var(--sim-serie)"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <ReferenceDot
                          x={tauxStress}
                          y={rStress.profit}
                          r={5}
                          fill="var(--sim-serie)"
                          stroke="var(--sim-card)"
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Carte>

                <Carte titre="Entonnoir de commandes">
                  <Entonnoir r={r} />
                </Carte>

                <Carte titre="Où part l’argent">
                  <div className={s.costs}>
                    {couts.map((c) => (
                      <div key={c.libelle} className={s.costRow}>
                        <span>{c.libelle}</span>
                        <span className={s.num}>{monnaie(c.valeur)}</span>
                        <span className={s.costPct}>{r.ca > 0 ? pourcent(c.valeur / r.ca, 0) : '—'}</span>
                        {c.detail && <span className={s.costDetail}>{c.detail}</span>}
                        <div className={s.costBar}>
                          <div className={s.costFill} style={{ width: `${(c.valeur / maxCout) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                    <div className={`${s.costRow} ${s.costTotal}`}>
                      <span>Coûts totaux</span>
                      <span className={s.num}>{monnaie(r.coutsTotal)}</span>
                      <span className={s.costPct}>{r.ca > 0 ? pourcent(r.coutsTotal / r.ca, 0) : '—'}</span>
                    </div>
                  </div>
                  <p className={s.hint} style={{ marginTop: 8 }}>
                    Pourcentages exprimés par rapport au CA encaissé.
                    {r.couts.produitPerdu > 0 &&
                      ` Dont ${monnaie(r.couts.produitPerdu)} de marchandise invendable sur les retours.`}
                  </p>
                </Carte>

                {rAcompte && (
                  <Carte titre="Avec ou sans acompte">
                    <ComparaisonAcompte sans={r} avec={rAcompte} monnaie={monnaie} />
                  </Carte>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <FicheImpression
        nomProduit={etat.nomProduit}
        e={e}
        r={r}
        v={v}
        rAcompte={rAcompte}
        coutUnitaire={p.coutUnitaire}
        cpl={p.cpl}
        monnaie={monnaie}
      />
    </div>
  );
}

// Tant qu'une saisie indispensable manque, AUCUN chiffre : un budget
// dépensé sans prospect afficherait une perte égale au budget, qui n'est
// qu'un artefact de saisie. La grille garde sa forme pour que l'écran ne
// saute pas quand le calcul démarre.
function EtatIncomplet() {
  const tuiles = ['Marge nette', 'CA encaissé', 'CAC réel', 'ROAS'];
  return (
    <>
      <div className={s.kpis}>
        <div className={`${s.kpi} ${s.kpiHero}`}>
          <div className={s.kpiLabel}>Profit net</div>
          <div className={`${s.kpiValue} ${s.vide}`}>—</div>
        </div>
        {tuiles.map((t) => (
          <div key={t} className={s.kpi}>
            <div className={s.kpiLabel}>{t}</div>
            <div className={`${s.kpiValue} ${s.vide}`}>—</div>
          </div>
        ))}
      </div>
      <Carte titre="Stress-test : et si la livraison chutait ?">
        <div className={s.chartVide}>
          <p>Remplissez le formulaire pour générer la courbe de rentabilité.</p>
        </div>
      </Carte>
    </>
  );
}

function Entonnoir({ r }: { r: Resultats }) {
  const max = Math.max(r.prospects, 1);
  const lignes = [
    { libelle: 'Prospects', valeur: r.prospects, attenue: false },
    { libelle: 'Confirmées', valeur: r.confirmees, attenue: false },
    { libelle: 'Livrées', valeur: r.livrees, attenue: false },
    { libelle: 'Retournées', valeur: r.retournees, attenue: true },
  ];
  return (
    <div className={s.funnel}>
      {lignes.map((l) => (
        <div key={l.libelle} className={s.funnelRow}>
          <span>{l.libelle}</span>
          <div className={s.funnelBar}>
            <div
              className={`${s.funnelFill} ${l.attenue ? s.funnelFillMuted : ''}`}
              style={{ width: `${(l.valeur / max) * 100}%` }}
            />
          </div>
          <span className={s.num}>{nombre(l.valeur)}</span>
        </div>
      ))}
    </div>
  );
}

function ComparaisonAcompte({
  sans,
  avec,
  monnaie,
}: {
  sans: Resultats;
  avec: Resultats;
  monnaie: (n: number | null) => string;
}) {
  const lignes: { libelle: string; a: string; b: string }[] = [
    {
      libelle: 'Commandes confirmées',
      a: nombre(sans.confirmees),
      b: nombre(avec.confirmees),
    },
    {
      libelle: 'Commandes livrées',
      a: nombre(sans.livrees),
      b: nombre(avec.livrees),
    },
    {
      libelle: 'Retours',
      a: nombre(sans.retournees),
      b: nombre(avec.retournees),
    },
    { libelle: 'Acomptes gardés', a: '—', b: monnaie(avec.acomptesRetenus) },
    { libelle: 'CA encaissé', a: monnaie(sans.ca), b: monnaie(avec.ca) },
    {
      libelle: 'Frais de retour',
      a: monnaie(sans.couts.retour),
      b: monnaie(avec.couts.retour),
    },
    { libelle: 'Profit net', a: monnaie(sans.profit), b: monnaie(avec.profit) },
    {
      libelle: 'Marge nette',
      a: pourcent(sans.margeNette),
      b: pourcent(avec.margeNette),
    },
  ];
  const ecart = avec.profit - sans.profit;
  return (
    <>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th />
              <th>Sans acompte</th>
              <th>Avec acompte</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.libelle}>
                <td>{l.libelle}</td>
                <td>{l.a}</td>
                <td>{l.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.hint} style={{ marginTop: 8 }}>
        À budget égal, l’acompte{' '}
        <strong className={ecart >= 0 ? s.pos : s.neg}>
          {ecart >= 0 ? 'rapporte' : 'coûte'} {monnaie(Math.abs(ecart))}
        </strong>{' '}
        de profit.
      </p>
    </>
  );
}

// Fiche de faisabilité : invisible à l'écran, seule chose imprimée. Le PDF
// est celui du navigateur (« Enregistrer au format PDF ») — pas de
// bibliothèque à embarquer pour une page.
function FicheImpression({
  nomProduit,
  e,
  r,
  v,
  rAcompte,
  coutUnitaire,
  cpl,
  monnaie,
}: {
  nomProduit: string;
  e: EntreesSimulation;
  r: Resultats;
  v: Verdict | null;
  rAcompte: Resultats | null;
  coutUnitaire: number;
  cpl: number;
  monnaie: (n: number | null) => string;
}) {
  const couleur: Record<StatutVerdict, string> = {
    viable: '#157347',
    risque_logistique: '#9a5b00',
    marge_incoherente: '#b42318',
  };
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date());
  const ligne = (libelle: string, valeur: string) => (
    <tr key={libelle}>
      <td>{libelle}</td>
      <td>{valeur}</td>
    </tr>
  );

  return (
    <div className={s.fiche} aria-hidden="true">
      <div className={s.ficheHead}>
        <div>
          <p className={s.ficheMeta}>Fiche de faisabilité produit</p>
          <h2 className={s.ficheTitle}>{nomProduit.trim() || 'Produit sans nom'}</h2>
        </div>
        <div className={s.ficheMeta} style={{ textAlign: 'right' }}>
          {date}
          <br />
          Montants en {e.deviseVente}
        </div>
      </div>

      {!r.complet && (
        <div className={s.ficheVerdict} style={{ color: '#555' }}>
          <strong>Simulation incomplète</strong>
          <p>Il manque : {enumerer(r.manquants)}. Aucun résultat n’est calculé.</p>
        </div>
      )}

      {v && (
        <div className={s.ficheVerdict} style={{ color: couleur[v.statut] }}>
          <strong>{LIBELLES_VERDICT[v.statut]}</strong>
          {v.raisons.map((raison) => (
            <p key={raison}>{raison}</p>
          ))}
        </div>
      )}

      <div className={s.ficheGrid}>
        <div className={s.ficheSection}>
          <h3>Hypothèses</h3>
          <table className={s.ficheTable}>
            <tbody>
              {ligne('Prix de vente', monnaie(e.prixVente))}
              {ligne('Coût de revient rendu stock', monnaie(coutUnitaire))}
              {ligne('Budget publicitaire', monnaie(r.couts.publicite))}
              {ligne('Coût par prospect', monnaie(cpl))}
              {ligne('Taux de confirmation', `${nombre(e.tauxConfirmation, 1)} %`)}
              {ligne('Taux de livraison', `${nombre(e.tauxLivraison, 1)} %`)}
              {ligne(
                `Call center (par ${e.baseCallCenter === 'prospect' ? 'appel' : 'confirmation'})`,
                monnaie(e.coutCallCenter),
              )}
              {ligne('Emballage par colis', monnaie(e.fraisEmballage))}
              {ligne('Livraison réussie', monnaie(e.fraisLivraison))}
              {ligne('Frais de retour', monnaie(e.fraisRetour))}
              {ligne(
                'Retours invendables (le reste retourne en stock, sans coût)',
                `${nombre(e.tauxPerteRetours, 1)} %`,
              )}
            </tbody>
          </table>
        </div>

        {r.complet && (
          <div className={s.ficheSection}>
            <h3>Résultats</h3>
            <table className={s.ficheTable}>
              <tbody>
                {ligne('Prospects', nombre(r.prospects))}
                {ligne('Commandes confirmées', nombre(r.confirmees))}
                {ligne('Commandes livrées', nombre(r.livrees))}
                {ligne('Commandes retournées', nombre(r.retournees))}
                {ligne('  dont remises en stock', nombre(r.retoursRemisEnStock, 1))}
                {ligne('  dont invendables', nombre(r.retoursPerdus, 1))}
                {ligne('Coût produit imputé', monnaie(r.couts.produit))}
                {ligne('CA encaissé', monnaie(r.ca))}
                {ligne('Coûts totaux', monnaie(r.coutsTotal))}
                {ligne('Profit net', monnaie(r.profit))}
                {ligne('Marge nette', pourcent(r.margeNette))}
                {ligne('CAC réel', monnaie(r.cacReel))}
                {ligne('ROAS', ratio(r.roas))}
                {ligne('Break-even ROAS', r.roasSeuil === null ? 'aucun' : ratio(r.roasSeuil))}
                {ligne('CPL maximal', r.cplMax === null ? 'aucun' : monnaie(r.cplMax))}
                {ligne(
                  'Livraison minimale',
                  r.tauxLivraisonSeuil === null ? '> 100 %' : pourcent(r.tauxLivraisonSeuil),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rAcompte && r.complet && (
        <div className={s.ficheSection}>
          <h3>Variante avec acompte de {monnaie(e.montantAcompte)}</h3>
          <table className={s.ficheTable}>
            <tbody>
              {ligne(
                'Confirmation / livraison',
                `${nombre(e.tauxConfirmationAcompte, 1)} % / ${nombre(e.tauxLivraisonAcompte, 1)} %`,
              )}
              {ligne('Profit net', `${monnaie(rAcompte.profit)} (sans acompte : ${monnaie(r.profit)})`)}
              {ligne('Marge nette', pourcent(rAcompte.margeNette))}
            </tbody>
          </table>
        </div>
      )}

      <p className={s.ficheFoot}>
        Simulation indicative. Seuils du verdict : au moins {Math.round(SEUILS_VERDICT.margeSecuriteLivraison * 100)}{' '}
        points de taux de livraison au-dessus du seuil de rentabilité, et une marge nette d’au moins{' '}
        {Math.round(SEUILS_VERDICT.margeNetteMin * 100)} %.
      </p>
    </div>
  );
}
