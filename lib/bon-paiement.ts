import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { nextBonPaiementNumero } from '@/lib/codes';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutBonPaiement, TypeAjustementPaiement } from '@/app/generated/prisma/enums';

// § Bon de paiement livreur (/admin/bon-paiement/livreur et /zone).
//
// Ce module ne calcule PAS la rémunération : il agrège. Le gain d'une tournée
// a été figé à sa clôture (BonDistribution.gainLivreur, cf. le volet B du
// commentaire de POST /api/bons-distribution/[id]/cloturer) précisément pour
// qu'une grille tarifaire modifiée plus tard ne réécrive pas le passé.
// Recalculer ici annulerait cette garantie.
//
// La seule chose qu'il calcule vraiment, c'est le net : commissions figées
// + ajustements saisis à la main (primes, pénalités), et uniquement tant que
// le bon est en brouillon.

// ------------------------------------------------------------
// Période de paie
// ------------------------------------------------------------

export interface PeriodePaie {
  debut: Date;
  fin: Date;
}

// Mois civil complet, bornes incluses. `fin` est la dernière milliseconde du
// mois plutôt que le 1er du mois suivant : les filtres Prisma ci-dessous
// utilisent `lte`, et un `lt` sur le 1er suivant obligerait chaque appelant à
// se souvenir de la convention.
//
// Bornes construites en UTC et non en heure locale, contrairement au reste de
// l'application. `periodeDebut` n'est pas un instant, c'est l'IDENTIFIANT de
// la période : il est comparé par égalité stricte (unicité livreur+mois,
// filtre du tableau de bord). Construit en heure locale, « août 2026 »
// vaudrait 2026-08-01T00:00Z sur un serveur en UTC et 2026-07-31T23:00Z sur un
// poste au Maroc — le même mois donnerait deux clés, et le verrou d'unicité
// laisserait passer un doublon au premier changement d'environnement.
//
// Contrepartie assumée, et elle joue dans ce sens-ci : le Maroc étant à UTC+1,
// une tournée clôturée le PREMIER jour du mois entre minuit et 1h (heure
// locale) porte un instant UTC encore situé le dernier jour du mois précédent
// — elle alimente donc la paie du mois PRÉCÉDENT. Une clôture le dernier jour
// à 23h, elle, ne bascule pas : 23h locale = 22h UTC, toujours dans le mois.
// Un arrondi d'une heure, mais stable — ce qui vaut mieux qu'un arrondi juste
// dans un environnement et faux dans l'autre.
//
// Le Maroc repasse à UTC+0 pendant le Ramadan : sur cette période, heure locale
// et heure UTC coïncident et l'écart disparaît entièrement.
export function periodeMensuelle(annee: number, mois: number): PeriodePaie {
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    throw new ApiError(400, 'Année de période invalide');
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    throw new ApiError(400, 'Mois de période invalide (1-12)');
  }
  return {
    debut: new Date(Date.UTC(annee, mois - 1, 1, 0, 0, 0, 0)),
    fin: new Date(Date.UTC(annee, mois, 1, 0, 0, 0, -1)),
  };
}

// `annee`/`mois` cadrent une requête sur une période de paie. Les deux vont
// toujours ensemble : filtrer sur un mois sans année n'a pas de sens et
// ramènerait silencieusement les mois homonymes des années précédentes.
export function periodeDepuisParams(searchParams: URLSearchParams): PeriodePaie | null {
  const annee = searchParams.get('annee');
  const mois = searchParams.get('mois');
  if (!annee && !mois) return null;
  if (!annee || !mois) throw new ApiError(400, 'annee et mois doivent être fournis ensemble');
  return periodeMensuelle(Number(annee), Number(mois));
}

// Mois de paie par défaut : le mois ÉCOULÉ, pas le mois courant. Le 1er du
// mois, l'écran doit s'ouvrir sur ce qu'il y a à payer — c'est-à-dire le mois
// qui vient de se terminer.
export function periodePrecedente(reference: Date): { annee: number; mois: number } {
  const precedent = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  return { annee: precedent.getFullYear(), mois: precedent.getMonth() + 1 };
}

// ------------------------------------------------------------
// Tournées éligibles
// ------------------------------------------------------------

