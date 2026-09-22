import { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ErreurPlateforme } from '@/lib/plateforme-auth';
import { deciderTransitionStatut, ecrireTransition } from '@/lib/livraison-statut';
import {
  ErreurPowerDelivery,
  codePower,
  construireColisPower,
  creerColisPower,
} from '@/lib/power-delivery';
import { resoudreVillePower } from '@/lib/power-delivery-villes';

// § Sous-traitance Power Delivery — la REMISE d'un colis par leur API.
//
// Elle se fait depuis le BON D'ENVOI, parce que c'est lui qui la décide déjà
// aujourd'hui : un bon vers une agence Power fait partir les colis en transit,
// et son export Excel (GET /api/bons-envoi/[id]/export) est ce qu'on leur remet.
// La remise par l'API prend la place de l'Excel, au même endroit, pour les
// villes qui ont un identifiant chez eux ; l'Excel reste la voie des autres.
//
// LE LOT N'EST PAS ATOMIQUE, comme celui des statuts (lib/livraison-statut.ts) :
// un colis refusé par Power — ville inconnue d'eux, champ invalide — ne doit
// pas retenir les autres au quai. Chaque colis a son issue, et la réponse dit
// laquelle.
//
// L'ORDRE DES ÉCRITURES EST LA GARANTIE ANTI-DOUBLON. La remise est RÉSERVÉE en
// base (ligne `a_confirmer`, active) AVANT l'appel : l'index unique partiel
// « une remise active par colis » fait échouer le second de deux clics
// simultanés avant qu'il ait parlé à Power. Réserver après l'appel laisserait
// les deux créer le colis chez eux.

export const NOM_PRESTATAIRE_POWER = 'Power Delivery';

// Statuts depuis lesquels un colis peut être remis : il est parti vers
// l'agence (`en_transit`) ou y a été réceptionné (`recu_au_hub`). Tout autre
// statut dit que le colis n'est pas, ou plus, sur le chemin de Power.
const STATUTS_REMETTABLES: readonly StatutCommande[] = ['en_transit', 'recu_au_hub'];

// Statut posé à la remise. Son libellé est « Remis à un transporteur » : le nom
// du transporteur n'est pas dans l'enum, il est porté par la remise
// (cf. lib/statuts.ts).
const STATUT_REMIS: StatutCommande = 'expedier_par_amana';

export type IssueRemise =
  | 'remis'
  | 'a_confirmer'
  | 'refuse_par_power'
  | 'deja_remis'
  | 'ville_sans_correspondance'
  | 'statut_non_remettable';

export interface ResultatRemiseColis {
  commandeId: string;
  codeSuivi: string;
  issue: IssueRemise;
  message: string;
  codeEnvoye?: string;
  codeExterne?: string | null;
}

export interface ResultatRemiseBon {
  bonEnvoiId: string;
  numero: string;
  totalRemis: number;
  totalNonRemis: number;
  resultats: ResultatRemiseColis[];
}

// Le prestataire Power, par son nom — c'est la clé métier sur laquelle tout le
// référentiel l'identifie (scripts/import-prestataire-power-delivery.ts).
export async function prestatairePower(): Promise<{ id: string }> {
  const prestataire = await prisma.prestataire.findUnique({
    where: { nom: NOM_PRESTATAIRE_POWER },
    select: { id: true },
  });
  if (!prestataire) throw new ApiError(500, `Prestataire « ${NOM_PRESTATAIRE_POWER} » absent du référentiel`);
  return prestataire;
}

function estDoublonActif(erreur: unknown): boolean {
  return erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002';
}

