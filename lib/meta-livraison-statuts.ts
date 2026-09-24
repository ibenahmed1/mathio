import { createHmac, timingSafeEqual } from 'node:crypto';

import type { StatutCommande } from '@/app/generated/prisma/enums';
import { NOTE_MAX } from '@/lib/livraison-statut';

// § Sous-traitance Meta Livraison — ce que leur webhook nous dit, traduit dans
// ce que notre API de suivi accepte.
//
// LE PRINCIPE : ce module ne décide RIEN du colis. Il transforme un événement
// Meta en corps `{ codeSuivi, statut, date, note }` — exactement celui qu'un
// transporteur enverrait à `POST /api/v1/livraisons/statut` — et le webhook le
// fait passer par `analyserEntreeStatut` puis `appliquerStatut`
// (lib/livraison-statut.ts). Périmètre, colis clos, idempotence, forme ISO des
// dates, verrou optimiste : tout vient du module existant, rien n'est recopié.
//
// DEUX TRAITEMENTS SEULEMENT :
//   · `applique` — l'issue de terrain a un équivalent dans NOTRE liste blanche
//     (`CATALOGUE_STATUTS_PRESTATAIRE`, lib/statuts.ts). Poser un statut hors de
//     cette liste reviendrait à laisser un tiers réécrire notre circuit.
//   · `journal`  — tout le reste est ENREGISTRÉ (table des événements) mais ne
//     touche pas au colis : leur logistique interne, leurs états de paiement,
//     leurs retours (clos chez nous par NOTRE scan de réception, § API_PARTENAIRES
//     §6.5), et les issues sans équivalent. Rien n'est perdu ; rien n'est
//     inventé.
//
// Catalogue relevé par `GET /partner/statuses` le 21/09/2026 : 45 codes. Un
// code absent d'ici (ajouté par eux plus tard) tombe en `journal` — jamais en
// erreur, pour qu'un ajout de leur côté ne fasse pas échouer leurs envois.

export type TraitementMeta =
  | {
      traitement: 'applique';
      statut: StatutCommande;
      // `planifiee` : la date vient de leur `scheduledAt` (POSTPONED,
      // PROGRAMMER — leur doc ne l'envoie que pour ces deux-là).
      // `jour` : « reporté / programmé AUJOURD'HUI », sans `scheduledAt` —
      // la date est celle de l'événement.
      date?: 'planifiee' | 'jour';
    }
  | { traitement: 'journal'; raison: string };

const INTERNE = 'leur circuit logistique interne';
const RETOUR = 'retour : clos chez nous par le scan de réception, pas par leur message';
const PAIEMENT = 'état de paiement : sans montant, conservé pour la réconciliation';

