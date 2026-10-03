import { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ErreurPlateforme } from '@/lib/plateforme-auth';
import { deciderTransitionStatut, ecrireTransition } from '@/lib/livraison-statut';
import {
  ErreurColisEstLivraison,
  ErreurEstLivraison,
  construireCommandeEst,
  creerCommandeEst,
  type CommandeEst,
} from '@/lib/est-livraison';
import { resoudreVilleEst, resoudreVilleToutesAgencesEst } from '@/lib/est-livraison-villes';

// § Sous-traitance EST Livraison — la REMISE d'un colis par leur API, depuis le
// BON D'ENVOI. Même ordre d'écritures que Meta et Colivraison
// (lib/remise-meta-livraison.ts) : la remise est RÉSERVÉE en base avant
// l'appel, et l'index unique partiel « une remise active par colis » arrête le
// second de deux clics simultanés avant qu'il ait parlé à EST.
//
// TROIS DIFFÉRENCES avec les réseaux voisins, toutes imposées par leur API :
//
//  · LA VILLE EST UN NOM. Pas d'identifiant : le libellé exact part dans
//    `city` et se fige dans `RemisePrestataire.villeEnvoyee` ; `cityId` reste
//    null. Il vient UNIQUEMENT de lib/est-livraison-villes.ts — une seule
//    ville tant que leur liste n'est pas reçue. Pas de correspondance, pas
//    d'envoi : leur API créerait la ville au lieu de refuser.
//
//  · RIEN NE SE RELIT NI NE S'ANNULE. Leur API ne sert aucune lecture et leur
//    suppression répond 404. Une remise douteuse ne se confirme donc pas par
//    « Actualiser » comme chez Meta : elle reste active, et un humain les
//    appelle. Leur suivi nous revient par /api/v1/livraisons/statut.
//
//  · UNE RÉPONSE REÇUE MAIS REJETÉE N'EST PAS UN REFUS. `lireCreation` rejette
//    un 200 qui a créé une ville fantôme ou ne confirme pas notre code. Le
//    colis existe alors peut-être chez eux : la remise reste active
//    (`a_confirmer`) plutôt que d'ouvrir la porte à un doublon impossible à
//    retirer. Seul un statut HTTP d'échec vaut « rien n'existe chez eux ».
//
// Le code envoyé est notre `codeSuivi` BRUT, sans préfixe (décision du
// 23/09/2026, cf. lib/est-livraison.ts) : c'est sous lui qu'ils nous
// répondront.

export const NOM_PRESTATAIRE_EST = 'EST Livraison';

const STATUTS_REMETTABLES: readonly StatutCommande[] = ['en_transit', 'recu_au_hub'];
const STATUT_REMIS: StatutCommande = 'expedier_par_amana';

export type IssueRemiseEst =
  | 'remis'
  | 'a_confirmer'
  | 'refuse_par_est'
  | 'colis_invalide'
  | 'deja_remis'
  | 'ville_sans_correspondance'
  | 'statut_non_remettable';

export interface ResultatRemiseColis {
  commandeId: string;
  codeSuivi: string;
  issue: IssueRemiseEst;
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

export async function prestataireEst(): Promise<{ id: string }> {
  const prestataire = await prisma.prestataire.findUnique({
    where: { nom: NOM_PRESTATAIRE_EST },
    select: { id: true },
  });
  if (!prestataire) throw new ApiError(500, `Prestataire « ${NOM_PRESTATAIRE_EST} » absent du référentiel`);
  return prestataire;
}

function estDoublonActif(erreur: unknown): boolean {
  return erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002';
}

// Une réponse HTTP de succès que `lireCreation` a rejetée : quelque chose a
// peut-être été créé chez eux.
function creationPossible(erreur: ErreurEstLivraison): boolean {
  return erreur.statutHttp === null || (erreur.statutHttp >= 200 && erreur.statutHttp < 300);
}

export async function remettreBonEnvoiEst(bonEnvoiId: string, auteurId: string): Promise<ResultatRemiseBon> {
  const est = await prestataireEst();
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
  if (prestataireDuBon !== est.id) {
    throw new ApiError(400, `Ce bon d'envoi ne part pas chez ${NOM_PRESTATAIRE_EST}`);
  }
  const agence = bon.hubDestination?.nom ?? null;

  const resultats: ResultatRemiseColis[] = [];

  // Un colis après l'autre : leur serveur ne prend qu'une commande par appel.
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

    const ville = agence ? resoudreVilleEst(agence, commande.ville) : resoudreVilleToutesAgencesEst(commande.ville);
    if (!ville) {
      resultats.push({
        ...base,
        issue: 'ville_sans_correspondance',
        message: `« ${commande.ville} » n'est pas encore reconnue par ${NOM_PRESTATAIRE_EST} : remise par l'Excel du bon`,
      });
      continue;
    }

    // Construit AVANT la réservation : un champ vide ou trop long se répare
    // chez nous, et rien ne doit être réservé ni envoyé d'ici là.
    let corps: CommandeEst;
    try {
      corps = construireCommandeEst(commande, ville.nomEst);
    } catch (erreur) {
      if (!(erreur instanceof ErreurColisEstLivraison)) throw erreur;
      resultats.push({ ...base, issue: 'colis_invalide', message: erreur.message });
      continue;
    }

    const codeEnvoye = corps.code;
    let remiseId: string;
    try {
      const reservee = await prisma.remisePrestataire.create({
        data: {
          commandeId: commande.id,
          prestataireId: est.id,
          bonEnvoiId: bon.id,
          remisParId: auteurId,
          etat: 'a_confirmer',
          codeEnvoye,
          villeEnvoyee: ville.nomEst,
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
      const creation = await creerCommandeEst(corps);
      codeExterne = creation.idExterne;
      await prisma.remisePrestataire.update({
        where: { id: remiseId },
        data: {
          etat: 'acceptee',
          codeExterne,
          reponseCreation: (creation.brut ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
    } catch (erreur) {
      if (!(erreur instanceof ErreurEstLivraison)) throw erreur;
      const incertain = creationPossible(erreur);
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
        issue: incertain ? 'a_confirmer' : 'refuse_par_est',
        message: incertain
          ? `${erreur.message} — le colis existe peut-être chez eux, et leur API ne permet ni de le vérifier ni de l'annuler : à confirmer avec ${NOM_PRESTATAIRE_EST} par téléphone`
          : erreur.message,
        codeEnvoye,
      });
      continue;
    }

    let message = `Remis à ${NOM_PRESTATAIRE_EST} sous ${codeEnvoye}`;
    const decision = deciderTransitionStatut(commande.statut, STATUT_REMIS);
    if (decision.issue === 'applique') {
      try {
        await ecrireTransition({
          commandeId: commande.id,
          statutActuel: commande.statut,
          nouveauStatut: STATUT_REMIS,
          auteurId,
          noteHistorique: `Remis à ${NOM_PRESTATAIRE_EST} par API sous ${codeEnvoye} (bon ${bon.numero})`,
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
