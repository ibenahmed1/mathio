import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ErreurPlateforme } from '@/lib/plateforme-auth';
import { deciderTransitionStatut, ecrireTransition } from '@/lib/livraison-statut';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';
import { codeEffectifWebhook, paiementPower, sortStatutPower } from '@/lib/power-delivery-statuts';
import { NOM_PRESTATAIRE_POWER, prestatairePower } from '@/lib/remise-power-delivery';

// § Sous-traitance Power Delivery — ce qu'ils nous disent de nos colis.
//
// DEUX SOURCES, UNE SEULE RÈGLE. Leurs webhooks (POST /api/v1/webhooks/
// power-delivery) et notre propre suivi (`trackparcel`, bouton « Actualiser »
// ou rattrapage planifié) arrivent tous deux dans `traiterInformationPower`,
// qui passe par la même décision que notre API de statuts
// (deciderTransitionStatut, lib/livraison-statut.ts) : idempotence d'abord,
// colis clos ensuite, verrou optimiste en base.
//
// TOUT EST JOURNALISÉ, y compris ce qu'on refuse (EvenementPrestataire) :
// leurs webhooks n'ont aucun identifiant, trois tentatives seulement et un
// ordre non garanti. Le journal est la seule réponse à « qu'ont-ils dit ? ».

// --- Signature (PURE) --------------------------------------------------------

// HMAC-SHA256 du corps BRUT, en hexadécimal. Leur documentation montre deux
// formes de l'en-tête — hex nu dans l'exemple PHP, « sha256=… » dans l'exemple
// cURL — et on ne sait pas laquelle leurs serveurs envoient : les deux sont
// acceptées. La comparaison est en temps constant (timingSafeEqual), comme
// validateQrPayload (lib/parcel-serial.ts) : une comparaison ordinaire
// s'arrête au premier octet faux, et sa durée apprend la signature octet par
// octet à qui mesure.
//
// Le secret est OBLIGATOIRE chez nous, alors qu'il est optionnel chez eux :
// sans lui, n'importe qui pourrait poser « livré » sur nos colis — et « livré »
// est une écriture d'argent.
export function signatureValide(corpsBrut: string, entete: string | null, secret: string): boolean {
  if (!secret || !entete) return false;
  const recue = entete.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recue)) return false;
  const attendue = createHmac('sha256', secret).update(corpsBrut, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(recue, 'hex'), Buffer.from(attendue, 'hex'));
}

// Fenêtre de fraîcheur. Leur en-tête X-Webhook-Timestamp n'est PAS couvert par
// la signature ; le `timestamp` du corps, lui, l'est — c'est donc lui qu'on
// lit. Sans ce contrôle, un webhook intercepté resterait rejouable à vie.
export const FENETRE_WEBHOOK_S = 600;

export function horodatagePerime(timestampS: number, maintenant: Date): boolean {
  return Math.abs(maintenant.getTime() / 1000 - timestampS) > FENETRE_WEBHOOK_S;
}

// --- Lecture du webhook (PURE) -----------------------------------------------

export interface WebhookPower {
  timestamp: number;
  code: string;
  statut: string;
  statutSecond: string | null;
  paiement: string | null;
}

export function analyserWebhookPower(corps: unknown): WebhookPower | null {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return null;
  const racine = corps as Record<string, unknown>;
  const parcel = racine.parcel as Record<string, unknown> | undefined;
  if (!parcel || typeof parcel !== 'object') return null;

  const timestamp = typeof racine.timestamp === 'number' ? racine.timestamp : Number(racine.timestamp);
  const code = typeof parcel.code === 'string' ? parcel.code.trim() : '';
  const statut = typeof parcel.status === 'string' ? parcel.status.trim() : '';
  if (!Number.isFinite(timestamp) || !code || !statut) return null;

  const second = typeof parcel.status_second === 'string' ? parcel.status_second.trim() : '';
  return {
    timestamp,
    code,
    statut,
    statutSecond: second || null,
    paiement: paiementPower(parcel.payment_status),
  };
}

// --- Application --------------------------------------------------------------

export type IssueInformation =
  | 'applique'
  | 'inchange'
  | 'memorise'
  | 'inconnu'
  | 'refuse'
  | 'colis_introuvable';

export interface InformationPower {
  source: 'webhook' | 'suivi';
  code: string;
  statut: string | null;
  statutSecond: string | null;
  paiement: string | null;
  charge: unknown;
  signatureValide: boolean | null;
}

export interface ResultatInformation {
  issue: IssueInformation;
  detail: string | null;
  commandeId: string | null;
}

// Compte de service qui signe les statuts posés au nom de Power : la colonne
// d'auteur de l'historique est non nullable, et une machine n'est personne.
// C'est le compte machine du prestataire (PlateformePartenaire.prestataireId),
// créé depuis /admin/integrations — sans clé d'API : Power ne nous appelle
// pas avec une de nos clés, il nous pousse des webhooks signés.
async function compteServicePower(prestataireId: string): Promise<string> {
  const compte = await prisma.plateformePartenaire.findUnique({
    where: { prestataireId },
    select: { utilisateurTechniqueId: true },
  });
  if (!compte) {
    throw new ApiError(
      500,
      `Aucun compte machine pour ${NOM_PRESTATAIRE_POWER} : le créer depuis /admin/integrations en le rattachant au transporteur`
    );
  }
  return compte.utilisateurTechniqueId;
}

