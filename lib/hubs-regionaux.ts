// § Réseau en 11 hubs régionaux (décision du 06/10/2026).
//
// Avant : un hub par AGENCE de transporteur (24), plus un hub interne central.
// Après : 11 hubs, chacun servi par UN transporteur, plus le hub central — qui
// reste séparé (réception, stock, départ des bons d'envoi) et ne sert jamais de
// destination. Les anciens noms d'agence ne désignent plus que des VILLES.
//
// Cette table est la SEULE source du découpage. Elle est lue :
//   - par les imports du référentiel (resoudreHubImport, lib/prestataires.ts) :
//     une agence d'un fichier fournisseur est rangée dans son hub régional, et
//     un `npm run db:reseau` ne recrée jamais les agences ;
//   - par le regroupement de la base existante (scripts/regrouper-hubs-regionaux.ts) ;
//   - par les remises aux API des transporteurs : leurs tables de villes
//     (lib/*-villes.ts) restent rangées par agence, en interne, parce que c'est
//     ainsi que chaque transporteur numérote ses villes. Un hub en retrouve ses
//     agences ici, et une remise cherche la ville du colis dans chacune.
//
// Module PUR (aucun import Prisma) : testable et lisible partout.

export const HUB_CENTRAL = 'Hub Central';

export interface HubRegional {
  nom: string;
  // Ville d'implantation du hub (Hub.ville). Avec le transporteur, c'est
  // l'identité du hub en base (@@unique([prestataireId, ville])).
  ville: string;
  prestataire: string;
  // Anciennes agences absorbées : nom du hub en base et ville d'implantation.
  agences: { nom: string; ville: string }[];
}

export const HUBS_REGIONAUX: HubRegional[] = [
  {
    nom: 'Hub Tanger',
    ville: 'Tanger',
    prestataire: 'Amir Livraison',
    agences: [{ nom: 'Agence Tanger', ville: 'Tanger' }],
  },
  {
    nom: 'Hub Oujda',
    ville: 'Oujda',
    prestataire: 'EST Livraison',
    agences: [{ nom: 'Agence Oujda', ville: 'Oujda' }],
  },
  {
    nom: 'Hub Agadir',
    ville: 'Agadir',
    prestataire: 'Leader Colis',
    agences: [{ nom: 'Agence Agadir', ville: 'Agadir' }],
  },
  {
    nom: 'Hub Guelmim',
    ville: 'Guelmim',
    prestataire: 'Sahario Express',
    agences: [{ nom: 'Agence Guelmim', ville: 'Guelmim' }],
  },
  {
    nom: 'Hub Rabat',
    ville: 'Rabat',
    prestataire: 'Power Delivery',
    agences: [{ nom: 'Agence Rabat', ville: 'Rabat' }],
  },
  {
    nom: 'Hub Casablanca',
    ville: 'Casablanca',
    prestataire: 'Power Delivery',
    agences: [{ nom: 'Agence Casablanca', ville: 'Casablanca' }],
  },
  {
    nom: 'Hub Béni Mellal',
    ville: 'Beni Mellal',
    prestataire: 'Colivraison',
    agences: [
      { nom: 'Agence Béni Mellal', ville: 'Beni Mellal' },
      { nom: 'Agence Azilal', ville: 'Azilal' },
      { nom: 'Agence Errachidia', ville: 'Errachidia' },
      { nom: 'Agence Khénifra', ville: 'Khenifra' },
      { nom: 'Agence Khouribga', ville: 'Khouribga' },
      { nom: 'Agence Ouarzazate', ville: 'Ouarzazate' },
    ],
  },
  {
    nom: 'Hub El Jadida',
    ville: 'El Jadida',
    prestataire: 'Power Delivery',
    agences: [{ nom: 'Agence El Jadida', ville: 'El Jadida' }],
  },
  {
    nom: 'Hub Safi',
    ville: 'Safi',
    prestataire: 'Power Delivery',
    agences: [{ nom: 'Agence Safi', ville: 'Safi' }],
  },
  {
    nom: 'Hub Fès',
    ville: 'Fès',
    prestataire: 'Meta Livraison',
    agences: [
      { nom: 'Agence Fès', ville: 'Fès' },
      { nom: 'Agence Azrou', ville: 'Azrou' },
      { nom: 'Agence Boulmane', ville: 'Boulmane' },
      { nom: 'Agence Khemisset', ville: 'Khemisset' },
      { nom: 'Agence Meknès', ville: 'Meknès' },
      { nom: 'Agence Missour', ville: 'Missour' },
      { nom: 'Agence Sefrou', ville: 'Sefrou' },
      { nom: 'Agence Taounate', ville: 'Taounate' },
      { nom: 'Agence Taza', ville: 'Taza' },
    ],
  },
  {
    nom: 'Hub Marrakech',
    ville: 'Marrakech',
    prestataire: 'Power Delivery',
    agences: [{ nom: 'Agence Marrakech', ville: 'Marrakech' }],
  },
];

const PAR_AGENCE = new Map(HUBS_REGIONAUX.flatMap((h) => h.agences.map((a) => [a.nom, h] as const)));
const PAR_NOM = new Map(HUBS_REGIONAUX.map((h) => [h.nom, h]));

// Le hub régional qui a absorbé cette agence, ou `undefined` pour un nom qui
// n'est pas une ancienne agence.
export function hubRegionalDeLAgence(nomAgence: string): HubRegional | undefined {
  return PAR_AGENCE.get(nomAgence);
}

// Nom de hub à utiliser en base pour un nom qui peut être une ancienne agence :
// les scripts du référentiel désignent encore leurs lignes par agence
// (« Agence Taza / TAHLA »), ils passent par ici pour trouver le hub actuel.
export function nomHubActuel(nom: string): string {
  return PAR_AGENCE.get(nom)?.nom ?? nom;
}

// Agences (au sens des tables de villes des transporteurs) où chercher la
// ville d'un colis remis par un bon d'envoi :
//   - bon vers un hub → les agences que ce hub a absorbées ; un nom qui est
//     encore lui-même une agence (base pas encore regroupée) se renvoie seul ;
//   - bon remis directement au transporteur → toutes ses agences.
export function agencesARechercher(params: { hubNom: string | null; prestataire: string }): string[] {
  if (params.hubNom) {
    const hub = PAR_NOM.get(params.hubNom);
    if (hub) return hub.agences.map((a) => a.nom);
    if (PAR_AGENCE.has(params.hubNom)) return [params.hubNom];
    return [];
  }
  return HUBS_REGIONAUX.filter((h) => h.prestataire === params.prestataire).flatMap((h) => h.agences.map((a) => a.nom));
}

// Résout une ville en essayant chaque agence candidate avec le résolveur du
// transporteur (`resoudreVilleMeta(agence, ville)`…). Une seule réponse
// distincte → elle ; aucune, ou plusieurs qui DIFFÈRENT (deux identifiants de
// ville chez le transporteur) → `null`, et la remise renvoie ce colis à
// l'Excel plutôt que de deviner.
export function resoudreParAgences<T>(
  agences: string[],
  ville: string,
  resoudre: (agence: string, ville: string) => T | null,
  cle: (resultat: T) => string
): { resultat: T; agence: string } | null {
  const trouves = new Map<string, { resultat: T; agence: string }>();
  for (const agence of agences) {
    const r = resoudre(agence, ville);
    if (r !== null && r !== undefined && !trouves.has(cle(r))) trouves.set(cle(r), { resultat: r, agence });
  }
  return trouves.size === 1 ? [...trouves.values()][0] : null;
}
