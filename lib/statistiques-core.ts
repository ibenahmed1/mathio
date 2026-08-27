// § Statistiques — noyau PUR.
//
// Ce module ne doit JAMAIS importer prisma, ni quoi que ce soit qui en dépende :
// il est consommé par des composants clients (EnteteStatistique) autant que par
// les Server Components. Un import de '@/lib/prisma' ici entraîne pg, qui
// entraîne fs, et le bundler client échoue avec un « Can't resolve 'fs' » dont
// la pile ne mentionne même pas la vraie cause.
//
// Même raison d'être que lib/stock-quantites.ts. Les fonctions qui touchent la
// base vivent dans lib/statistiques.ts, qui réexporte tout ceci pour que les
// pages n'aient qu'un import à faire.

import type { StatutCommande } from '@/app/generated/prisma/enums';

//
// ------------------------------------------------------------
// La convention qui gouverne tout ce module : la COHORTE
// ------------------------------------------------------------
// Un colis appartient à une période si sa DATE DE CRÉATION y tombe — pas la
// date de l'événement qui lui a donné son statut final. Les pages disent donc
// « les colis créés du X au Y, et ce qu'ils sont devenus », jamais « ce qui a
// été livré entre le X et le Y ».
//
// Ce n'est pas un raccourci, c'est le seul choix honnête avec le modèle
// actuel : `Commande` porte `dateLivraison`, mais AUCUNE date de retour. Une
// vue « activité » exigerait de lire l'horodatage du passage à `retourne` dans
// HistoriqueStatutCommande, colis par colis — donc de mélanger deux sources de
// date selon le statut, et de produire un taux de livraison dont le
// dénominateur et le numérateur ne parlent pas de la même population.
//
// La cohorte a en prime le mérite de répondre à la question qui compte :
// « sur les colis que j'ai pris en charge, quelle proportion ai-je livrée ? »
//
// Pour basculer un jour en vue « activité », il faudrait ajouter une colonne
// `dateRetour` sur Commande, écrite au passage à `retourne` — et alors
// seulement changer ANCRAGE_PERIODE ci-dessous.

export const ANCRAGE_PERIODE = 'dateCreation' as const;

// ------------------------------------------------------------
// Période
// ------------------------------------------------------------

export const PRESETS_PERIODE = ['7j', '30j', '90j', 'mois', 'mois-1', 'annee', 'tout'] as const;
export type PresetPeriode = (typeof PRESETS_PERIODE)[number];

export const LABELS_PRESET: Record<PresetPeriode, string> = {
  '7j': '7 derniers jours',
  '30j': '30 derniers jours',
  '90j': '90 derniers jours',
  mois: 'Mois en cours',
  'mois-1': 'Mois précédent',
  annee: 'Année en cours',
  tout: 'Depuis le début',
};

export interface Periode {
  preset: PresetPeriode;
  label: string;
  debut: Date | null;
  fin: Date;
  // Nombre de jours couverts, ou null pour « tout » — sert à décider du pas de
  // la courbe d'évolution (quotidien ou hebdomadaire).
  nbJours: number | null;
}