// Une tournée est à régler dès lors qu'elle est clôturée, qu'elle a produit
// un gain, et qu'aucun bon de paiement ne l'a encore prise. `bonPaiementId`
// est le critère qui fait foi ; `gainRegleLe` est écrit au décaissement et
// sert à l'affichage (« réglé le … »).
//
// L'annulation d'un bon remet ces deux champs à null : les tournées
// redeviennent alors éligibles, ce qui est exactement le comportement attendu
// d'une contestation (cf. POST /api/bons-paiement/[id]/annuler).
const TOURNEE_A_REGLER = {
  statut: 'cloture',
  gainLivreur: { not: null },
  bonPaiementId: null,
} satisfies Prisma.BonDistributionWhereInput;

// Le rattachement d'une tournée à une période se fait sur sa date de CLÔTURE
// et non sa date de génération : une tournée partie le 31 juillet et clôturée
// le 1er août a vu ses colis passer `livre` en août, c'est donc la paie d'août
// qu'elle alimente. C'est aussi la seule date à laquelle le gain existe.
function filtrePeriode(periode?: PeriodePaie | null): Prisma.BonDistributionWhereInput {
  return periode ? { dateCloture: { gte: periode.debut, lte: periode.fin } } : {};
}

const tourneeSelect = {
  id: true,
  numero: true,
  dateGeneration: true,
  dateCloture: true,
  nbColisLivres: true,
  nbColisRetournes: true,
  gainLivreur: true,
  hub: { select: { id: true, nom: true } },
} satisfies Prisma.BonDistributionSelect;

export type TourneeARegler = Prisma.BonDistributionGetPayload<{ select: typeof tourneeSelect }>;

export interface LivreurARegler {
  id: string;
  nomComplet: string;
  telephone: string | null;
  hubId: string | null;
  hubNom: string | null;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  montantDu: number;
}

function arrondi(valeur: number): number {
  return Number(valeur.toFixed(2));
}

// Le signe d'un ajustement vient de son TYPE, jamais du montant stocké (qui
// est toujours positif, cf. le commentaire du modèle AjustementBonPaiement).
export function effetAjustement(type: TypeAjustementPaiement, montant: number | string): number {
  const valeur = Math.abs(Number(montant));
  return type === 'penalite' ? -valeur : valeur;
}

// Écran d'entrée des deux pages : les livreurs qui ont un solde non réglé sur
// la période. `hubId` restreint au périmètre d'un hub — c'est toute la
// différence entre l'entrée « pour livreur » (tous) et l'entrée « pour zone »
// (un hub), qui aboutissent au même document nominatif.
export async function getLivreursARegler(
  hubId?: string | null,
  periode?: PeriodePaie | null
): Promise<LivreurARegler[]> {
  const tournees = await prisma.bonDistribution.findMany({
    where: { ...TOURNEE_A_REGLER, ...filtrePeriode(periode), ...(hubId ? { hubId } : {}) },
    select: {
      ...tourneeSelect,
      livreur: { select: { id: true, nomComplet: true, telephone: true, hubId: true } },
    },
    orderBy: { dateCloture: 'asc' },
  });

  const parLivreur = new Map<string, LivreurARegler>();

  for (const t of tournees) {
    const existant = parLivreur.get(t.livreur.id) ?? {
      id: t.livreur.id,
      nomComplet: t.livreur.nomComplet,
      telephone: t.livreur.telephone,
      hubId: t.hub?.id ?? t.livreur.hubId,
      hubNom: t.hub?.nom ?? null,
      nbTournees: 0,
      nbColisLivres: 0,
      nbColisRetournes: 0,
      montantDu: 0,
    };

    existant.nbTournees += 1;
    existant.nbColisLivres += t.nbColisLivres ?? 0;
    existant.nbColisRetournes += t.nbColisRetournes ?? 0;
    existant.montantDu = arrondi(existant.montantDu + Number(t.gainLivreur ?? 0));

    parLivreur.set(t.livreur.id, existant);
  }

  return [...parLivreur.values()].sort((a, b) => b.montantDu - a.montantDu);
}

