// § Simulateur de rentabilité COD — moteur de calcul.
//
// Module PUR (aucun import serveur) : il est appelé à chaque frappe par
// l'écran client (components/simulateur/SimulateurRentabilite.tsx), commun à
// /admin/simulateur et /marchand/simulateur, et testé seul
// (lib/__tests__/simulateur-rentabilite.test.ts).
//
// --- La cascade -------------------------------------------------------------
//
//   Prospects  = Budget pub / CPL
//   Confirmées = Prospects × taux de confirmation
//   Livrées    = Confirmées × taux de livraison
//   Retournées = Confirmées − Livrées
//
// Tous les coûts sont PROPORTIONNELS au nombre de prospects (le CPL est
// supposé constant) : on calcule donc d'abord l'économie d'UN prospect, puis
// on la multiplie. C'est ce qui rend les seuils exacts — le ROAS de
// rentabilité ou le CPL maximal ne dépendent pas du budget.
//
// --- Trois écarts assumés avec le cahier des charges ------------------------
//
//  1. Le coût produit ne compte que les unités LIVRÉES, plus la part des
//     retours devenue invendable (taux de perte) : un colis refusé revient au
//     stock, il n'est pas consommé.
//  2. Le ROAS de rentabilité est CA / (CA − coûts hors pub), où les coûts hors
//     pub incluent ceux des commandes QUI ÉCHOUENT (appel, emballage, frais de
//     retour). La formule « prix / (prix − coûts par vente livrée) » du cahier
//     des charges en est le cas particulier où l'on ramène ces coûts à la
//     vente livrée — c'est exactement ce que fait ce calcul.
//  3. L'acompte encaissé sur un colis finalement refusé est GARDÉ par le
//     marchand : il entre dans le CA. Sur un colis livré, il n'est qu'une
//     avance sur le prix et ne change rien.

export const DEVISES = ['MAD', 'SAR', 'AED', 'EUR', 'XOF', 'USD', 'CNY'] as const;
export type Devise = (typeof DEVISES)[number];

export const LIBELLES_DEVISE: Record<Devise, string> = {
  MAD: 'Dirham marocain (MAD)',
  SAR: 'Riyal saoudien (SAR)',
  AED: 'Dirham émirien (AED)',
  EUR: 'Euro (EUR)',
  XOF: 'Franc CFA (XOF)',
  USD: 'Dollar US (USD)',
  CNY: 'Yuan / RMB (CNY)',
};

// Valeur en MAD d'UNE unité de chaque devise. Le MAD sert de pivot, rien de
// plus : convertir X → Y vaut taux[X] / taux[Y].
//
// TAUX INDICATIFS, modifiables à l'écran. Seuls trois rapports sont fixes par
// construction (ancrages officiels) : SAR = USD / 3,75, AED = USD / 3,6725,
// XOF = EUR / 655,957. Les cours USD, EUR et CNY contre le dirham flottent :
// les valeurs ci-dessous sont un ordre de grandeur, pas un cours du jour.
const USD_MAD = 9.2;
const EUR_MAD = 10.7;
export const TAUX_DEFAUT: Record<Devise, number> = {
  MAD: 1,
  USD: USD_MAD,
  EUR: EUR_MAD,
  CNY: 1.28,
  SAR: arrondir(USD_MAD / 3.75, 4),
  AED: arrondir(USD_MAD / 3.6725, 4),
  XOF: arrondir(EUR_MAD / 655.957, 6),
};

export type TauxChange = Record<Devise, number>;

export function convertir(montant: number, de: Devise, vers: Devise, taux: TauxChange): number {
  if (de === vers) return montant;
  const source = taux[de];
  const cible = taux[vers];
  if (!(source > 0) || !(cible > 0)) return 0;
  return (montant * source) / cible;
}

// --- Saisie -----------------------------------------------------------------
//
// Les pourcentages sont saisis de 0 à 100, comme à l'écran. Les montants sont
// dans la devise de VENTE, sauf trois blocs qui ont la leur : l'achat, les
// frais d'approche (transit, douane) et le marketing — les régies publicitaires
// facturent souvent en dollars.

