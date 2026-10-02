import { Prisma } from '@/app/generated/prisma/client';
import type { EtatRemisePrestataire } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ErreurPlateforme } from '@/lib/plateforme-auth';
import { deciderTransitionStatut, ecrireTransition } from '@/lib/livraison-statut';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';
import { ErreurColivraison, suivreColisColivraison } from '@/lib/colivraison';
import { sortStatutColivraison } from '@/lib/colivraison-statuts';
import {
  NOM_PRESTATAIRE_COLIVRAISON,
  chercherCodeExterneColivraison,
  prestataireColivraison,
} from '@/lib/remise-colivraison';

// § Sous-traitance Colivraison — ce qu'ils nous disent de nos colis.
//
// UNE SEULE SOURCE : leur suivi (track.php). Ils n'ont pas de webhook. Il est
// interrogé par le bouton « Actualiser » de la fiche colis et par le rattrapage
// planifié (scripts/suivre-colis-colivraison.ts) ; les deux passent ici, par la
// même décision que nos autres canaux (deciderTransitionStatut,
// lib/livraison-statut.ts) : idempotence d'abord, colis clos ensuite, verrou
// optimiste en base. Tout est journalisé (EvenementPrestataire), y compris ce
// qu'on n'applique pas — c'est là qu'on lira les libellés encore inconnus.

export type IssueInformation = 'applique' | 'inchange' | 'memorise' | 'inconnu' | 'refuse' | 'colis_introuvable';

export interface ResultatInformation {
  issue: IssueInformation;
  detail: string | null;
  commandeId: string | null;
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

export interface EtatColivraisonColis {
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

// null = aucune remise, active ou non : le colis n'est jamais passé chez eux.
export async function etatColivraisonDuColis(commandeId: string): Promise<EtatColivraisonColis | null> {
  const colivraison = await prestataireColivraison();
  const remise = await prisma.remisePrestataire.findFirst({
    where: { commandeId, prestataireId: colivraison.id },
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

async function compteServiceColivraison(prestataireId: string): Promise<string> {
  const compte = await prisma.plateformePartenaire.findUnique({
    where: { prestataireId },
    select: { utilisateurTechniqueId: true },
  });
  if (!compte) {
    throw new ApiError(
      500,
      `Aucun compte machine pour ${NOM_PRESTATAIRE_COLIVRAISON} : le créer depuis /admin/integrations en le rattachant au transporteur`
    );
  }
  return compte.utilisateurTechniqueId;
}

async function journaliser(
  prestataireId: string,
  remiseId: string,
  code: string | null,
  statutExterne: string | null,
  charge: unknown,
  issue: string,
  detail: string | null
): Promise<void> {
  await prisma.evenementPrestataire.create({
    data: {
      prestataireId,
      remiseId,
      source: 'suivi',
      codeColis: code,
      statutExterne,
      charge: (charge ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      issue,
      detail,
    },
  });
}

// Interroge leur suivi pour un colis confié et applique ce qu'il dit.
export async function actualiserColisColivraison(commandeId: string): Promise<ResultatInformation> {
  const colivraison = await prestataireColivraison();
  const remise = await prisma.remisePrestataire.findFirst({
    where: { commandeId, prestataireId: colivraison.id, active: true },
    select: {
      id: true,
      etat: true,
      codeEnvoye: true,
      codeExterne: true,
      commande: { select: { id: true, statut: true } },
    },
  });
  if (!remise) throw new ApiError(404, `Ce colis n'est pas confié à ${NOM_PRESTATAIRE_COLIVRAISON}`);

  // Le code sous lequel interroger leur suivi : le leur s'ils en ont renvoyé
  // un ; sinon le nôtre, transmis dans le paramètre `code` de la création ; et
  // si leur suivi ne connaît pas ce dernier, le leur, cherché dans leur liste
  // de colis grâce à la référence recopiée en note.
  let code = remise.codeExterne ?? remise.codeEnvoye;
  let suivi;
  try {
    suivi = await suivreColisColivraison(code);
  } catch (erreur) {
    if (!(erreur instanceof ErreurColivraison)) throw erreur;
    const inconnu = !remise.codeExterne && erreur.statutHttp === 404;
    const leurCode = inconnu ? await chercherCodeExterneColivraison(remise.codeEnvoye) : null;
    if (!leurCode) {
      if (inconnu) {
        await journaliser(colivraison.id, remise.id, code, null, erreur.brut, 'colis_introuvable', erreur.message);
        return { issue: 'colis_introuvable', detail: `${remise.codeEnvoye} inconnu de leur suivi et de leur liste de colis`, commandeId };
      }
      throw new ApiError(502, `${NOM_PRESTATAIRE_COLIVRAISON} : ${erreur.message}`);
    }
    code = leurCode;
    await prisma.remisePrestataire.update({ where: { id: remise.id }, data: { codeExterne: leurCode } });
    try {
      suivi = await suivreColisColivraison(code);
    } catch (e) {
      if (e instanceof ErreurColivraison) throw new ApiError(502, `${NOM_PRESTATAIRE_COLIVRAISON} : ${e.message}`);
      throw e;
    }
  }

  // Une réponse de leur suivi prouve que le colis existe chez eux.
  await prisma.remisePrestataire.update({
    where: { id: remise.id },
    data: {
      ...(suivi.etat && { dernierStatutExterne: suivi.etat }),
      ...(remise.etat === 'a_confirmer' && { etat: 'acceptee', erreur: null }),
    },
  });

  // `dernierEvenementLe` n'est posé qu'une fois l'information TRAITÉE : c'est
  // lui qui écarte le colis du rattrapage (cf. lib/suivi-power-delivery.ts).
  const conclure = async (issue: IssueInformation, detail: string | null): Promise<ResultatInformation> => {
    await prisma.remisePrestataire.update({ where: { id: remise.id }, data: { dernierEvenementLe: new Date() } });
    await journaliser(colivraison.id, remise.id, code, suivi.etat, suivi.brut, issue, detail);
    return { issue, detail, commandeId };
  };

  if (!suivi.etat) return conclure('memorise', 'Aucun état dans leur suivi');

  const sort = sortStatutColivraison(suivi.etat);
  if (sort.sort === 'inconnu') return conclure('inconnu', `« ${suivi.etat} » inconnu : non appliqué`);
  if (sort.sort === 'memoriser') return conclure('memorise', `« ${suivi.etat} » : leur logistique interne`);

  const decision = deciderTransitionStatut(remise.commande.statut, sort.statut);
  if (decision.issue === 'inchange') return conclure('inchange', null);
  if (decision.issue === 'refuse') return conclure('refuse', decision.message);

  const auteurId = await compteServiceColivraison(colivraison.id);
  try {
    const issue = await ecrireTransition({
      commandeId: remise.commande.id,
      statutActuel: remise.commande.statut,
      nouveauStatut: sort.statut,
      auteurId,
      noteHistorique: `${LABELS_STATUT_COMMANDE[sort.statut]} — déclaré par ${NOM_PRESTATAIRE_COLIVRAISON} (« ${suivi.etat} »)`,
      // Leur suivi ne porte aucune date de nouvelle tentative.
      dateNouvelleLivraison: null,
      commentaire: null,
    });
    return conclure(issue, null);
  } catch (erreur) {
    if (!(erreur instanceof ErreurPlateforme)) throw erreur;
    return conclure('refuse', erreur.message);
  }
}