// Détail des tournées non réglées d'un livreur sur la période — alimente
// l'écran de composition, puis sert de source de vérité à la génération
// (revalidée dans la transaction, cf. POST /api/bons-paiement).
export async function getTourneesARegler(
  livreurId: string,
  periode?: PeriodePaie | null
): Promise<TourneeARegler[]> {
  return prisma.bonDistribution.findMany({
    where: { ...TOURNEE_A_REGLER, ...filtrePeriode(periode), livreurId },
    select: tourneeSelect,
    orderBy: { dateCloture: 'asc' },
  });
}

export function totaliserTournees(tournees: TourneeARegler[]) {
  return tournees.reduce(
    (acc, t) => ({
      nbTournees: acc.nbTournees + 1,
      nbColisLivres: acc.nbColisLivres + (t.nbColisLivres ?? 0),
      nbColisRetournes: acc.nbColisRetournes + (t.nbColisRetournes ?? 0),
      montantTotal: arrondi(acc.montantTotal + Number(t.gainLivreur ?? 0)),
    }),
    { nbTournees: 0, nbColisLivres: 0, nbColisRetournes: 0, montantTotal: 0 }
  );
}

// ------------------------------------------------------------
// Unicité (livreur, période)
// ------------------------------------------------------------

// Statuts qui « occupent » une période pour un livreur. Un bon annulé n'en
// fait pas partie : c'est ce qui permet de régénérer après une contestation,
// et la raison pour laquelle l'unicité (livreur, période) est vérifiée ici
// plutôt que par une contrainte DB, qui ne saurait pas ignorer les annulés.
export const STATUTS_OCCUPANTS: StatutBonPaiement[] = ['brouillon', 'valide', 'paye'];

export async function bonExistantSurPeriode(
  db: Prisma.TransactionClient,
  livreurId: string,
  periode: PeriodePaie
) {
  return db.bonPaiement.findFirst({
    where: {
      livreurId,
      periodeDebut: periode.debut,
      statut: { in: STATUTS_OCCUPANTS },
    },
    select: { id: true, numero: true, statut: true },
  });
}

// ------------------------------------------------------------
// Génération
// ------------------------------------------------------------

export interface OptionsGeneration {
  livreurId: string;
  periode: PeriodePaie;
  emisParId: string;
  // Restriction manuelle de l'assiette (écran « Préparer le bon »). Vide =
  // toutes les tournées éligibles de la période, ce qui est le cas de la
  // génération mensuelle automatique.
  tourneeIds?: string[];
  // Hub de repli quand aucune tournée ne porte le sien.
  hubParDefaut?: string | null;
}

// Crée UN bon en BROUILLON et verrouille ses tournées. À appeler dans une
// transaction : la lecture des tournées éligibles et leur rattachement doivent
// être atomiques, sinon deux générations concurrentes (le bouton « générer
// tout le mois » cliqué deux fois) paieraient deux fois les mêmes tournées.
//
// Retourne `null` quand il n'y a rien à générer — la génération en lot itère
// sur tous les livreurs et doit pouvoir sauter les inactifs sans faire échouer
// le lot entier.
export async function creerBonPaiement(
  tx: Prisma.TransactionClient,
  { livreurId, periode, emisParId, tourneeIds = [], hubParDefaut = null }: OptionsGeneration
) {
  const eligibles = await tx.bonDistribution.findMany({
    where: { ...TOURNEE_A_REGLER, ...filtrePeriode(periode), livreurId },
    select: tourneeSelect,
    orderBy: { dateCloture: 'asc' },
  });

  const retenues = tourneeIds.length > 0 ? eligibles.filter((t) => tourneeIds.includes(t.id)) : eligibles;

  if (retenues.length === 0) return null;
  if (tourneeIds.length > 0 && retenues.length !== tourneeIds.length) {
    throw new ApiError(
      409,
      'Une ou plusieurs tournées sélectionnées ont déjà été réglées entre-temps — rafraîchissez la page'
    );
  }

  const totaux = totaliserTournees(retenues);
  // Le hub est celui de la tournée la plus récente, à défaut celui du compte :
  // il sert au filtrage « par zone » et doit rester juste même si le livreur
  // change de rattachement plus tard.
  const hubId = retenues[retenues.length - 1]?.hub?.id ?? hubParDefaut;

  const bon = await tx.bonPaiement.create({
    data: {
      numero: await nextBonPaiementNumero(tx, periode.debut),
      livreurId,
      hubId,
      periodeDebut: periode.debut,
      periodeFin: periode.fin,
      nbTournees: totaux.nbTournees,
      nbColisLivres: totaux.nbColisLivres,
      nbColisRetournes: totaux.nbColisRetournes,
      // Aucun ajustement à la génération : le net part égal aux commissions et
      // ne bougera que par des lignes explicites.
      montantCommissions: totaux.montantTotal,
      totalAjustements: 0,
      montantTotal: totaux.montantTotal,
      emisParId,
    },
  });

  // `bonPaiementId: null` dans le filtre : si une autre session a réglé ces
  // tournées entre-temps, le compte de lignes touchées ne correspond plus et la
  // transaction est annulée — verrouillage optimiste plutôt qu'un
  // SELECT ... FOR UPDATE.
  const { count } = await tx.bonDistribution.updateMany({
    where: { id: { in: retenues.map((t) => t.id) }, bonPaiementId: null },
    data: { bonPaiementId: bon.id },
  });
  if (count !== retenues.length) {
    throw new ApiError(409, 'Une tournée a été réglée par une autre session — recommencez');
  }

  return bon;
}

