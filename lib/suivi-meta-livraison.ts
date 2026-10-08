import { Prisma } from '@/app/generated/prisma/client';
import type { EtatRemisePrestataire } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ErreurPlateforme } from '@/lib/plateforme-auth';
import { deciderTransitionStatut, ecrireTransition } from '@/lib/livraison-statut';
import { ErreurMeta, suivreColisMeta } from '@/lib/meta-livraison';
import { type EvenementMeta, traduireEvenementMeta } from '@/lib/meta-livraison-statuts';
import { NOM_PRESTATAIRE_META, prestataireMeta } from '@/lib/remise-meta-livraison';

// § Sous-traitance Meta Livraison — ce qu'ils nous disent de nos colis.
//
// DEUX SOURCES, UNE SEULE DÉCISION : leur webhook `parcel.status.updated`
// (app/api/v1/webhooks/meta-livraison) et leur suivi, interrogé par le bouton
// « Actualiser ». Les deux traduisent par `traduireEvenementMeta`
// (lib/meta-livraison-statuts.ts, liste blanche) puis passent par
// `deciderTransitionStatut` + `ecrireTransition` (lib/livraison-statut.ts) :
// idempotence, colis clos, verrou optimiste — comme Power Delivery.
//
// Pas de table de dédoublonnage sur `X-MetaLivraison-Delivery` : un webhook
// rejoué retombe sur « inchangé » par l'idempotence, comme chez Power.
// L'identifiant de livraison est gardé dans le journal.

export type IssueInformation =
  | 'applique'
  | 'inchange'
  | 'memorise'
  | 'refuse'
  | 'colis_inconnu'
  | 'colis_introuvable';