async function journaliser(
  prestataireId: string,
  remiseId: string | null,
  info: InformationPower,
  issue: string,
  detail: string | null
): Promise<void> {
  await prisma.evenementPrestataire.create({
    data: {
      prestataireId,
      remiseId,
      source: info.source,
      codeColis: info.code,
      statutExterne: info.statut,
      statutSecond: info.statutSecond,
      paiementExterne: info.paiement,
      charge: (info.charge ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      signatureValide: info.signatureValide,
      issue,
      detail,
    },
  });
}

// Journalise un webhook REJETÉ avant toute recherche de colis (signature
// invalide, horodatage périmé, corps illisible) : c'est précisément ce qu'il
// faut voir en cas de tentative de falsification ou de secret mal configuré.
export async function journaliserRejetWebhook(
  charge: unknown,
  signature: boolean,
  issue: 'signature_invalide' | 'perime' | 'corps_invalide',
  detail: string
): Promise<void> {
  const power = await prestatairePower();
  await prisma.evenementPrestataire.create({
    data: {
      prestataireId: power.id,
      source: 'webhook',
      charge: (charge ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      signatureValide: signature,
      issue,
      detail,
    },
  });
}

export async function traiterInformationPower(info: InformationPower): Promise<ResultatInformation> {
  const power = await prestatairePower();

  // La remise ACTIVE qui porte ce code — le nôtre (MTH-…) ou le leur s'ils en
  // ont attribué un. Une remise refusée ou annulée ne reçoit plus rien : un
  // statut tardif sur un colis retiré de chez eux ne doit pas le rouvrir.
  const code = info.code.trim();
  const remise = await prisma.remisePrestataire.findFirst({
    where: {
      prestataireId: power.id,
      active: true,
      OR: [{ codeEnvoye: { equals: code, mode: 'insensitive' } }, { codeExterne: { equals: code, mode: 'insensitive' } }],
    },
    select: {
      id: true,
      etat: true,
      codeEnvoye: true,
      commande: { select: { id: true, statut: true } },
    },
  });

  if (!remise) {
    await journaliser(power.id, null, info, 'colis_introuvable', 'Aucune remise active ne porte ce code');
    return { issue: 'colis_introuvable', detail: null, commandeId: null };
  }

  // L'état externe est mémorisé QUOI QU'IL ARRIVE ensuite — y compris leur
  // logistique interne, jamais posée sur le colis. Une information reçue
  // prouve aussi que le colis existe chez eux : une remise `a_confirmer`
  // (création restée sans réponse) passe `acceptee`.
  const codeEffectif = info.statut ? codeEffectifWebhook(info.statut, info.statutSecond) : null;
  await prisma.remisePrestataire.update({
    where: { id: remise.id },
    data: {
      ...(codeEffectif && { dernierStatutExterne: codeEffectif }),
      ...(info.paiement && { dernierPaiementExterne: info.paiement }),
      dernierEvenementLe: new Date(),
      ...(remise.etat === 'a_confirmer' && { etat: 'acceptee', erreur: null }),
    },
  });

  const conclure = async (issue: IssueInformation, detail: string | null): Promise<ResultatInformation> => {
    await journaliser(power.id, remise.id, info, issue, detail);
    return { issue, detail, commandeId: remise.commande.id };
  };

  if (!codeEffectif) return conclure('memorise', 'Aucun statut de livraison dans l’information reçue');

  const sort = sortStatutPower(codeEffectif);
  if (sort.sort === 'inconnu') return conclure('inconnu', `Code « ${codeEffectif} » inconnu : non appliqué`);
  if (sort.sort === 'memoriser') return conclure('memorise', `« ${codeEffectif} » : leur logistique interne`);

  const decision = deciderTransitionStatut(remise.commande.statut, sort.statut);
  if (decision.issue === 'inchange') return conclure('inchange', null);
  if (decision.issue === 'refuse') return conclure('refuse', decision.message);

  const auteurId = await compteServicePower(power.id);
  try {
    const issue = await ecrireTransition({
      commandeId: remise.commande.id,
      statutActuel: remise.commande.statut,
      nouveauStatut: sort.statut,
      auteurId,
      noteHistorique: `${LABELS_STATUT_COMMANDE[sort.statut]} — déclaré par ${NOM_PRESTATAIRE_POWER} (${codeEffectif}, ${info.source})`,
      // Aucune date de nouvelle tentative : ni leurs webhooks ni leur suivi
      // n'en portent. Un « reporté » arrive donc sans date — accepté pour ce
      // canal, sur décision du 21/09/2026, plutôt que refusé à chaque fois.
      dateNouvelleLivraison: null,
      commentaire: null,
    });
    return conclure(issue, null);
  } catch (erreur) {
    if (!(erreur instanceof ErreurPlateforme)) throw erreur;
    return conclure('refuse', erreur.message);
  }
}