// ------------------------------------------------------------
// Lecture d'un bon
// ------------------------------------------------------------

// Le détail au colis d'un bon de paiement. Le rattachement passe par la
// tournée (Commande.bonDistribution.bonPaiementId) et non par une table de
// lignes recopiées : un colis reste attaché à SA tournée définitivement —
// `bonDistributionId` n'est jamais remis à null nulle part dans le code, et
// un colis rentré au hub n'est pas ré-éligible à une nouvelle tournée. La
// liste est donc déjà stable, il n'y avait rien à figer de plus que les
// montants (Commande.fraisLivreur, figé à la clôture).
const colisPayeSelect = {
  id: true,
  codeSuivi: true,
  clientNom: true,
  ville: true,
  montantCod: true,
  dateLivraison: true,
  fraisLivreur: true,
  fraisLivreurLivre: true,
  marchand: { select: { nomBoutique: true } },
  bonDistribution: { select: { numero: true, dateCloture: true } },
} satisfies Prisma.CommandeSelect;

export type ColisPaye = Prisma.CommandeGetPayload<{ select: typeof colisPayeSelect }>;

export async function getColisDuBon(bonPaiementId: string): Promise<ColisPaye[]> {
  return prisma.commande.findMany({
    // Aucun filtre sur le statut courant, volontairement : une tournée ne se
    // clôture que lorsque tous ses colis sont livrés ou rentrés au hub, donc
    // tout ce qui y est rattaché a bien été rémunéré. Filtrer sur
    // `statut in (livre, retourne_au_hub)` ferait au contraire DISPARAÎTRE de
    // la fiche un colis rentré puis rendu à son marchand (statut `retourne`) —
    // une ligne de paie qui s'efface d'un document déjà signé.
    // C'est `fraisLivreurLivre`, figé à la clôture, qui porte la nature.
    where: { bonDistribution: { bonPaiementId } },
    select: colisPayeSelect,
    orderBy: [{ dateLivraison: 'asc' }, { codeSuivi: 'asc' }],
  });
}

const ajustementSelect = {
  id: true,
  type: true,
  libelle: true,
  montant: true,
  dateCreation: true,
  creePar: { select: { nomComplet: true } },
} satisfies Prisma.AjustementBonPaiementSelect;

// Le détail au colis accompagne toujours le bon : c'est le niveau auquel un
// livreur conteste une ligne, et donc celui que l'écran doit pouvoir montrer
// sans second aller-retour.
export async function getBonPaiement(id: string) {
  const colis = await getColisDuBon(id);
  const bon = await prisma.bonPaiement.findUnique({
    where: { id },
    include: {
      livreur: {
        select: {
          id: true,
          nomComplet: true,
          telephone: true,
          cin: true,
          nomBanque: true,
          numeroCompte: true,
        },
      },
      hub: { select: { nom: true, ville: true } },
      emisPar: { select: { nomComplet: true } },
      validePar: { select: { nomComplet: true } },
      transaction: { select: { id: true, dateEffet: true } },
      ajustements: { select: ajustementSelect, orderBy: { dateCreation: 'asc' } },
      tournees: { select: tourneeSelect, orderBy: { dateCloture: 'asc' } },
    },
  });
  if (!bon) throw new ApiError(404, 'Bon de paiement introuvable');
  return { ...bon, colis };
}

