import { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ErreurPlateforme } from '@/lib/plateforme-auth';
import { deciderTransitionStatut, ecrireTransition } from '@/lib/livraison-statut';
import {
  ErreurColivraison,
  codeColivraison,
  codeDansListe,
  construireColisColivraison,
  creerColisColivraison,
  listerColisColivraison,
} from '@/lib/colivraison';
import { resoudreVilleColivraison, resoudreVilleToutesAgencesColivraison } from '@/lib/colivraison-villes';

// § Sous-traitance Colivraison — la REMISE d'un colis par leur API, depuis le
// BON D'ENVOI, exactement comme pour Power Delivery (lib/remise-power-delivery.ts,
// dont ce fichier reprend l'ordre des écritures et les issues).
//
// L'ORDRE DES ÉCRITURES EST LA GARANTIE ANTI-DOUBLON : la remise est RÉSERVÉE
// en base (ligne `a_confirmer`, active) AVANT l'appel ; l'index unique partiel
// « une remise active par colis » fait échouer le second de deux clics
// simultanés avant qu'il ait parlé à Colivraison. C'est d'autant plus
// important ici qu'ils n'ont AUCUNE annulation par l'API : un doublon chez eux
// part en livraison.
//
// LES CODES. Notre code part dans le paramètre `code` d'addcolis.php
// (obligatoire, bien qu'absent de leur doc) et en tête de la note. Si leur
// réponse ou leur liste de colis révèle un code à eux, il est gardé dans
// `codeExterne` ; sinon le suivi interroge avec le nôtre.

export const NOM_PRESTATAIRE_COLIVRAISON = 'Colivraison';

const STATUTS_REMETTABLES: readonly StatutCommande[] = ['en_transit', 'recu_au_hub'];
const STATUT_REMIS: StatutCommande = 'expedier_par_amana';

export type IssueRemiseColivraison =
  | 'remis'
  | 'a_confirmer'
  | 'refuse_par_colivraison'
  | 'deja_remis'
  | 'ville_sans_correspondance'
  | 'statut_non_remettable';

export interface ResultatRemiseColis {
  commandeId: string;
  codeSuivi: string;
  issue: IssueRemiseColivraison;
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

export async function prestataireColivraison(): Promise<{ id: string }> {
  const prestataire = await prisma.prestataire.findUnique({
    where: { nom: NOM_PRESTATAIRE_COLIVRAISON },
    select: { id: true },
  });
  if (!prestataire) throw new ApiError(500, `Prestataire « ${NOM_PRESTATAIRE_COLIVRAISON} » absent du référentiel`);
  return prestataire;
}

function estDoublonActif(erreur: unknown): boolean {
  return erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002';
}

// Leur code pour un colis qu'on vient de créer, cherché dans colislist.php.
// Jamais bloquant : un échec ici laisse simplement la remise sans code externe.
export async function chercherCodeExterneColivraison(codeEnvoye: string): Promise<string | null> {
  try {
    return codeDansListe(await listerColisColivraison(), codeEnvoye);
  } catch (erreur) {
    if (erreur instanceof ErreurColivraison) return null;
    throw erreur;
  }
}

export async function remettreBonEnvoiColivraison(bonEnvoiId: string, auteurId: string): Promise<ResultatRemiseBon> {
  const colivraison = await prestataireColivraison();
  const bon = await prisma.bonEnvoi.findUnique({
    where: { id: bonEnvoiId },
    select: {
      id: true,
      numero: true,
      hubDestination: { select: { nom: true, prestataireId: true } },
      prestataireId: true,
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
  const prestataireDuBon = bon.prestataireId ?? bon.hubDestination?.prestataireId ?? null;
  if (prestataireDuBon !== colivraison.id) {
    throw new ApiError(400, `Ce bon d'envoi ne part pas chez ${NOM_PRESTATAIRE_COLIVRAISON}`);
  }

  const agence = bon.hubDestination?.nom ?? null;
  const resultats: ResultatRemiseColis[] = [];

  // Un colis après l'autre : leur API n'annonce aucun quota, et un bon compte
  // quelques dizaines de colis au plus.
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

    const ville = agence
      ? resoudreVilleColivraison(agence, commande.ville)
      : resoudreVilleToutesAgencesColivraison(commande.ville);
    if (!ville) {
      resultats.push({
        ...base,
        issue: 'ville_sans_correspondance',
        message: `« ${commande.ville} » n'a pas de correspondance ${NOM_PRESTATAIRE_COLIVRAISON} : remise par l'Excel du bon`,
      });
      continue;
    }

    const codeEnvoye = codeColivraison(commande.codeSuivi);
    let remiseId: string;
    try {
      const reservee = await prisma.remisePrestataire.create({
        data: {
          commandeId: commande.id,
          prestataireId: colivraison.id,
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
      const creation = await creerColisColivraison(construireColisColivraison(commande, ville.nomColivraison));
      codeExterne = creation.codeExterne ?? (await chercherCodeExterneColivraison(codeEnvoye));
      await prisma.remisePrestataire.update({
        where: { id: remiseId },
        data: {
          etat: 'acceptee',
          codeExterne,
          reponseCreation: (creation.brut ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch (erreur) {
      if (!(erreur instanceof ErreurColivraison)) throw erreur;
      // Pas de réponse : le colis existe peut-être chez eux. La remise reste
      // active et `a_confirmer` plutôt que de libérer le colis pour une
      // seconde remise qui créerait un doublon — impossible à annuler par API.
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
        issue: incertain ? 'a_confirmer' : 'refuse_par_colivraison',
        message: incertain
          ? `${erreur.message} — le colis existe peut-être chez eux : à vérifier sur leur espace avant toute nouvelle remise`
          : erreur.message,
        codeEnvoye,
      });
      continue;
    }

    let message = `Remis à ${NOM_PRESTATAIRE_COLIVRAISON} sous ${codeExterne ?? codeEnvoye}`;
    const decision = deciderTransitionStatut(commande.statut, STATUT_REMIS);
    if (decision.issue === 'applique') {
      try {
        await ecrireTransition({
          commandeId: commande.id,
          statutActuel: commande.statut,
          nouveauStatut: STATUT_REMIS,
          auteurId,
          noteHistorique: `Remis à ${NOM_PRESTATAIRE_COLIVRAISON} par API sous ${codeExterne ?? codeEnvoye} (bon ${bon.numero})`,
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