export async function remettreBonEnvoiPower(bonEnvoiId: string, auteurId: string): Promise<ResultatRemiseBon> {
  const power = await prestatairePower();
  const bon = await prisma.bonEnvoi.findUnique({
    where: { id: bonEnvoiId },
    select: {
      id: true,
      numero: true,
      hubDestination: { select: { nom: true, prestataireId: true } },
      commandes: {
        select: {
          id: true,
          codeSuivi: true,
          statut: true,
          ville: true,
          clientNom: true,
          clientTelephone: true,
          adresse: true,
          montantCod: true,
          ouvrir: true,
          fragile: true,
          aRemplacer: true,
          produitDescription: true,
          quantite: true,
        },
        orderBy: { codeSuivi: 'asc' },
      },
    },
  });
  if (!bon) throw new ApiError(404, "Bon d'envoi introuvable");
  if (bon.hubDestination.prestataireId !== power.id) {
    throw new ApiError(400, `Ce bon d'envoi ne part pas vers une agence ${NOM_PRESTATAIRE_POWER}`);
  }

  const agence = bon.hubDestination.nom;
  const resultats: ResultatRemiseColis[] = [];

  // Un colis après l'autre, et non en parallèle : leur API n'annonce aucun
  // quota, et un bon compte quelques dizaines de colis au plus.
  for (const commande of bon.commandes) {
    const base = { commandeId: commande.id, codeSuivi: commande.codeSuivi };

    if (!STATUTS_REMETTABLES.includes(commande.statut)) {
      resultats.push({
        ...base,
        issue: 'statut_non_remettable',
        message: `Statut « ${commande.statut} » : seul un colis en transit ou reçu à l'agence peut être remis`,
      });
      continue;
    }

    // `null` = ville mise de côté ou hors contrat : jamais d'envoi par le nom.
    const ville = resoudreVillePower(agence, commande.ville);
    if (!ville) {
      resultats.push({
        ...base,
        issue: 'ville_sans_correspondance',
        message: `« ${commande.ville} » n'a pas d'identifiant ${NOM_PRESTATAIRE_POWER} : remise par l'Excel du bon`,
      });
      continue;
    }

    const codeEnvoye = codePower(commande.codeSuivi);
    let remiseId: string;
    try {
      const reservee = await prisma.remisePrestataire.create({
        data: {
          commandeId: commande.id,
          prestataireId: power.id,
          bonEnvoiId: bon.id,
          remisParId: auteurId,
          etat: 'a_confirmer',
          codeEnvoye,
          cityId: ville.cityId,
          montantCodConfie: commande.montantCod,
        },
        select: { id: true },
      });
      remiseId = reservee.id;
    } catch (erreur) {
      if (estDoublonActif(erreur)) {
        resultats.push({ ...base, issue: 'deja_remis', message: 'Ce colis a déjà une remise active', codeEnvoye });
        continue;
      }
      throw erreur;
    }

    let codeExterne: string | null = null;
    try {
      const creation = await creerColisPower(construireColisPower(commande, ville.cityId));
      codeExterne = creation.codeExterne;
      await prisma.remisePrestataire.update({
        where: { id: remiseId },
        data: {
          etat: 'acceptee',
          codeExterne,
          reponseCreation: (creation.brut ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch (erreur) {
      if (!(erreur instanceof ErreurPowerDelivery)) throw erreur;
      // Pas de réponse HTTP : on ne sait PAS si le colis existe chez eux. La
      // remise reste active et `a_confirmer` — le suivi tranchera — plutôt que
      // de libérer le colis pour une seconde remise qui créerait un doublon.
      const incertain = erreur.statutHttp === null;
      await prisma.remisePrestataire.update({
        where: { id: remiseId },
        data: {
          etat: incertain ? 'a_confirmer' : 'refusee',
          active: incertain,
          erreur: erreur.message,
          reponseCreation: (erreur.brut ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
      resultats.push({
        ...base,
        issue: incertain ? 'a_confirmer' : 'refuse_par_power',
        message: incertain
          ? `${erreur.message} — le colis existe peut-être chez eux : à confirmer par le suivi avant toute nouvelle remise`
          : erreur.message,
        codeEnvoye,
      });
      continue;
    }

    // Le colis existe chez eux : il passe « Remis à un transporteur », sous la
    // signature de la personne qui a remis. Une transition refusée (le colis a
    // bougé entre-temps) n'annule PAS la remise — le colis est bel et bien chez
    // Power — elle est seulement signalée.
    let message = `Remis à ${NOM_PRESTATAIRE_POWER} sous ${codeEnvoye}`;
    const decision = deciderTransitionStatut(commande.statut, STATUT_REMIS);
    if (decision.issue === 'applique') {
      try {
        await ecrireTransition({
          commandeId: commande.id,
          statutActuel: commande.statut,
          nouveauStatut: STATUT_REMIS,
          auteurId,
          noteHistorique: `Remis à ${NOM_PRESTATAIRE_POWER} par API sous ${codeEnvoye} (bon ${bon.numero})`,
          dateNouvelleLivraison: null,
          commentaire: null,
        });
      } catch (erreur) {
        if (!(erreur instanceof ErreurPlateforme)) throw erreur;
        message += ` — statut du colis non mis à jour : ${erreur.message}`;
      }
    }
    resultats.push({ ...base, issue: 'remis', message, codeEnvoye, codeExterne });
  }

  const totalRemis = resultats.filter((r) => r.issue === 'remis').length;
  return {
    bonEnvoiId: bon.id,
    numero: bon.numero,
    totalRemis,
    totalNonRemis: resultats.length - totalRemis,
    resultats,
  };
}