// Recalcule totalAjustements et montantTotal à partir des lignes en base.
// Appelé après chaque ajout/retrait d'ajustement, DANS la transaction : les
// deux totaux dénormalisés sur le bon ne doivent jamais diverger de la somme
// de ses lignes, sinon la fiche de paie signée par le livreur ment.
export async function recalculerTotaux(db: Prisma.TransactionClient, bonPaiementId: string) {
  const [bon, lignes] = await Promise.all([
    db.bonPaiement.findUniqueOrThrow({
      where: { id: bonPaiementId },
      select: { montantCommissions: true },
    }),
    db.ajustementBonPaiement.findMany({
      where: { bonPaiementId },
      select: { type: true, montant: true },
    }),
  ]);

  const totalAjustements = arrondi(
    lignes.reduce((somme, l) => somme + effetAjustement(l.type, Number(l.montant)), 0)
  );

  return db.bonPaiement.update({
    where: { id: bonPaiementId },
    data: {
      totalAjustements,
      montantTotal: arrondi(Number(bon.montantCommissions) + totalAjustements),
    },
  });
}

// ------------------------------------------------------------
// Vue du livreur sur sa propre paie (§ /livreur/bons-paiement)
// ------------------------------------------------------------

export interface PeriodeNonGeneree {
  annee: number;
  mois: number;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  montant: number;
}

export interface PaieLivreur {
  // Ce que le livreur attend réellement : le net des bons déjà émis mais pas
  // encore versés, PLUS les tournées clôturées qu'aucun bon n'a encore prises.
  totalDu: number;
  // Net des bons brouillon + validé — ajustements COMPRIS. C'est la
  // différence essentielle avec l'ancien « solde à payer », qui sommait des
  // gains bruts et affichait donc un montant que le livreur ne recevrait pas
  // si une pénalité avait été saisie sur son bon.
  totalArrete: number;
  // Commissions de tournées clôturées sans bon. Montant encore susceptible de
  // bouger : c'est une accumulation, pas un engagement.
  totalNonGenere: number;
  bons: BonPaiementLivreur[];
  periodesNonGenerees: PeriodeNonGeneree[];
}

const bonLivreurSelect = {
  id: true,
  numero: true,
  statut: true,
  periodeDebut: true,
  periodeFin: true,
  nbTournees: true,
  nbColisLivres: true,
  nbColisRetournes: true,
  montantCommissions: true,
  totalAjustements: true,
  montantTotal: true,
  dateGeneration: true,
  dateValidation: true,
  dateReglement: true,
  dateAnnulation: true,
  motifAnnulation: true,
  modeReglement: true,
  referenceReglement: true,
  hub: { select: { nom: true } },
  // Les lignes d'ajustement sont exposées au livreur, et non seulement leur
  // somme : un net inférieur à ses commissions sans motif lisible est
  // exactement ce qui déclenche une contestation.
  ajustements: {
    select: { id: true, type: true, libelle: true, montant: true },
    orderBy: { dateCreation: 'asc' },
  },
} satisfies Prisma.BonPaiementSelect;

export type BonPaiementLivreur = Prisma.BonPaiementGetPayload<{ select: typeof bonLivreurSelect }>;