export type BaseCallCenter = 'prospect' | 'confirmee';
export type ModeCpl = 'direct' | 'avance';

export interface EntreesSimulation {
  deviseVente: Devise;

  // A. Produit & approvisionnement
  prixAchat: number;
  deviseAchat: Devise;
  fraisApproche: number;
  deviseApproche: Devise;
  prixVente: number;

  // B. Marketing & acquisition
  deviseMarketing: Devise;
  budgetPub: number;
  modeCpl: ModeCpl;
  cpl: number;
  // Mode avancé : CPL = (CPM / 1000) / (CTR × taux de conversion de la page).
  cpm: number;
  ctr: number;
  tauxConversionPage: number;

  // C. Opérations COD
  tauxConfirmation: number;
  baseCallCenter: BaseCallCenter;
  coutCallCenter: number;
  fraisEmballage: number;

  // D. Logistique & dernier kilomètre
  tauxLivraison: number;
  fraisLivraison: number;
  fraisRetour: number;
  // Part des colis retournés qui reviennent invendables (abîmés, perdus).
  tauxPerteRetours: number;

  // Acompte à la commande — un SECOND scénario, comparé au premier.
  acompteActif: boolean;
  montantAcompte: number;
  // Exiger un acompte fait renoncer une partie des prospects (la confirmation
  // baisse) et retient ceux qui ont payé (la livraison monte) : les deux
  // taux sont saisis, pas devinés.
  tauxConfirmationAcompte: number;
  tauxLivraisonAcompte: number;
}

export const ENTREES_DEFAUT: EntreesSimulation = {
  deviseVente: 'MAD',
  prixAchat: 4,
  deviseAchat: 'USD',
  fraisApproche: 1.5,
  deviseApproche: 'USD',
  prixVente: 249,
  deviseMarketing: 'USD',
  budgetPub: 1000,
  modeCpl: 'direct',
  cpl: 2.5,
  cpm: 6,
  ctr: 1.5,
  tauxConversionPage: 15,
  tauxConfirmation: 70,
  baseCallCenter: 'confirmee',
  coutCallCenter: 8,
  fraisEmballage: 5,
  tauxLivraison: 65,
  fraisLivraison: 35,
  fraisRetour: 10,
  tauxPerteRetours: 5,
  acompteActif: false,
  montantAcompte: 20,
  tauxConfirmationAcompte: 55,
  tauxLivraisonAcompte: 85,
};

// --- Paramètres normalisés (devise de vente, taux en fraction) -------------

export interface Parametres {
  prixVente: number;
  coutUnitaire: number;
  budgetPub: number;
  cpl: number;
  tauxConfirmation: number;
  tauxLivraison: number;
  baseCallCenter: BaseCallCenter;
  coutCallCenter: number;
  fraisEmballage: number;
  fraisLivraison: number;
  fraisRetour: number;
  tauxPerteRetours: number;
  acompte: number;
}

function fraction(pourcentage: number): number {
  if (!Number.isFinite(pourcentage)) return 0;
  return Math.min(Math.max(pourcentage, 0), 100) / 100;
}