// Exporté : lib/statistiques.ts en a besoin pour caler les seaux de la courbe
// d'évolution sur des journées entières.
export function debutDeJour(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function finDeJour(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

// Bornes en heure LOCALE et non en UTC, contrairement aux périodes de paie
// (lib/bon-paiement.ts) : ici la borne n'est pas un identifiant comparé par
// égalité, c'est un intervalle affiché à un exploitant qui pense en « hier »
// et « ce mois-ci ». Un décalage d'une heure y serait visible à l'écran.
export function resoudrePeriode(preset?: string | null): Periode {
  const choisi: PresetPeriode = PRESETS_PERIODE.includes(preset as PresetPeriode)
    ? (preset as PresetPeriode)
    : '30j';

  const maintenant = new Date();
  const fin = finDeJour(maintenant);

  const joursGlissants: Partial<Record<PresetPeriode, number>> = { '7j': 7, '30j': 30, '90j': 90 };
  const glissant = joursGlissants[choisi];
  if (glissant) {
    const debut = debutDeJour(maintenant);
    debut.setDate(debut.getDate() - (glissant - 1));
    return { preset: choisi, label: LABELS_PRESET[choisi], debut, fin, nbJours: glissant };
  }

  if (choisi === 'mois') {
    const debut = debutDeJour(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
    return { preset: choisi, label: LABELS_PRESET[choisi], debut, fin, nbJours: joursEntre(debut, fin) };
  }

  if (choisi === 'mois-1') {
    const debut = debutDeJour(new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1));
    const finMois = finDeJour(new Date(maintenant.getFullYear(), maintenant.getMonth(), 0));
    return { preset: choisi, label: LABELS_PRESET[choisi], debut, fin: finMois, nbJours: joursEntre(debut, finMois) };
  }

  if (choisi === 'annee') {
    const debut = debutDeJour(new Date(maintenant.getFullYear(), 0, 1));
    return { preset: choisi, label: LABELS_PRESET[choisi], debut, fin, nbJours: joursEntre(debut, fin) };
  }

  return { preset: 'tout', label: LABELS_PRESET.tout, debut: null, fin, nbJours: null };
}

export function joursEntre(debut: Date, fin: Date): number {
  const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((finDeJour(fin).getTime() - debutDeJour(debut).getTime()) / MS_PAR_JOUR));
}

// Période immédiatement antérieure et de MÊME durée : c'est elle qui donne son
// sens à une variation (« +12 % » n'existe pas dans l'absolu). Renvoie null
// pour « tout », qui n'a pas de précédent.
export function periodePrecedenteEquivalente(periode: Periode): Periode | null {
  if (!periode.debut || periode.nbJours === null) return null;

  const fin = new Date(periode.debut.getTime() - 1);
  const debut = debutDeJour(new Date(periode.debut));
  debut.setDate(debut.getDate() - periode.nbJours);

  return {
    preset: periode.preset,
    label: 'Période précédente',
    debut,
    fin,
    nbJours: periode.nbJours,
  };
}

// ------------------------------------------------------------
// Compteurs et taux — partie PURE, testable sans base
// ------------------------------------------------------------

export interface Compteurs {
  total: number;
  livres: number;
  retournes: number;
  annules: number;
  // Ni livré, ni retourné, ni annulé : encore dans le pipeline.
  enCours: number;
}

export const COMPTEURS_VIDES: Compteurs = { total: 0, livres: 0, retournes: 0, annules: 0, enCours: 0 };

const STATUTS_ANNULES: StatutCommande[] = ['annule', 'annule_par_vendeur'];

export function compteursDepuisStatuts(entrees: { statut: StatutCommande; nb: number }[]): Compteurs {
  const c: Compteurs = { ...COMPTEURS_VIDES };
  for (const { statut, nb } of entrees) {
    c.total += nb;
    if (statut === 'livre') c.livres += nb;
    else if (statut === 'retourne') c.retournes += nb;
    else if (STATUTS_ANNULES.includes(statut)) c.annules += nb;
    else c.enCours += nb;
  }
  return c;
}

// Colis arrivés au bout du circuit de LIVRAISON : livrés ou retournés. Les
// annulations en sont exclues à dessein — un colis annulé avant expédition n'a
// jamais été présenté à un client, le compter comme un échec de livraison
// punirait la plateforme pour une décision du marchand.
export function nbTermines(c: Compteurs): number {
  return c.livres + c.retournes;
}

// Taux de livraison : livrés sur colis effectivement présentés. Renvoie null
// (et non 0) quand rien n'est encore terminé — « 0 % » et « pas de données »
// ne se disent pas de la même façon à l'écran.
export function tauxLivraison(c: Compteurs): number | null {
  const base = nbTermines(c);
  return base === 0 ? null : arrondi1((c.livres / base) * 100);
}

export function tauxRetour(c: Compteurs): number | null {
  const base = nbTermines(c);
  return base === 0 ? null : arrondi1((c.retournes / base) * 100);
}

// Taux d'annulation : rapporté au TOTAL et non aux terminés — une annulation
// ne fait pas partie du circuit de livraison, elle le remplace.
export function tauxAnnulation(c: Compteurs): number | null {
  return c.total === 0 ? null : arrondi1((c.annules / c.total) * 100);
}

export function variation(actuel: number, precedent: number): number | null {
  if (precedent === 0) return actuel === 0 ? 0 : null;
  return arrondi1(((actuel - precedent) / precedent) * 100);
}

function arrondi1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function formatTaux(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1).replace('.', ',')} %`;
}

export function formatNombre(v: number): string {
  return v.toLocaleString('fr-FR');
}

export function formatDirhams(v: number): string {
  return `${Math.round(v).toLocaleString('fr-FR')} DH`;
}


// ------------------------------------------------------------
// Formes de sortie
// ------------------------------------------------------------

export interface RepartitionStatut {
  statut: StatutCommande;
  nb: number;
}

export interface PointEvolution {
  cle: string;
  label: string;
  livres: number;
  retournes: number;
  autres: number;
}

export interface LigneVentilation {
  cle: string;
  libelle: string;
  sousTitre?: string | null;
  compteurs: Compteurs;
  codEncaisse: number;
}

export interface GroupeBrut {
  cle: string;
  libelle: string;
  sousTitre?: string | null;
  statut: StatutCommande;
  nb: number;
  cod: number;
}

// Assemblage commun aux quatre ventilations (livreur, ville, zone, client) :
// elles ne diffèrent que par la clé de regroupement et le libellé. Le tri se
// fait sur le VOLUME et non sur le taux — un livreur à 100 % sur deux colis
// n'a rien à faire en tête d'un classement de performance.
export function assemblerVentilation(groupes: GroupeBrut[]): LigneVentilation[] {
  const parCle = new Map<string, LigneVentilation>();

  for (const g of groupes) {
    let ligne = parCle.get(g.cle);
    if (!ligne) {
      ligne = {
        cle: g.cle,
        libelle: g.libelle,
        sousTitre: g.sousTitre ?? null,
        compteurs: { ...COMPTEURS_VIDES },
        codEncaisse: 0,
      };
      parCle.set(g.cle, ligne);
    }
    const ajout = compteursDepuisStatuts([{ statut: g.statut, nb: g.nb }]);
    ligne.compteurs.total += ajout.total;
    ligne.compteurs.livres += ajout.livres;
    ligne.compteurs.retournes += ajout.retournes;
    ligne.compteurs.annules += ajout.annules;
    ligne.compteurs.enCours += ajout.enCours;
    // Le COD d'un colis retourné n'a jamais été encaissé : même règle qu'en
    // facturation, l'inclure gonflerait le chiffre d'affaires d'un argent qui
    // n'est pas entré en caisse.
    if (g.statut === 'livre') ligne.codEncaisse += g.cod;
  }

  return [...parCle.values()].sort((a, b) => b.compteurs.total - a.compteurs.total);
}