export async function getPaieLivreur(livreurId: string): Promise<PaieLivreur> {
  const [bons, tournees] = await Promise.all([
    prisma.bonPaiement.findMany({
      where: { livreurId },
      select: bonLivreurSelect,
      orderBy: [{ periodeDebut: 'desc' }, { numero: 'asc' }],
      take: 36,
    }),
    // Les tournées sans bon, regroupées ensuite par mois de clôture — même
    // rattachement que la génération (cf. filtrePeriode), pour que le livreur
    // et le comptable ne lisent jamais deux découpages différents.
    prisma.bonDistribution.findMany({
      where: { ...TOURNEE_A_REGLER, livreurId },
      select: { dateCloture: true, nbColisLivres: true, nbColisRetournes: true, gainLivreur: true },
      orderBy: { dateCloture: 'desc' },
    }),
  ]);

  const parMois = new Map<string, PeriodeNonGeneree>();
  for (const t of tournees) {
    if (!t.dateCloture) continue;
    // Découpage en UTC comme periodeMensuelle : sans cela, une tournée
    // clôturée en fin de mois pourrait apparaître ici sous un mois et être
    // générée sous l'autre.
    const annee = t.dateCloture.getUTCFullYear();
    const mois = t.dateCloture.getUTCMonth() + 1;
    const cle = `${annee}-${mois}`;
    const ligne = parMois.get(cle) ?? {
      annee,
      mois,
      nbTournees: 0,
      nbColisLivres: 0,
      nbColisRetournes: 0,
      montant: 0,
    };
    ligne.nbTournees += 1;
    ligne.nbColisLivres += t.nbColisLivres ?? 0;
    ligne.nbColisRetournes += t.nbColisRetournes ?? 0;
    ligne.montant = arrondi(ligne.montant + Number(t.gainLivreur ?? 0));
    parMois.set(cle, ligne);
  }

  const totalArrete = arrondi(
    bons
      .filter((b) => b.statut === 'brouillon' || b.statut === 'valide')
      .reduce((somme, b) => somme + Number(b.montantTotal), 0)
  );
  const totalNonGenere = arrondi([...parMois.values()].reduce((somme, p) => somme + p.montant, 0));

  return {
    totalDu: arrondi(totalArrete + totalNonGenere),
    totalArrete,
    totalNonGenere,
    bons,
    periodesNonGenerees: [...parMois.values()].sort(
      (a, b) => b.annee - a.annee || b.mois - a.mois
    ),
  };
}

// ------------------------------------------------------------
// Tableau de bord mensuel (§ /admin/bon-paiement)
// ------------------------------------------------------------

// État de paie d'un livreur POUR UN MOIS — la question que pose réellement le
// comptable le 5 du mois : « qui reste-t-il à payer ? ».
//   paye          — bon au statut `paye`, l'argent est sorti.
//   en_attente    — bon généré (brouillon ou validé), pas encore décaissé.
//   non_genere    — le livreur a des tournées non réglées sur la période mais
//                   aucun bon : c'est la cible du bouton « Générer tous les
//                   bons du mois ».
//   sans_activite — aucune tournée réglable et aucun bon. Ce cas n'apparaît
//                   pas dans le tableau (rien à afficher), il n'existe que
//                   pour rendre le type exhaustif côté UI.
export type StatutPaieLivreur = 'paye' | 'en_attente' | 'non_genere' | 'sans_activite';

export interface LigneTableauDeBord {
  livreurId: string;
  nomComplet: string;
  telephone: string | null;
  hubNom: string | null;
  statutPaie: StatutPaieLivreur;
  nbTournees: number;
  nbColisLivres: number;
  nbColisRetournes: number;
  // Commissions non encore rattachées à un bon — ce qui serait généré.
  montantEnAttenteGeneration: number;
  bon: {
    id: string;
    numero: string;
    statut: StatutBonPaiement;
    montantTotal: number;
    dateReglement: string | null;
    modeReglement: string | null;
  } | null;
}

export interface TableauDeBordMensuel {
  annee: number;
  mois: number;
  periode: { debut: string; fin: string };
  kpis: {
    // Masse totale du mois = payé + généré non payé + reste à générer. Les
    // trois se somment exactement, pour que le comptable puisse vérifier son
    // écran d'un coup d'œil.
    masseTotale: number;
    totalPaye: number;
    totalResteAPayer: number;
    totalNonGenere: number;
    nbLivreursPayes: number;
    nbLivreursEnAttente: number;
    nbLivreursNonGeneres: number;
  };
  lignes: LigneTableauDeBord[];
}