export const STATUTS_META: Readonly<Record<string, TraitementMeta>> = {
  // --- Issues qui ferment le colis
  DELIVERED: { traitement: 'applique', statut: 'livre' },
  REFUSE: { traitement: 'applique', statut: 'refuse' },
  CANCELED: { traitement: 'applique', statut: 'annule' },
  OUT_OF_AREA: { traitement: 'applique', statut: 'hors_zone' },

  // --- Nouvelles tentatives
  POSTPONED: { traitement: 'applique', statut: 'reporte', date: 'planifiee' },
  REPORTE_AUJOURDHUI: { traitement: 'applique', statut: 'reporte', date: 'jour' },
  PROGRAMMER: { traitement: 'applique', statut: 'programme', date: 'planifiee' },
  PROGRAMMER_TODAY: { traitement: 'applique', statut: 'programme', date: 'jour' },
  UNREACHABLE: { traitement: 'applique', statut: 'injoignable' },
  // « Pas de réponse + SMS » — posé en `injoignable`, JAMAIS en
  // `pas_de_reponse_sms` : ce dernier atteste une relance SMS que NOUS
  // opérons (cf. le commentaire de DEFINITIONS_STATUTS_PRESTATAIRE).
  NOANSWER: { traitement: 'applique', statut: 'injoignable' },
  BV: { traitement: 'applique', statut: 'boite_vocale' },
  DEUX: { traitement: 'applique', statut: 'deuxieme_appel_pas_reponse' },
  TROIS: { traitement: 'applique', statut: 'troisieme_appel_pas_reponse' },
  ERR: { traitement: 'applique', statut: 'numero_errone' },
  CLIENT_INTERESSE: { traitement: 'applique', statut: 'client_interesse' },

  // --- Sans équivalent dans notre liste blanche
  // FAUX AMI : chez eux « En voyage » est une issue d'appel (le client est en
  // voyage) ; notre `en_voyage` décrit un colis en route. Le poser ferait
  // croire à un colis reparti.
  EN_VOYAGE: { traitement: 'journal', raison: 'faux ami : le client est en voyage, pas le colis' },
  PROGRAMMER_AUTO: { traitement: 'journal', raison: 'programmation automatique, sans date garantie' },
  INCORRECT_ADDRESS: { traitement: 'journal', raison: 'aucun équivalent dans notre liste blanche' },
  RELENCE_NEW_CLIENT: { traitement: 'journal', raison: 'relance commerciale, hors liste blanche' },
  WAIT_RELANCE: { traitement: 'journal', raison: 'relance commerciale, hors liste blanche' },
  CANCELED_BY_VENDEUR: { traitement: 'journal', raison: 'annulation émise par nous-mêmes (le vendeur, c’est Mathio)' },

  // --- Retours
  RETURNED: { traitement: 'journal', raison: RETOUR },
  PREPARED_FOR_RETOURNE: { traitement: 'journal', raison: RETOUR },
  SENT_TO_VENDOR: { traitement: 'journal', raison: RETOUR },
  RETURNED_TO_VENDOR: { traitement: 'journal', raison: RETOUR },
  RETURN_BY_AMANA: { traitement: 'journal', raison: RETOUR },
  RETURNED_TO_STOCK: { traitement: 'journal', raison: RETOUR },

  // --- Paiement
  NOT_PAID: { traitement: 'journal', raison: PAIEMENT },
  PAID: { traitement: 'journal', raison: PAIEMENT },
  INVOICED: { traitement: 'journal', raison: PAIEMENT },

  // --- Leur logistique
  NEW_PARCEL: { traitement: 'journal', raison: INTERNE },
  WAITING_PICKUP: { traitement: 'journal', raison: INTERNE },
  PICKED_UP: { traitement: 'journal', raison: INTERNE },
  PICKED_UP_IN_AGENCY: { traitement: 'journal', raison: INTERNE },
  VALID_FOR_PREPARING: { traitement: 'journal', raison: INTERNE },
  SENT: { traitement: 'journal', raison: INTERNE },
  RECEIVED: { traitement: 'journal', raison: INTERNE },
  RECEIVED_IN_AGENCY: { traitement: 'journal', raison: INTERNE },
  RECEIVED_BY_AGENCY: { traitement: 'journal', raison: INTERNE },
  SENT_TO_AGENCY: { traitement: 'journal', raison: INTERNE },
  SENT_BY_AMANA: { traitement: 'journal', raison: INTERNE },
  DISTRIBUTION: { traitement: 'journal', raison: INTERNE },
  IN_PROGRESS: { traitement: 'journal', raison: INTERNE },
  IN_AGENCY: { traitement: 'journal', raison: INTERNE },
  OUT_FOR_DELIVERY: { traitement: 'journal', raison: INTERNE },
};

export const EVENEMENT_STATUT_META = 'parcel.status.updated';

// --- Signature ---------------------------------------------------------------

