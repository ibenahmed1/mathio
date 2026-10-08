import { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ErreurPlateforme } from '@/lib/plateforme-auth';
import { deciderTransitionStatut, ecrireTransition } from '@/lib/livraison-statut';
import { ErreurMeta, codeMeta, construireColisMeta, creerColisMeta } from '@/lib/meta-livraison';
import { adresseLivraisonMeta, resoudreVilleMeta } from '@/lib/meta-livraison-villes';
import { agencesARechercher, resoudreParAgences } from '@/lib/hubs-regionaux';

// § Sous-traitance Meta Livraison — la REMISE d'un colis par leur API, depuis
// le BON D'ENVOI. Même ordre d'écritures et mêmes issues que Colivraison
// (lib/remise-colivraison.ts) : la remise est RÉSERVÉE en base avant l'appel,
// et l'index unique partiel « une remise active par colis » arrête le second
// de deux clics simultanés avant qu'il ait parlé à Meta.
//
// LA VILLE. Leur API exige un `cityId`. Il vient UNIQUEMENT de la table
// validée à la main (lib/meta-livraison-villes.ts), cherchée dans l'agence du
// bon : pas de correspondance, pas d'envoi — le colis part par l'Excel.

export const NOM_PRESTATAIRE_META = 'Meta Livraison';

const STATUTS_REMETTABLES: readonly StatutCommande[] = ['en_transit', 'recu_au_hub'];
const STATUT_REMIS: StatutCommande = 'expedier_par_amana';

export type IssueRemiseMeta =
  | 'remis'
  | 'a_confirmer'
  | 'refuse_par_meta'
  | 'deja_remis'
  | 'ville_sans_correspondance'
  | 'statut_non_remettable';

export interface ResultatRemiseColis {
  commandeId: string;
  codeSuivi: string;
  issue: IssueRemiseMeta;
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

export async function prestataireMeta(): Promise<{ id: string }> {
  const prestataire = await prisma.prestataire.findUnique({
    where: { nom: NOM_PRESTATAIRE_META },
    select: { id: true },
  });
  if (!prestataire) throw new ApiError(500, `Prestataire « ${NOM_PRESTATAIRE_META} » absent du référentiel`);
  return prestataire;
}

function estDoublonActif(erreur: unknown): boolean {
  return erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002';
}

export async function remettreBonEnvoiMeta(bonEnvoiId: string, auteurId: string): Promise<ResultatRemiseBon> {
  const meta = await prestataireMeta();
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
  if (prestataireDuBon !== meta.id) {
    throw new ApiError(400, `Ce bon d'envoi ne part pas chez ${NOM_PRESTATAIRE_META}`);
  }
  // La correspondance des villes est rangée PAR AGENCE Meta (leur numérotation).
  // Depuis les 11 hubs régionaux (lib/hubs-regionaux.ts), un bon vise Hub Fès
  // ou Meta directement : la ville du colis est cherchée dans toutes les
  // agences de ce hub, ou de tout le réseau Meta pour un bon direct. Aucune
  // ville n'étant en double, la réponse est unique ; sinon, Excel.
  const agences = agencesARechercher({ hubNom: bon.hubDestination?.nom ?? null, prestataire: NOM_PRESTATAIRE_META });

  const resultats: ResultatRemiseColis[] = [];

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

    const ville = resoudreParAgences(agences, commande.ville, resoudreVilleMeta, (c) => String(c.cityId))?.resultat ?? null;
    if (!ville) {
      resultats.push({
        ...base,
        issue: 'ville_sans_correspondance',
        message: `« ${commande.ville} » n'a pas de correspondance ${NOM_PRESTATAIRE_META} : remise par l'Excel du bon`,
      });
      continue;
    }

    const codeEnvoye = codeMeta(commande.codeSuivi);
    let remiseId: string;
    try {
      const reservee = await prisma.remisePrestataire.create({
        data: {
          commandeId: commande.id,
          prestataireId: meta.id,
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
      const adresse = adresseLivraisonMeta(commande.adresse, ville);
      const creation = await creerColisMeta(construireColisMeta(commande, ville.cityId, adresse));
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
      if (!(erreur instanceof ErreurMeta)) throw erreur;
      // Pas de réponse : le colis existe peut-être chez eux. La remise reste
      // active et `a_confirmer` ; « Actualiser » le confirmera par leur suivi.
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
        issue: incertain ? 'a_confirmer' : 'refuse_par_meta',
        message: incertain
          ? `${erreur.message} — le colis existe peut-être chez eux : « Actualiser » sur la fiche du colis avant toute nouvelle remise`
          : erreur.message,
        codeEnvoye,
      });
      continue;
    }

    let message = `Remis à ${NOM_PRESTATAIRE_META} sous ${codeExterne ?? codeEnvoye}`;
    const decision = deciderTransitionStatut(commande.statut, STATUT_REMIS);
    if (decision.issue === 'applique') {
      try {
        await ecrireTransition({
          commandeId: commande.id,
          statutActuel: commande.statut,
          nouveauStatut: STATUT_REMIS,
          auteurId,
          noteHistorique: `Remis à ${NOM_PRESTATAIRE_META} par API sous ${codeExterne ?? codeEnvoye} (bon ${bon.numero})`,
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