function positif(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// CPL dans la devise MARKETING. En mode avancé, un CTR ou un taux de
// conversion nul donne un CPL nul — traité plus bas comme « pas de prospect ».
export function cplMarketing(e: EntreesSimulation): number {
  if (e.modeCpl === 'direct') return positif(e.cpl);
  const parClic = fraction(e.ctr) * fraction(e.tauxConversionPage);
  if (parClic <= 0) return 0;
  return positif(e.cpm) / 1000 / parClic;
}

export function parametres(
  e: EntreesSimulation,
  taux: TauxChange,
  { avecAcompte = false }: { avecAcompte?: boolean } = {},
): Parametres {
  const v = e.deviseVente;
  return {
    prixVente: positif(e.prixVente),
    coutUnitaire:
      convertir(positif(e.prixAchat), e.deviseAchat, v, taux) +
      convertir(positif(e.fraisApproche), e.deviseApproche, v, taux),
    budgetPub: convertir(positif(e.budgetPub), e.deviseMarketing, v, taux),
    cpl: convertir(cplMarketing(e), e.deviseMarketing, v, taux),
    tauxConfirmation: fraction(avecAcompte ? e.tauxConfirmationAcompte : e.tauxConfirmation),
    tauxLivraison: fraction(avecAcompte ? e.tauxLivraisonAcompte : e.tauxLivraison),
    baseCallCenter: e.baseCallCenter,
    coutCallCenter: positif(e.coutCallCenter),
    fraisEmballage: positif(e.fraisEmballage),
    fraisLivraison: positif(e.fraisLivraison),
    fraisRetour: positif(e.fraisRetour),
    tauxPerteRetours: fraction(e.tauxPerteRetours),
    // Un acompte supérieur au prix n'a pas de sens : plafonné au prix.
    acompte: avecAcompte ? Math.min(positif(e.montantAcompte), positif(e.prixVente)) : 0,
  };
}

// --- Résultats --------------------------------------------------------------

export interface Couts {
  publicite: number;
  produit: number;
  // Dont : la part du coût produit due aux retours invendables.
  produitPerdu: number;
  callCenter: number;
  emballage: number;
  livraison: number;
  retour: number;
}

export interface Resultats {
  // Saisies indispensables absentes (prix, budget, CPL). Tant que la liste
  // n'est pas vide, la simulation n'a pas de sens : un budget dépensé sans
  // aucun prospect afficherait une perte égale au budget, qui n'est qu'un
  // artefact de saisie. Les ratios et seuils sont alors `null`, et l'écran
  // n'affiche aucun chiffre.
  manquants: string[];
  complet: boolean;

  prospects: number;
  confirmees: number;
  livrees: number;
  retournees: number;

  // CA encaissé = livraisons + acomptes gardés sur les retours.
  ca: number;
  acomptesRetenus: number;

  // Devenir des colis retournés : les invendables (abîmés, perdus) portent un
  // coût produit ; les autres réintègrent le stock et n'en portent AUCUN — ils
  // seront revendus plus tard, leur coût ira à cette vente-là.
  retoursPerdus: number;
  retoursRemisEnStock: number;

  couts: Couts;
  coutsHorsPub: number;
  coutsTotal: number;

  profit: number;
  // `null` quand le dénominateur est nul : un ratio indéfini ne s'affiche pas
  // comme un zéro.
  margeNette: number | null;
  cacReel: number | null;
  roas: number | null;
  profitParLivree: number | null;

  // Seuils. `null` = aucune valeur ne rend le produit rentable.
  roasSeuil: number | null;
  cplMax: number | null;
  tauxLivraisonSeuil: number | null;
}

// Économie d'UN prospect, hors publicité (le CPL la porte à part).
function parProspect(p: Parametres) {
  const confirmees = p.tauxConfirmation;
  const livrees = confirmees * p.tauxLivraison;
  const retournees = confirmees - livrees;
  const perdues = retournees * p.tauxPerteRetours;
  const couts = {
    produit: (livrees + perdues) * p.coutUnitaire,
    produitPerdu: perdues * p.coutUnitaire,
    callCenter: p.coutCallCenter * (p.baseCallCenter === 'prospect' ? 1 : confirmees),
    emballage: confirmees * p.fraisEmballage,
    livraison: livrees * p.fraisLivraison,
    retour: retournees * p.fraisRetour,
  };
  const caLivraisons = livrees * p.prixVente;
  const acomptesRetenus = retournees * p.acompte;
  const horsPub = couts.produit + couts.callCenter + couts.emballage + couts.livraison + couts.retour;
  return {
    confirmees,
    livrees,
    retournees,
    perdues,
    couts,
    ca: caLivraisons + acomptesRetenus,
    acomptesRetenus,
    horsPub,
  };
}

// Marge d'un prospect avant publicité : c'est le CPL qu'on peut se permettre.
function contributionParProspect(p: Parametres): number {
  const u = parProspect(p);
  return u.ca - u.horsPub;
}

export function donneesManquantes(p: Parametres): string[] {
  const manquants: string[] = [];
  if (!(p.prixVente > 0)) manquants.push('prix de vente');
  if (!(p.budgetPub > 0)) manquants.push('budget publicitaire');
  if (!(p.cpl > 0)) manquants.push('coût par prospect');
  return manquants;
}

// Un ratio n'est publié que s'il est un nombre fini : c'est la dernière
// barrière avant l'écran contre un `NaN` ou un `Infinity`.
function fini(n: number | null): number | null {
  return n !== null && Number.isFinite(n) ? n : null;
}

export function simuler(p: Parametres): Resultats {
  const manquants = donneesManquantes(p);
  const complet = manquants.length === 0;
  const prospects = complet ? p.budgetPub / p.cpl : 0;
  const u = parProspect(p);
  const x = (n: number) => n * prospects;

  const couts: Couts = {
    publicite: p.budgetPub,
    produit: x(u.couts.produit),
    produitPerdu: x(u.couts.produitPerdu),
    callCenter: x(u.couts.callCenter),
    emballage: x(u.couts.emballage),
    livraison: x(u.couts.livraison),
    retour: x(u.couts.retour),
  };
  const ca = x(u.ca);
  const coutsHorsPub = x(u.horsPub);
  const coutsTotal = coutsHorsPub + p.budgetPub;
  const profit = ca - coutsTotal;
  const livrees = x(u.livrees);

  // Profit nul ⇔ pub = CA − coûts hors pub ⇔ ROAS = CA / (CA − coûts hors pub).
  // Raisonné par prospect, il ne dépend donc ni du budget ni du CPL.
  const contribution = u.ca - u.horsPub;
  const roasSeuil = contribution > 0 ? u.ca / contribution : null;

  const siComplet = (n: number | null) => (complet ? fini(n) : null);

  return {
    manquants,
    complet,
    prospects,
    confirmees: x(u.confirmees),
    livrees,
    retournees: x(u.retournees),
    ca,
    acomptesRetenus: x(u.acomptesRetenus),
    retoursPerdus: x(u.perdues),
    retoursRemisEnStock: x(u.retournees - u.perdues),
    couts,
    coutsHorsPub,
    coutsTotal,
    profit,
    margeNette: siComplet(ca > 0 ? profit / ca : null),
    cacReel: siComplet(livrees > 0 ? p.budgetPub / livrees : null),
    roas: siComplet(p.budgetPub > 0 ? ca / p.budgetPub : null),
    profitParLivree: siComplet(livrees > 0 ? profit / livrees : null),
    roasSeuil: siComplet(roasSeuil),
    cplMax: siComplet(contribution > 0 ? contribution : null),
    tauxLivraisonSeuil: complet ? tauxLivraisonSeuil(p) : null,
  };
}

// Le profit est AFFINE en fonction du taux de livraison (prospects et
// confirmations n'en dépendent pas) : deux évaluations suffisent à trouver le
// zéro. Renvoie une fraction dans [0, 1], ou `null` si même 100 % de colis
// livrés laissent le produit à perte.
export function tauxLivraisonSeuil(p: Parametres): number | null {
  // Sans CPL, le seuil vaudrait 0 % par construction (aucune dépense à
  // couvrir) : une fausse bonne nouvelle, pas un seuil.
  if (!(p.cpl > 0)) return null;
  const profitA = (t: number) => contributionParProspect({ ...p, tauxLivraison: t }) - p.cpl;
  const p0 = profitA(0);
  const p1 = profitA(1);
  if (p0 >= 0) return 0;
  if (p1 < 0) return null;
  return -p0 / (p1 - p0);
}

// Courbe « profit selon le taux de livraison », pour le stress-test.
export function courbeProfit(p: Parametres, de = 20, a = 100, pas = 1): { taux: number; profit: number }[] {
  const points: { taux: number; profit: number }[] = [];
  for (let t = de; t <= a; t += pas) {
    points.push({ taux: t, profit: simuler({ ...p, tauxLivraison: t / 100 }).profit });
  }
  return points;
}

// --- Verdict ----------------------------------------------------------------
//
// Seuils retenus pour la fiche de faisabilité. Ce sont des CHOIX, pas des
// normes du métier : ils sont affichés à l'écran avec la raison du verdict.
export const SEUILS_VERDICT = {
  // Points de taux de livraison que le produit doit pouvoir perdre en restant
  // rentable. En dessous, une mauvaise semaine de livraison l'emporte.
  margeSecuriteLivraison: 0.1,
  // Marge nette en deçà de laquelle une hausse du CPL efface le profit.
  margeNetteMin: 0.1,
  // Taux de livraison au-delà duquel on considère un seuil hors d'atteinte.
  tauxLivraisonAtteignable: 0.85,
};

export type StatutVerdict = 'viable' | 'risque_logistique' | 'marge_incoherente';

export const LIBELLES_VERDICT: Record<StatutVerdict, string> = {
  viable: 'Produit viable',
  risque_logistique: 'Risque logistique élevé',
  marge_incoherente: 'Marge incohérente',
};

export interface Verdict {
  statut: StatutVerdict;
  raisons: string[];
}

const pct = (f: number) => `${Math.round(f * 100)} %`;

export function verdict(p: Parametres, r: Resultats): Verdict {
  const s = SEUILS_VERDICT;

  if (p.tauxConfirmation <= 0) {
    return {
      statut: 'marge_incoherente',
      raisons: ['Aucune commande confirmée : le budget publicitaire est dépensé sans la moindre vente.'],
    };
  }

  const seuilTl = r.tauxLivraisonSeuil;

  if (r.profit <= 0) {
    // La livraison d'abord : si un taux atteignable suffit à équilibrer, c'est
    // elle qui est en cause, pas le prix — même quand, au taux simulé (0 %
    // par exemple), chaque prospect coûte plus qu'il ne rapporte.
    if (seuilTl !== null && seuilTl <= s.tauxLivraisonAtteignable) {
      return {
        statut: 'risque_logistique',
        raisons: [
          `Le produit ne devient rentable qu’à partir de ${pct(seuilTl)} de livraison ; la simulation est à ${pct(p.tauxLivraison)}.`,
        ],
      };
    }
    const horsAtteinte =
      seuilTl === null
        ? 'Aucun taux de livraison, même 100 %, ne suffit à compenser.'
        : `Il faudrait ${pct(seuilTl)} de livraison pour équilibrer : hors d’atteinte en COD.`;
    if (r.cplMax === null) {
      return {
        statut: 'marge_incoherente',
        raisons: [
          'Même sans aucune dépense publicitaire, chaque prospect coûte plus qu’il ne rapporte : le prix de vente ne couvre pas produit, appel, emballage et livraison.',
          horsAtteinte,
        ],
      };
    }
    return {
      statut: 'marge_incoherente',
      raisons: [
        `Le CPL dépasse ce que la marge permet : il faudrait l’abaisser sous ${r.cplMax.toFixed(2)} (devise de vente).`,
        horsAtteinte,
      ],
    };
  }

  const raisons: string[] = [];
  const securite = seuilTl === null ? 0 : p.tauxLivraison - seuilTl;
  if (securite < s.margeSecuriteLivraison) {
    raisons.push(
      `Rentable, mais une baisse de ${Math.max(0, Math.round(securite * 100))} point(s) du taux de livraison suffit à passer à perte (seuil : ${pct(seuilTl ?? 0)}).`,
    );
    return { statut: 'risque_logistique', raisons };
  }
  if (r.margeNette !== null && r.margeNette < s.margeNetteMin) {
    return {
      statut: 'marge_incoherente',
      raisons: [`Marge nette de ${pct(r.margeNette)} : trop mince pour absorber une hausse du CPL ou des frais.`],
    };
  }
  raisons.push(
    `Marge nette de ${pct(r.margeNette ?? 0)}, rentable jusqu’à ${pct(seuilTl ?? 0)} de livraison (${Math.round(securite * 100)} points de marge de sécurité).`,
  );
  return { statut: 'viable', raisons };
}

function arrondir(n: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

// --- Scénarios enregistrés --------------------------------------------------
//
// Ce que le navigateur envoie, comme ce que la base renvoie d'une version
// antérieure du formulaire, passe par ces deux fonctions : chaque champ
// inconnu est ignoré, chaque champ absent ou illisible reprend sa valeur par
// défaut. Le moteur ne reçoit donc jamais un `undefined` ni une chaîne.

export const NOM_SIMULATION_MAX = 120;

function estDevise(v: unknown): v is Devise {
  return typeof v === 'string' && (DEVISES as readonly string[]).includes(v);
}

export function normaliserEntrees(brut: unknown): EntreesSimulation {
  const src = brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : {};
  const sortie = { ...ENTREES_DEFAUT } as Record<string, unknown>;
  for (const [cle, defaut] of Object.entries(ENTREES_DEFAUT)) {
    const v = src[cle];
    if (typeof defaut === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) sortie[cle] = v;
    } else if (typeof defaut === 'boolean') {
      if (typeof v === 'boolean') sortie[cle] = v;
    } else if (cle.startsWith('devise')) {
      if (estDevise(v)) sortie[cle] = v;
    }
  }
  if (src.modeCpl === 'direct' || src.modeCpl === 'avance') sortie.modeCpl = src.modeCpl;
  if (src.baseCallCenter === 'prospect' || src.baseCallCenter === 'confirmee')
    sortie.baseCallCenter = src.baseCallCenter;
  return sortie as unknown as EntreesSimulation;
}

export function normaliserTaux(brut: unknown): TauxChange {
  const src = brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : {};
  const taux = { ...TAUX_DEFAUT };
  for (const d of DEVISES) {
    const v = src[d];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) taux[d] = v;
  }
  // Le pivot ne se change pas : 1 MAD vaut 1 MAD.
  taux.MAD = 1;
  return taux;
}