// `X-MetaLivraison-Signature: sha256=<hmac>` — HMAC-SHA256 du corps BRUT, tel
// que reçu : un JSON relu puis resérialisé change l'ordre des clés et invalide
// le calcul. Leur doc ne dit pas l'encodage du condensat ; l'hexadécimal est
// l'usage, la base64 est acceptée aussi — à resserrer quand ils l'auront
// confirmé. Comparaison à temps constant : un `===` laisserait deviner la
// signature octet par octet au temps de réponse.
export function signatureMetaValide(corpsBrut: string, entete: string | null, secret: string): boolean {
  if (!secret || !entete) return false;
  const recue = entete.trim().replace(/^sha256=/i, '');
  if (!recue || recue === entete.trim()) return false;

  const hmac = createHmac('sha256', secret).update(corpsBrut, 'utf8').digest();
  return [hmac.toString('hex'), hmac.toString('base64')].some((attendue) => {
    const a = Buffer.from(attendue);
    const b = Buffer.from(recue);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

// --- Lecture de l'événement --------------------------------------------------

export interface EvenementMeta {
  // `X-MetaLivraison-Delivery` porte l'identifiant de LIVRAISON (stable entre
  // leurs tentatives) ; `id` du corps est celui de l'ÉVÉNEMENT. Le webhook
  // dédoublonne sur le premier et conserve le second.
  id: string;
  evenement: string;
  survenuLe: string | null;
  code: string;
  statut: string;
  statutPrecedent: string | null;
  libelle: string | null;
  planifieLe: string | null;
  livreurNom: string | null;
  livreurTelephone: string | null;
}

function texte(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : null;
}

// `null` = corps illisible. Seuls `code` et `status` sont exigés : le reste est
// facultatif chez eux (le livreur n'est envoyé qu'aux magasins autorisés).
export function analyserEvenementMeta(corps: unknown): EvenementMeta | null {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return null;
  const racine = corps as Record<string, unknown>;
  const data = racine.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;

  const code = texte(d.code);
  const statut = texte(d.status);
  if (!code || !statut) return null;

  return {
    id: texte(racine.id) ?? '',
    evenement: texte(racine.event) ?? '',
    survenuLe: texte(racine.occurredAt),
    code: code.toUpperCase(),
    statut: statut.toUpperCase(),
    statutPrecedent: texte(d.previousStatus),
    libelle: texte(d.statusLabel),
    planifieLe: texte(d.scheduledAt),
    livreurNom: texte(d.delivererName),
    livreurTelephone: texte(d.delivererPhone),
  };
}

// --- Traduction --------------------------------------------------------------

export type TraductionMeta =
  | {
      issue: 'applique';
      // Corps au format de `POST /api/v1/livraisons/statut`, à valider par
      // `analyserEntreeStatut` — volontairement du texte brut, pas un
      // `EntreeStatut` déjà construit.
      corps: { codeSuivi: string; statut: StatutCommande; date?: string; note: string };
    }
  | { issue: 'journal'; raison: string };

// La note d'historique dit d'où vient le statut et qui l'a posé. Le livreur
// y figure quand ils l'envoient : c'est la personne à rappeler si le
// destinataire conteste. Tronquée à la limite de l'historique.
function note(evt: EvenementMeta): string {
  const livreur = [evt.livreurNom, evt.livreurTelephone].filter(Boolean).join(' ');
  const brut = `Meta : ${evt.libelle ?? evt.statut}${livreur ? ` · livreur ${livreur}` : ''}`;
  return brut.slice(0, NOTE_MAX);
}

export function traduireEvenementMeta(evt: EvenementMeta): TraductionMeta {
  if (evt.evenement && evt.evenement !== EVENEMENT_STATUT_META) {
    return { issue: 'journal', raison: `événement non traité : ${evt.evenement}` };
  }
  const regle = STATUTS_META[evt.statut];
  if (!regle) return { issue: 'journal', raison: 'statut absent de leur catalogue relevé' };
  if (regle.traitement === 'journal') return { issue: 'journal', raison: regle.raison };

  const corps: { codeSuivi: string; statut: StatutCommande; date?: string; note: string } = {
    codeSuivi: evt.code,
    statut: regle.statut,
    note: note(evt),
  };

  if (regle.date === 'planifiee') {
    // Sans `scheduledAt`, on ne fabrique pas de date : un report sans date
    // n'entrerait pas dans la file de relance au bon jour.
    if (!evt.planifieLe) return { issue: 'journal', raison: `${evt.statut} reçu sans scheduledAt` };
    corps.date = evt.planifieLe;
  } else if (regle.date === 'jour') {
    const jour = evt.planifieLe ?? evt.survenuLe;
    if (!jour) return { issue: 'journal', raison: `${evt.statut} reçu sans date d’événement` };
    corps.date = jour;
  }

  return { issue: 'applique', corps };
}
