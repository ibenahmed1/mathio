import type { StatutCommande } from '@/app/generated/prisma/enums';
import { normaliserVille } from '@/lib/hub-stock';

// § Sous-traitance Colivraison — traduction de LEURS états vers nos statuts.
//
// LEURS ÉTATS SONT DES LIBELLÉS, pas des codes : « Expédié », « Prèt pour
// expédition » (sic), « Collecté par agence principale », « Nouveau »… Leur
// documentation ne donne QUE ces quatre-là, tous logistiques ; la liste
// complète n'est publiée nulle part. On compare donc des libellés repliés
// (casse, accents, ponctuation — `normaliserVille` fait exactement ça), par
// règles ordonnées et ancrées : « Livré » doit appliquer `livre`, « Non livré »
// ne le doit surtout pas.
//
// TROIS SORTS, comme pour Power Delivery (lib/power-delivery-statuts.ts) :
//   · `appliquer`  — la livraison et ses échecs, la mise en distribution, le
//                    retour : ce qui intéresse le marchand et nos relances ;
//   · `retour`     — « retour », « en retour » : leur DÉCLARATION, notée sur
//                    la remise, jamais posée sur le colis (décidé le
//                    11/10/2026, cf. lib/retour-transporteur.ts) ;
//   · `memoriser`  — leur logistique interne : gardée sur la remise, jamais
//                    posée sur le colis ;
//   · `inconnu`    — tout le reste. Journalisé, jamais appliqué. C'est le sort
//                    de tout libellé qu'on n'a pas encore vu : on complète ces
//                    règles en lisant le journal (EvenementPrestataire), on ne
//                    devine pas — « livré » est une écriture d'argent.

export type SortStatutColivraison =
  | { sort: 'appliquer'; statut: StatutCommande }
  | { sort: 'retour' }
  | { sort: 'memoriser' }
  | { sort: 'inconnu' };

// Ordre significatif : la première règle qui reconnaît le libellé l'emporte.
const A_APPLIQUER: readonly [RegExp, StatutCommande][] = [
  // Les négations d'abord : « non livré », « non livre » ne sont pas des
  // livraisons. Elles restent inconnues tant qu'on ne sait pas ce qu'elles
  // recouvrent chez eux (refus ? report ?).
  [/^livre( |$)/, 'livre'],
  [/^refuse?( |$)/, 'refuse'],
  [/^reporte?( |$)/, 'reporte'],
  [/^programme?( |$)/, 'programme'],
  [/^annule?( |$)/, 'annule'],
  [/^(mis|mise) en distribution( |$)/, 'mise_en_distribution'],
  [/^en (cours de )?distribution( |$)/, 'mise_en_distribution'],
  [/^en cours de livraison( |$)/, 'mise_en_distribution'],
  [/^injoignable( |$)/, 'injoignable'],
  [/^hors zone( |$)/, 'hors_zone'],
  [/^boite vocale?( |$)/, 'boite_vocale'],
  [/^numero (errone|incorrect|faux)( |$)/, 'numero_errone'],
];

// « Il nous le renvoie » : une parole, pas un fait — le colis garde son statut
// jusqu'à notre scan de réception au hub.
const RETOURS_DECLARES: readonly RegExp[] = [/^retour(ne)?( |$)/, /^en retour( |$)/];

const A_MEMORISER: readonly RegExp[] = [
  // Premier état RÉEL d'un colis créé par l'API (relevé du 01/10/2026) ; leur
  // doc annonçait « Nouveau ».
  /^ajoute[r]?( |$)/,
  /^nouveau( |$)/,
  /^collecte( |$)/,
  /^ramasse( |$)/,
  /^pret pour expedition( |$)/,
  /^expedie( |$)/,
  /^en voyage( |$)/,
  /^recu( |$)/,
  /^en attente( |$)/,
];

// « Prèt pour expédition » : `normaliserVille` replie aussi l'accent grave.
function replier(libelle: string): string {
  return normaliserVille(libelle).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sortStatutColivraison(libelle: string): SortStatutColivraison {
  const cle = replier(libelle);
  if (!cle) return { sort: 'inconnu' };
  if (/^non /.test(cle)) return { sort: 'inconnu' };
  for (const [motif, statut] of A_APPLIQUER) {
    if (motif.test(cle)) return { sort: 'appliquer', statut };
  }
  if (RETOURS_DECLARES.some((motif) => motif.test(cle))) return { sort: 'retour' };
  if (A_MEMORISER.some((motif) => motif.test(cle))) return { sort: 'memoriser' };
  return { sort: 'inconnu' };
}