export async function getTableauDeBordMensuel(
  annee: number,
  mois: number,
  hubId?: string | null
): Promise<TableauDeBordMensuel> {
  const periode = periodeMensuelle(annee, mois);

  const [bons, tourneesLibres] = await Promise.all([
    prisma.bonPaiement.findMany({
      where: {
        periodeDebut: periode.debut,
        statut: { in: STATUTS_OCCUPANTS },
        ...(hubId ? { hubId } : {}),
      },
      select: {
        id: true,
        numero: true,
        statut: true,
        montantTotal: true,
        dateReglement: true,
        modeReglement: true,
        nbTournees: true,
        nbColisLivres: true,
        nbColisRetournes: true,
        livreur: { select: { id: true, nomComplet: true, telephone: true } },
        hub: { select: { nom: true } },
      },
    }),
    getLivreursARegler(hubId, periode),
  ]);

  const lignes = new Map<string, LigneTableauDeBord>();

  for (const bon of bons) {
    lignes.set(bon.livreur.id, {
      livreurId: bon.livreur.id,
      nomComplet: bon.livreur.nomComplet,
      telephone: bon.livreur.telephone,
      hubNom: bon.hub?.nom ?? null,
      statutPaie: bon.statut === 'paye' ? 'paye' : 'en_attente',
      nbTournees: bon.nbTournees,
      nbColisLivres: bon.nbColisLivres,
      nbColisRetournes: bon.nbColisRetournes,
      montantEnAttenteGeneration: 0,
      bon: {
        id: bon.id,
        numero: bon.numero,
        statut: bon.statut,
        montantTotal: Number(bon.montantTotal),
        dateReglement: bon.dateReglement?.toISOString() ?? null,
        modeReglement: bon.modeReglement,
      },
    });
  }

  // Un livreur peut cumuler les deux : un bon déjà généré pour le mois ET des
  // tournées clôturées après coup (une tournée du 31 clôturée le 2). On garde
  // alors le statut de son bon, mais le reliquat reste visible et générable —
  // c'est le cas qui, non traité, ferait disparaître silencieusement de
  // l'argent dû.
  for (const livreur of tourneesLibres) {
    const existante = lignes.get(livreur.id);
    if (existante) {
      existante.montantEnAttenteGeneration = livreur.montantDu;
      continue;
    }
    lignes.set(livreur.id, {
      livreurId: livreur.id,
      nomComplet: livreur.nomComplet,
      telephone: livreur.telephone,
      hubNom: livreur.hubNom,
      statutPaie: 'non_genere',
      nbTournees: livreur.nbTournees,
      nbColisLivres: livreur.nbColisLivres,
      nbColisRetournes: livreur.nbColisRetournes,
      montantEnAttenteGeneration: livreur.montantDu,
      bon: null,
    });
  }

  const toutes = [...lignes.values()].sort((a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr'));

  const kpis = toutes.reduce(
    (acc, l) => {
      const paye = l.bon?.statut === 'paye' ? l.bon.montantTotal : 0;
      const enAttente = l.bon && l.bon.statut !== 'paye' ? l.bon.montantTotal : 0;

      acc.totalPaye = arrondi(acc.totalPaye + paye);
      acc.totalResteAPayer = arrondi(acc.totalResteAPayer + enAttente);
      acc.totalNonGenere = arrondi(acc.totalNonGenere + l.montantEnAttenteGeneration);
      if (l.statutPaie === 'paye') acc.nbLivreursPayes += 1;
      else if (l.statutPaie === 'en_attente') acc.nbLivreursEnAttente += 1;
      else if (l.statutPaie === 'non_genere') acc.nbLivreursNonGeneres += 1;
      return acc;
    },
    {
      masseTotale: 0,
      totalPaye: 0,
      totalResteAPayer: 0,
      totalNonGenere: 0,
      nbLivreursPayes: 0,
      nbLivreursEnAttente: 0,
      nbLivreursNonGeneres: 0,
    }
  );

  kpis.masseTotale = arrondi(kpis.totalPaye + kpis.totalResteAPayer + kpis.totalNonGenere);

  return {
    annee,
    mois,
    periode: { debut: periode.debut.toISOString(), fin: periode.fin.toISOString() },
    kpis,
    lignes: toutes,
  };
}