export interface ResultatInformation {
  issue: IssueInformation;
  detail: string | null;
  commandeId: string | null;
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

export interface EtatMetaColis {
  remiseId: string;
  etat: EtatRemisePrestataire;
  codeEnvoye: string;
  codeExterne: string | null;
  montantCodConfie: number;
  dernierStatutExterne: string | null;
  dernierEvenementLe: Date | null;
  erreur: string | null;
  creeLe: Date;
}

// null = aucune remise : le colis n'est jamais passé chez eux.
export async function etatMetaDuColis(commandeId: string): Promise<EtatMetaColis | null> {
  const meta = await prestataireMeta();
  const remise = await prisma.remisePrestataire.findFirst({
    where: { commandeId, prestataireId: meta.id },
    orderBy: [{ active: 'desc' }, { creeLe: 'desc' }],
  });
  if (!remise) return null;
  return {
    remiseId: remise.id,
    etat: remise.etat,
    codeEnvoye: remise.codeEnvoye,
    codeExterne: remise.codeExterne,
    montantCodConfie: arrondi(Number(remise.montantCodConfie)),
    dernierStatutExterne: remise.dernierStatutExterne,
    dernierEvenementLe: remise.dernierEvenementLe,
    erreur: remise.erreur,
    creeLe: remise.creeLe,
  };
}

async function compteServiceMeta(prestataireId: string): Promise<string> {
  const compte = await prisma.plateformePartenaire.findUnique({
    where: { prestataireId },
    select: { utilisateurTechniqueId: true },
  });
  if (!compte) {
    throw new ApiError(
      500,
      `Aucun compte machine pour ${NOM_PRESTATAIRE_META} : le créer depuis /admin/integrations en le rattachant au transporteur`
    );
  }
  return compte.utilisateurTechniqueId;
}

interface Journal {
  prestataireId: string;
  remiseId: string | null;
  source: 'webhook' | 'suivi';
  code: string | null;
  statutExterne: string | null;
  charge: unknown;
  signatureValide: boolean | null;
  issue: string;
  detail: string | null;
}

async function journaliser(j: Journal): Promise<void> {
  await prisma.evenementPrestataire.create({
    data: {
      prestataireId: j.prestataireId,
      remiseId: j.remiseId,
      source: j.source,
      codeColis: j.code,
      statutExterne: j.statutExterne,
      charge: (j.charge ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      signatureValide: j.signatureValide,
      issue: j.issue,
      detail: j.detail,
    },
  });
}

// Webhook REJETÉ avant toute recherche de colis : à voir en cas de
// falsification ou de secret mal configuré.
export async function journaliserRejetWebhookMeta(
  charge: unknown,
  signature: boolean,
  issue: 'signature_invalide' | 'corps_invalide',
  detail: string
): Promise<void> {
  const meta = await prestataireMeta();
  await journaliser({
    prestataireId: meta.id,
    remiseId: null,
    source: 'webhook',
    code: null,
    statutExterne: null,
    charge,
    signatureValide: signature,
    issue,
    detail,
  });
}

export interface InformationMeta {
  source: 'webhook' | 'suivi';
  evenement: EvenementMeta;
  charge: unknown;
  signatureValide: boolean | null;
  // Identifiant de livraison (`X-MetaLivraison-Delivery`), pour le journal.
  livraisonId?: string | null;
}

// Applique un événement Meta au colis qu'il désigne. Ne lève que sur une panne
// chez nous ; tout le reste est une issue, journalisée.
export async function traiterInformationMeta(info: InformationMeta): Promise<ResultatInformation> {
  const meta = await prestataireMeta();
  const evt = info.evenement;
  const suffixe = info.livraisonId ? ` [livraison ${info.livraisonId}]` : '';

  const remise = await prisma.remisePrestataire.findFirst({
    where: {
      prestataireId: meta.id,
      active: true,
      OR: [
        { codeEnvoye: { equals: evt.code, mode: 'insensitive' } },
        { codeExterne: { equals: evt.code, mode: 'insensitive' } },
      ],
    },
    select: { id: true, etat: true, commande: { select: { id: true, statut: true } } },
  });

  const base = {
    prestataireId: meta.id,
    source: info.source,
    code: evt.code,
    statutExterne: evt.statut,
    charge: info.charge,
    signatureValide: info.signatureValide,
  };

  if (!remise) {
    await journaliser({ ...base, remiseId: null, issue: 'colis_inconnu', detail: `Aucune remise active sous ce code${suffixe}` });
    return { issue: 'colis_inconnu', detail: `${evt.code} : aucune remise active`, commandeId: null };
  }

  await prisma.remisePrestataire.update({
    where: { id: remise.id },
    data: {
      dernierStatutExterne: evt.statut,
      // Un message de leur part prouve que le colis existe chez eux.
      ...(remise.etat === 'a_confirmer' && { etat: 'acceptee', erreur: null }),
    },
  });

  const conclure = async (issue: IssueInformation, detail: string | null): Promise<ResultatInformation> => {
    await prisma.remisePrestataire.update({ where: { id: remise.id }, data: { dernierEvenementLe: new Date() } });
    await journaliser({ ...base, remiseId: remise.id, issue, detail: detail || suffixe ? `${detail ?? ''}${suffixe}`.trim() : null });
    return { issue, detail, commandeId: remise.commande.id };
  };

  const traduction = traduireEvenementMeta(evt);
  if (traduction.issue === 'journal') return conclure('memorise', `« ${evt.statut} » : ${traduction.raison}`);

  const { statut, date, note } = traduction.corps;
  const decision = deciderTransitionStatut(remise.commande.statut, statut);
  if (decision.issue === 'inchange') return conclure('inchange', null);
  if (decision.issue === 'refuse') return conclure('refuse', decision.message);

  const dateNouvelle = date ? new Date(date) : null;
  const auteurId = await compteServiceMeta(meta.id);
  try {
    const issue = await ecrireTransition({
      commandeId: remise.commande.id,
      statutActuel: remise.commande.statut,
      nouveauStatut: statut,
      auteurId,
      noteHistorique: note,
      dateNouvelleLivraison: dateNouvelle && !Number.isNaN(dateNouvelle.getTime()) ? dateNouvelle : null,
      commentaire: null,
    });
    return conclure(issue, null);
  } catch (erreur) {
    if (!(erreur instanceof ErreurPlateforme)) throw erreur;
    return conclure('refuse', erreur.message);
  }
}

// Bouton « Actualiser » : interroge leur suivi et applique ce qu'il dit.
export async function actualiserColisMeta(commandeId: string): Promise<ResultatInformation> {
  const meta = await prestataireMeta();
  const remise = await prisma.remisePrestataire.findFirst({
    where: { commandeId, prestataireId: meta.id, active: true },
    select: { id: true, codeEnvoye: true, codeExterne: true },
  });
  if (!remise) throw new ApiError(404, `Ce colis n'est pas confié à ${NOM_PRESTATAIRE_META}`);

  // NOTRE code d'abord : c'est celui que leur suivi est sûr de connaître.
  const code = remise.codeEnvoye;
  let suivi;
  try {
    suivi = await suivreColisMeta(code);
  } catch (erreur) {
    if (!(erreur instanceof ErreurMeta)) throw erreur;
    if (erreur.statutHttp === 404) {
      await journaliser({
        prestataireId: meta.id,
        remiseId: remise.id,
        source: 'suivi',
        code,
        statutExterne: null,
        charge: erreur.brut,
        signatureValide: null,
        issue: 'colis_introuvable',
        detail: erreur.message,
      });
      return { issue: 'colis_introuvable', detail: `${code} inconnu de leur suivi`, commandeId };
    }
    throw new ApiError(502, `${NOM_PRESTATAIRE_META} : ${erreur.message}`);
  }

  if (!suivi.statut) {
    await journaliser({
      prestataireId: meta.id,
      remiseId: remise.id,
      source: 'suivi',
      code,
      statutExterne: null,
      charge: suivi.brut,
      signatureValide: null,
      issue: 'memorise',
      detail: 'Aucun statut lisible dans leur réponse',
    });
    return { issue: 'memorise', detail: 'Aucun statut lisible dans leur réponse', commandeId };
  }

  return traiterInformationMeta({
    source: 'suivi',
    charge: suivi.brut,
    signatureValide: null,
    evenement: {
      id: '',
      evenement: '',
      survenuLe: new Date().toISOString(),
      code,
      statut: suivi.statut,
      statutPrecedent: null,
      libelle: suivi.libelle,
      planifieLe: suivi.planifieLe,
      livreurNom: suivi.livreurNom,
      livreurTelephone: suivi.livreurTelephone,
      injoignables: suivi.injoignables,
    },
  });
}
