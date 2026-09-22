import type { StatutCommande } from '@/app/generated/prisma/enums';

// § Sous-traitance Power Delivery — traduction de LEURS statuts vers les nôtres.
//
// UN VOCABULAIRE PRESQUE IDENTIQUE, et c'est un piège autant qu'une aubaine.
// Les libellés de leur `GET liststatus` sont mot pour mot ceux de nos 27 valeurs
// d'origine (« Boite Vocal », « Numero_Erroné » compris) : les deux systèmes
// descendent de la même famille de logiciels. La correspondance se lit donc
// terme à terme — mais un même mot ne veut pas toujours dire la même chose
// quand le colis est chez eux. « Retourné », chez eux, c'est « il nous le
// renvoie » ; chez nous `retourne` est TERMINAL et veut dire « rendu au
// marchand ». Le poser à leur signal clôturerait un colis encore sur la route.
//
// LEUR DOCUMENTATION MENT SUR LES CODES. Elle annonce HORS_ZONE, CANCELLED,
// ENVG ; leur API répond OUT_OF_AREA, CANCELED, EN_VOYAGE (relevé du
// 21/09/2026). Les deux graphies sont acceptées : on ne sait pas laquelle leurs
// webhooks emploient, et un code reconnu à tort est moins grave qu'un colis
// livré qu'on laisse filer.
//
// TROIS SORTS, décidés le 22/09/2026 :
//   · `appliquer`  — la livraison (livré, refusé, reporté, injoignable…), la
//                    mise en distribution et le retour : ce qui intéresse le
//                    marchand et nos files de relance ;
//   · `memoriser`  — leur logistique interne (ramassé, expédié, en voyage…) :
//                    gardée sur la remise pour le support, jamais posée sur le
//                    colis, dont l'historique n'a pas à raconter LEURS étapes ;
//   · `inconnu`    — tout le reste. Journalisé, jamais appliqué : un code
//                    qu'on ne connaît pas ne se devine pas.

export type SortStatutPower =
  | { sort: 'appliquer'; statut: StatutCommande }
  | { sort: 'memoriser' }
  | { sort: 'inconnu' };

const A_APPLIQUER: Readonly<Record<string, StatutCommande>> = {
  DELIVERED: 'livre',
  REFUSE: 'refuse',
  POSTPONED: 'reporte',
  PROGRAMMER: 'programme',
  // « Pas de réponse + SMS » chez eux : c'est EUX qui envoient le SMS. La
  // raison qui écarte `pas_de_reponse_sms` de notre API de statuts (un canal
  // que nous seuls opérons) ne vaut donc pas ici.
  NOANSWER: 'pas_de_reponse_sms',
  // « Injoignable » chez eux — et non « lieu inaccessible » comme ailleurs sur
  // le marché : leur hors-zone a son propre code.
  UNREACHABLE: 'injoignable',
  OUT_OF_AREA: 'hors_zone',
  HORS_ZONE: 'hors_zone',
  DEUX: 'deuxieme_appel_pas_reponse',
  TROIS: 'troisieme_appel_pas_reponse',
  BV: 'boite_vocale',
  ERR: 'numero_errone',
  CLIENT_INTERESE: 'client_interesse',
  // Terminal chez nous. Le colis reste pourtant exploitable : le bon de retour
  // l'accepte, et une relivraison demandée par nous le rouvre d'abord
  // (cf. lib/actions-power-delivery.ts).
  CANCELED: 'annule',
  CANCELLED: 'annule',
  DISTRIBUTION: 'mise_en_distribution',
  // « Il nous le renvoie » : le colis n'est pas rendu au marchand, il est sur
  // la route du retour. `retourne_au_hub` ne viendra qu'à notre scan.
  RETURNED: 'en_retour_par_amana',
  RETURN_BY_AMANA: 'en_retour_par_amana',
};

const A_MEMORISER: ReadonlySet<string> = new Set([
  'NEW_PARCEL',
  'WAITING_PICKUP',
  'PICKED_UP',
  'SENT',
  'RECEIVED',
  // Statut PRINCIPAL dont le détail vit dans le secondaire (cf.
  // codeEffectifWebhook) : seul, il ne dit rien d'exploitable.
  'IN_PROGRESS',
  'EN_VOYAGE',
  'ENVG',
  'SENT_BY_AMANA',
  // Leur call-center relance ; le nôtre a ses propres files. Poser ces valeurs
  // ferait entrer le colis dans NOS relances pour un travail qui est le leur.
  'RELENCE_NEW_CLIENT',
  'WAIT_RELANCE',
  // Le vendeur, c'est nous : l'annulation vient de notre côté, et elle est
  // déjà posée par l'action qui l'a déclenchée.
  'CANCELED_BY_VENDEUR',
]);

export function sortStatutPower(code: string): SortStatutPower {
  const normalise = code.trim().toUpperCase();
  const statut = A_APPLIQUER[normalise];
  if (statut) return { sort: 'appliquer', statut };
  if (A_MEMORISER.has(normalise)) return { sort: 'memoriser' };
  return { sort: 'inconnu' };
}

// Leurs webhooks portent DEUX niveaux : `status` (l'étape) et `status_second`
// (le détail). Exemples de leur documentation : IN_PROGRESS + REFUSE pour un
// refus, IN_PROGRESS + POSTPONED pour un report, DELIVERED + "" pour une
// livraison. Le détail l'emporte, SAUF quand l'étape est une issue — un colis
// livré ou retourné ne redevient pas « reporté » parce qu'un motif antérieur
// traîne encore dans le champ secondaire.
const ETAPES_QUI_PRIMENT: ReadonlySet<string> = new Set(['DELIVERED', 'RETURNED']);

export function codeEffectifWebhook(status: string, statusSecond: string | null | undefined): string {
  const principal = status.trim().toUpperCase();
  const detail = (statusSecond ?? '').trim().toUpperCase();
  if (!detail || ETAPES_QUI_PRIMENT.has(principal)) return principal;
  return detail;
}

// Statuts de PAIEMENT (NOT_PAID, PAID, INVOICED) : ils disent si Power nous a
// reversé le COD. Ils ne touchent JAMAIS `Commande.etatPaiement`, qui décrit
// notre règlement AU MARCHAND — deux dettes différentes, dans deux sens.
export type PaiementPower = 'NOT_PAID' | 'PAID' | 'INVOICED';

export function paiementPower(valeur: unknown): PaiementPower | null {
  if (typeof valeur !== 'string') return null;
  const v = valeur.trim().toUpperCase();
  return v === 'NOT_PAID' || v === 'PAID' || v === 'INVOICED' ? v : null;
}