export function normaliserNomSimulation(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const nom = brut.replace(/\s+/g, ' ').trim();
  return nom.length > 0 && nom.length <= NOM_SIMULATION_MAX ? nom : null;
}

// --- Comparaison de scénarios ----------------------------------------------

export interface AnalyseScenario {
  parametres: Parametres;
  resultats: Resultats;
  verdict: Verdict | null;
  // Points de taux de livraison que le scénario peut perdre avant de passer
  // à perte (fraction). `null` quand aucun seuil n'existe.
  margeSecuriteLivraison: number | null;
}

export function analyserScenario(entrees: EntreesSimulation, taux: TauxChange): AnalyseScenario {
  const p = parametres(entrees, taux);
  const r = simuler(p);
  return {
    parametres: p,
    resultats: r,
    verdict: r.complet ? verdict(p, r) : null,
    margeSecuriteLivraison: r.tauxLivraisonSeuil === null ? null : p.tauxLivraison - r.tauxLivraisonSeuil,
  };
}

// Podium d'une ligne de comparaison : indice de colonne → 1 (meilleure
// valeur) ou 2 (deuxième valeur DISTINCTE). Les ex aequo partagent leur rang.
//
// Rien n'est classé quand moins de deux valeurs sont comparables, ni quand
// toutes sont égales : souligner un « meilleur » sans écart induirait en
// erreur. La 2e place n'est marquée que s'il reste au moins une valeur moins
// bonne qu'elle — sur deux produits, ou quand les autres sont tous ex aequo
// derrière le premier, « deuxième » voudrait simplement dire « dernier ».
export function podium(valeurs: (number | null)[], sens: 'max' | 'min'): Map<number, 1 | 2> {
  const comparables = valeurs
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v));
  const rangs = new Map<number, 1 | 2>();
  if (comparables.length < 2) return rangs;

  const egal = (x: number, y: number) => Math.abs(x - y) < 1e-9;
  const distinctes = comparables
    .map((x) => x.v)
    .sort((x, y) => (sens === 'max' ? y - x : x - y))
    .filter((v, k, tri) => k === 0 || !egal(v, tri[k - 1]));
  if (distinctes.length < 2) return rangs;

  for (const x of comparables) if (egal(x.v, distinctes[0])) rangs.set(x.i, 1);
  if (distinctes.length >= 3) {
    for (const x of comparables) if (egal(x.v, distinctes[1])) rangs.set(x.i, 2);
  }
  return rangs;
}
