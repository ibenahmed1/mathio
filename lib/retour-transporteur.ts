import type { Role, StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { resolveUserHub } from '@/lib/hub-envoi';

// § Retours des transporteurs branchés par API (Power, Meta, Colivraison, EST).
//
// RETOUR DÉCLARÉ ≠ RETOUR REÇU — décidé le 11/10/2026. Quand un transporteur
// dit « je vous le renvoie » (RETURNED, RETURN_BY_AMANA, « Retourné »…), c'est
// sa parole, pas un fait : si on la posait sur le colis et que le colis se
// perdait, on aurait clôturé un colis qu'on n'a jamais revu. Donc :
//
//   1. leur déclaration ne touche PAS le colis, qui garde son dernier vrai
//      statut (refusé, annulé…). On note sur la remise la date de la PREMIÈRE
//      déclaration et le code reçu : c'est la preuve à leur opposer ;
//   2. seul NOTRE scan au hub fait avancer le colis : « Retourné au hub »,
//      puis le bon de retour au marchand pose « Retourné » ;
//   3. un retour déclaré et non reçu depuis DELAI_ALERTE_RETOUR_JOURS est en
//      alerte : on relance le transporteur, puis on réclame.
//
// Les colis en échec chez eux SANS déclaration (EST ne peut rien déclarer)
// figurent aussi dans la liste des retours attendus — sans alerte, faute de
// date de départ du retour — sinon ils se perdraient en silence.

export const DELAI_ALERTE_RETOUR_JOURS = 3;

// Échecs de livraison chez le transporteur : le colis doit nous revenir.
// `en_retour_par_amana` couvre les colis marqués par l'ancienne règle (avant
// le 11/10/2026, Power et Colivraison le posaient à leur « retour »).
export const STATUTS_ECHEC_TRANSPORTEUR: StatutCommande[] = [
  'refuse',
  'annule',
  'hors_zone',
  'annule_par_vendeur',
  'en_retour_par_amana',
];

// Note la déclaration de retour. Seule la PREMIÈRE compte : une redite plus
// tardive ne doit pas repousser l'alerte. Renvoie vrai si c'est la première.
export async function noterRetourDeclare(remiseId: string, codeRecu: string): Promise<boolean> {
  const { count } = await prisma.remisePrestataire.updateMany({
    where: { id: remiseId, retourDeclareLe: null },
    data: { retourDeclareLe: new Date(), retourDeclareCode: codeRecu.slice(0, 100) },
  });
  return count > 0;
}

export function detailRetourDeclare(premiere: boolean, codeRecu: string): string {
  return premiere
    ? `Retour déclaré (« ${codeRecu} ») : noté, le colis attend notre scan au hub`
    : `Retour déjà déclaré : « ${codeRecu} » ne change rien`;
}

// --- Retours attendus --------------------------------------------------------

export interface RetourAttendu {
  remiseId: string;
  commandeId: string;
  codeSuivi: string;
  clientNom: string;
  ville: string;
  marchand: string;
  statut: StatutCommande;
  transporteur: string;
  codeEnvoye: string;
  retourDeclareLe: string | null;
  retourDeclareCode: string | null;
  joursDepuisDeclaration: number | null;
  enAlerte: boolean;
}

const JOUR_MS = 24 * 60 * 60 * 1000;

// PURE — jours pleins écoulés depuis la déclaration.
export function joursEcoules(depuis: Date, maintenant: Date): number {
  return Math.floor((maintenant.getTime() - depuis.getTime()) / JOUR_MS);
}

export function retourEnAlerte(retourDeclareLe: Date | null, maintenant: Date): boolean {
  return retourDeclareLe !== null && joursEcoules(retourDeclareLe, maintenant) >= DELAI_ALERTE_RETOUR_JOURS;
}

// Le planner ne voit que les colis partis de son hub (un colis confié à un
// transporteur garde le hub d'où il est parti) ; l'admin voit tout, ou un hub
// s'il le demande.
export async function listerRetoursAttendus(
  session: { sub: string; role: Role },
  hubIdDemande: string | null
): Promise<RetourAttendu[]> {
  const hubId = session.role === 'planner' ? (await resolveUserHub(session.sub)).id : hubIdDemande;

  const remises = await prisma.remisePrestataire.findMany({
    where: {
      active: true,
      etat: { in: ['acceptee', 'a_confirmer'] },
      retourRecuLe: null,
      OR: [{ retourDeclareLe: { not: null } }, { commande: { statut: { in: STATUTS_ECHEC_TRANSPORTEUR } } }],
      // Livré, ou déjà revenu par un autre chemin : plus rien à attendre.
      commande: {
        statut: { notIn: ['livre', 'retourne', 'retourne_au_hub'] },
        ...(hubId && { hubActuelId: hubId }),
      },
    },
    select: {
      id: true,
      codeEnvoye: true,
      retourDeclareLe: true,
      retourDeclareCode: true,
      prestataire: { select: { nom: true } },
      commande: {
        select: {
          id: true,
          codeSuivi: true,
          clientNom: true,
          ville: true,
          statut: true,
          marchand: { select: { nomBoutique: true } },
        },
      },
    },
  });

  const maintenant = new Date();
  return remises
    .map((r) => ({
      remiseId: r.id,
      commandeId: r.commande.id,
      codeSuivi: r.commande.codeSuivi,
      clientNom: r.commande.clientNom,
      ville: r.commande.ville,
      marchand: r.commande.marchand.nomBoutique,
      statut: r.commande.statut,
      transporteur: r.prestataire.nom,
      codeEnvoye: r.codeEnvoye,
      retourDeclareLe: r.retourDeclareLe?.toISOString() ?? null,
      retourDeclareCode: r.retourDeclareCode,
      joursDepuisDeclaration: r.retourDeclareLe ? joursEcoules(r.retourDeclareLe, maintenant) : null,
      enAlerte: retourEnAlerte(r.retourDeclareLe, maintenant),
    }))
    .sort(
      (a, b) =>
        Number(b.enAlerte) - Number(a.enAlerte) ||
        (b.joursDepuisDeclaration ?? -1) - (a.joursDepuisDeclaration ?? -1) ||
        a.codeSuivi.localeCompare(b.codeSuivi)
    );
}

// --- Réception au hub --------------------------------------------------------

export interface ResultatReception {
  codeSuivi: string;
  clientNom: string;
  transporteur: string;
  ancienStatut: StatutCommande;
  dejaScanne: boolean;
  retourDeclareLe: string | null;
}

// Le colis est PHYSIQUEMENT de retour au quai : il passe « Retourné au hub »,
// la remise est close (plus aucun message du transporteur ne s'applique), et
// le colis devient éligible au bon de retour (STATUTS_ELIGIBLES_RETOUR).
//
// Même matrice que le scan de clôture de tournée
// (app/api/bons-distribution/[id]/scan-retour) : « livré » est refusé sans
// exception — le COD est censé être encaissé ; un écart se corrige par le
// back-office — et « retourné » aussi, le colis est déjà chez le marchand.
export async function receptionnerRetourTransporteur(
  codeSuivi: string,
  hub: { id: string; nom: string },
  auteur: { id: string; nom: string }
): Promise<ResultatReception> {
  const commande = await prisma.commande.findUnique({
    where: { codeSuivi },
    select: { id: true, codeSuivi: true, clientNom: true, statut: true, motifRetour: true },
  });
  if (!commande) throw new ApiError(404, 'Aucun colis ne correspond à ce code.');

  // La remise active d'abord ; sinon la dernière reçue — rejeu d'un scan.
  const remise = await prisma.remisePrestataire.findFirst({
    where: { commandeId: commande.id, etat: { in: ['acceptee', 'a_confirmer'] } },
    orderBy: [{ active: 'desc' }, { creeLe: 'desc' }],
    select: {
      id: true,
      active: true,
      retourDeclareLe: true,
      retourRecuLe: true,
      prestataire: { select: { nom: true } },
    },
  });
  if (!remise) {
    throw new ApiError(
      409,
      `Le colis ${codeSuivi} n'a été confié à aucun transporteur par API : utilisez le scan de réception ou de tournée.`
    );
  }

  const base = {
    codeSuivi: commande.codeSuivi,
    clientNom: commande.clientNom,
    transporteur: remise.prestataire.nom,
    ancienStatut: commande.statut,
    retourDeclareLe: remise.retourDeclareLe?.toISOString() ?? null,
  };

  if (remise.retourRecuLe || commande.statut === 'retourne_au_hub') {
    return { ...base, dejaScanne: true };
  }
  if (commande.statut === 'livre') {
    throw new ApiError(
      409,
      `Ce colis est « Livré » chez ${remise.prestataire.nom} : un colis remis au client ne peut pas être scanné en retour.`
    );
  }
  if (commande.statut === 'retourne') {
    throw new ApiError(409, 'Ce colis est déjà « Retourné » au marchand.');
  }

  const declaration = remise.retourDeclareLe
    ? `retour déclaré par ${remise.prestataire.nom} le ${remise.retourDeclareLe.toLocaleDateString('fr-FR')}`
    : `aucune déclaration de retour de ${remise.prestataire.nom}`;
  const motif = commande.motifRetour ? `, motif terrain : ${commande.motifRetour}` : '';
  const note = `Retour ${remise.prestataire.nom} reçu au ${hub.nom} par ${auteur.nom} (${declaration}${motif})`;
  const maintenant = new Date();

  await prisma.$transaction(async (tx) => {
    // Verrou optimiste sur le statut lu : un message du transporteur arrivé
    // entre-temps ne doit pas être écrasé sans qu'on le voie.
    const { count } = await tx.commande.updateMany({
      where: { id: commande.id, statut: commande.statut },
      data: { statut: 'retourne_au_hub', hubActuelId: hub.id, dateReceptionHub: maintenant },
    });
    if (count === 0) throw new ApiError(409, 'Ce colis vient de changer de statut : scannez-le de nouveau.');

    await tx.historiqueStatutCommande.create({
      data: {
        commandeId: commande.id,
        ancienStatut: commande.statut,
        nouveauStatut: 'retourne_au_hub',
        utilisateurId: auteur.id,
        hubId: hub.id,
        note,
      },
    });

    // La remise est close : le colis n'est plus chez eux.
    await tx.remisePrestataire.update({
      where: { id: remise.id },
      data: { retourRecuLe: maintenant, active: false },
    });
  });

  return { ...base, dejaScanne: false };
}
