import type { EtatRemisePrestataire, StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import {
  ErreurPowerDelivery,
  demanderRelivraisonPower,
  demanderRetourPower,
  modifierColisPower,
  suivreColisPower,
  type ModificationPower,
} from '@/lib/power-delivery';
import { resoudreVillePower } from '@/lib/power-delivery-villes';
import { NOM_PRESTATAIRE_POWER, prestatairePower } from '@/lib/remise-power-delivery';
import { traiterInformationPower, type ResultatInformation } from '@/lib/suivi-power-delivery';

// § Sous-traitance Power Delivery — ce qu'on peut faire d'un colis QU'ON LEUR A
// CONFIÉ, depuis sa fiche : consulter son état chez eux, l'actualiser, leur
// transmettre une correction, leur demander un retour ou une relivraison.
//
// Toutes exigent une remise ACTIVE : un colis refusé ou retiré de chez eux n'a
// rien à leur demander. Les demandes de retour et de relivraison sont soumises
// à LEUR équipe, qui les accepte ou les refuse de son côté : on trace la
// demande, pas une issue qu'on ne connaît pas encore.

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

export interface EtatPowerColis {
  remiseId: string;
  etat: EtatRemisePrestataire;
  codeEnvoye: string;
  codeExterne: string | null;
  montantCodConfie: number;
  dernierStatutExterne: string | null;
  dernierPaiementExterne: string | null;
  dernierEvenementLe: Date | null;
  demandeRetourLe: Date | null;
  demandeRelivraisonLe: Date | null;
  erreur: string | null;
  creeLe: Date;
}

async function remiseActive(commandeId: string) {
  const power = await prestatairePower();
  const remise = await prisma.remisePrestataire.findFirst({
    where: { commandeId, prestataireId: power.id, active: true },
  });
  if (!remise) throw new ApiError(404, `Ce colis n'est pas confié à ${NOM_PRESTATAIRE_POWER}`);
  return remise;
}

// Le code sous lequel LEUR système connaît le colis : le leur s'ils en ont
// attribué un, sinon celui qu'on a envoyé.
function codeChezEux(remise: { codeEnvoye: string; codeExterne: string | null }): string {
  return remise.codeExterne ?? remise.codeEnvoye;
}

// Une erreur de leur API devient une 502 lisible : c'est leur service qui a
// échoué, pas la requête de l'utilisateur. Le message ne contient jamais le
// token (cf. lib/power-delivery.ts).
function relayer(erreur: unknown): never {
  if (erreur instanceof ErreurPowerDelivery) {
    throw new ApiError(502, `${NOM_PRESTATAIRE_POWER} : ${erreur.message}`);
  }
  throw erreur;
}

// null = aucune remise, active ou non : le colis n'est jamais passé par Power.
export async function etatPowerDuColis(commandeId: string): Promise<EtatPowerColis | null> {
  const power = await prestatairePower();
  const remise = await prisma.remisePrestataire.findFirst({
    where: { commandeId, prestataireId: power.id },
    // La remise active d'abord, sinon la plus récente : c'est elle qui dit
    // pourquoi le colis n'est plus chez eux.
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
    dernierPaiementExterne: remise.dernierPaiementExterne,
    dernierEvenementLe: remise.dernierEvenementLe,
    demandeRetourLe: remise.demandeRetourLe,
    demandeRelivraisonLe: remise.demandeRelivraisonLe,
    erreur: remise.erreur,
    creeLe: remise.creeLe,
  };
}

export async function actualiserColisPower(commandeId: string): Promise<ResultatInformation> {
  const remise = await remiseActive(commandeId);
  const code = codeChezEux(remise);
  const suivi = await suivreColisPower(code).catch(relayer);
  return traiterInformationPower({
    source: 'suivi',
    code,
    statut: suivi.statut,
    statutSecond: null,
    paiement: suivi.paiement,
    charge: suivi.brut,
    signatureValide: null,
  });
}

// Transmet à Power l'état ACTUEL du colis chez nous : on corrige d'abord le
// colis dans l'application, puis on leur pousse la correction. Le sens est
// unique et délibéré — une modification saisie chez eux sans l'être chez nous
// laisserait les deux systèmes diverger.
//
// Le COD est un cas à part : c'est ce que Power nous doit. S'il a changé chez
// nous depuis la remise, le nouveau montant leur est transmis ET le montant
// confié de la remise est mis à jour, avec une trace dans les commentaires du
// colis — la dette change, elle ne doit pas changer en silence.
export async function modifierColisChezPower(commandeId: string, auteurId: string): Promise<{ champs: string[] }> {
  const remise = await remiseActive(commandeId);
  if (remise.etat !== 'acceptee') {
    throw new ApiError(409, 'La remise doit être acceptée par Power avant toute modification');
  }
  const commande = await prisma.commande.findUniqueOrThrow({
    where: { id: commandeId },
    select: {
      clientNom: true,
      clientTelephone: true,
      adresse: true,
      ouvrir: true,
      montantCod: true,
      ville: true,
      bonEnvoi: { select: { hubDestination: { select: { nom: true } } } },
    },
  });

  const montant = arrondi(Number(commande.montantCod));
  const ancienMontant = arrondi(Number(remise.montantCodConfie));
  const modification: ModificationPower = {
    parcel_receiver: commande.clientNom.trim(),
    parcel_phone: commande.clientTelephone.trim(),
    parcel_address: commande.adresse.trim(),
    parcel_open: commande.ouvrir ? 1 : 0,
    ...(montant !== ancienMontant && { parcel_price: montant }),
  };

  // Une ville corrigée chez nous se transmet par son identifiant — jamais par
  // son nom — et seulement si elle en a un dans la même agence.
  const agence = commande.bonEnvoi?.hubDestination?.nom;
  const ville = agence ? resoudreVillePower(agence, commande.ville) : null;
  if (ville && ville.cityId !== remise.cityId) modification.parcel_city = ville.cityId;

  await modifierColisPower(codeChezEux(remise), modification).catch(relayer);

  await prisma.$transaction(async (tx) => {
    await tx.remisePrestataire.update({
      where: { id: remise.id },
      data: {
        ...(modification.parcel_price !== undefined && { montantCodConfie: commande.montantCod }),
        ...(modification.parcel_city !== undefined && { cityId: modification.parcel_city }),
      },
    });
    const detail =
      modification.parcel_price !== undefined
        ? ` — COD confié modifié : ${ancienMontant} DH → ${montant} DH`
        : '';
    await tx.commentaireCommande.create({
      data: {
        commandeId,
        utilisateurId: auteurId,
        texte: `Correction transmise à ${NOM_PRESTATAIRE_POWER}${detail}`,
      },
    });
  });

  return { champs: Object.keys(modification) };
}

export async function demanderRetourChezPower(
  commandeId: string,
  raison: string | null,
  auteurId: string
): Promise<void> {
  const remise = await remiseActive(commandeId);
  await demanderRetourPower(codeChezEux(remise), raison).catch(relayer);
  await prisma.$transaction([
    prisma.remisePrestataire.update({ where: { id: remise.id }, data: { demandeRetourLe: new Date() } }),
    prisma.commentaireCommande.create({
      data: {
        commandeId,
        utilisateurId: auteurId,
        texte: `Retour demandé à ${NOM_PRESTATAIRE_POWER}${raison ? ` : ${raison}` : ''} — en attente de leur équipe`,
      },
    }),
  ]);
}

// Statut qui rouvre un colis ANNULÉ par Power quand on leur demande de le
// relivrer : « Remis à un transporteur », son statut de remise.
const STATUT_ROUVERT: StatutCommande = 'expedier_par_amana';

export interface DemandeRelivraison {
  raison: string | null;
  nouvelleAdresse: string | null;
  nouveauTelephone: string | null;
}

export interface ResultatRelivraison {
  rouvert: boolean;
}

// Leur API met à jour l'adresse et le téléphone chez eux dans le même geste :
// on les met à jour chez nous dans la même transaction, sinon les deux systèmes
// divergent dès la première relivraison.
//
// UN COLIS ANNULÉ EST ROUVERT. `annule` est terminal chez nous : sans cette
// étape, le prochain statut de Power (« livré » après la relivraison, par
// exemple) serait refusé comme colis clos. La règle des statuts terminaux
// n'est pas assouplie pour autant — c'est un geste HUMAIN, tracé dans
// l'historique, qui rouvre le colis, jamais un statut venu de l'extérieur.
// Seul `annule` se rouvre ainsi : un colis livré ou rendu au marchand n'a rien
// à relivrer.
export async function demanderRelivraisonChezPower(
  commandeId: string,
  demande: DemandeRelivraison,
  auteurId: string
): Promise<ResultatRelivraison> {
  const remise = await remiseActive(commandeId);
  await demanderRelivraisonPower(codeChezEux(remise), demande).catch(relayer);

  return prisma.$transaction(async (tx) => {
    const commande = await tx.commande.findUniqueOrThrow({
      where: { id: commandeId },
      select: { statut: true },
    });

    await tx.remisePrestataire.update({ where: { id: remise.id }, data: { demandeRelivraisonLe: new Date() } });
    if (demande.nouvelleAdresse || demande.nouveauTelephone) {
      await tx.commande.update({
        where: { id: commandeId },
        data: {
          ...(demande.nouvelleAdresse && { adresse: demande.nouvelleAdresse }),
          ...(demande.nouveauTelephone && { clientTelephone: demande.nouveauTelephone }),
        },
      });
    }

    let rouvert = false;
    if (commande.statut === 'annule') {
      // Même verrou optimiste que les transitions machine : si le statut a
      // bougé depuis la lecture, on ne rouvre rien.
      const { count } = await tx.commande.updateMany({
        where: { id: commandeId, statut: 'annule' },
        data: { statut: STATUT_ROUVERT },
      });
      if (count === 1) {
        rouvert = true;
        await tx.historiqueStatutCommande.create({
          data: {
            commandeId,
            ancienStatut: 'annule',
            nouveauStatut: STATUT_ROUVERT,
            utilisateurId: auteurId,
            note: `Colis rouvert : relivraison demandée à ${NOM_PRESTATAIRE_POWER}`,
          },
        });
      }
    }

    const changements = [
      demande.nouvelleAdresse && 'nouvelle adresse',
      demande.nouveauTelephone && 'nouveau téléphone',
    ].filter(Boolean);
    await tx.commentaireCommande.create({
      data: {
        commandeId,
        utilisateurId: auteurId,
        texte:
          `Relivraison demandée à ${NOM_PRESTATAIRE_POWER}` +
          (demande.raison ? ` : ${demande.raison}` : '') +
          (changements.length ? ` (${changements.join(', ')})` : '') +
          ' — en attente de leur équipe',
      },
    });

    return { rouvert };
  });
}
