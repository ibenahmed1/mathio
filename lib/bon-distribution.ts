import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { resolveUserHub } from '@/lib/hub-envoi';
import type { Prisma } from '@/app/generated/prisma/client';
import type { Role, StatutBonDistribution, StatutCommande } from '@/app/generated/prisma/enums';

// § /admin/bon-distribution : un colis est éligible à un Bon de Distribution
// pour un livreur donné dès lors qu'il est "recu_au_hub" pour le hub choisi
// et pas déjà pris dans un autre BD (COMMANDE_ELIGIBLE_BASE ci-dessous). Le
// hub lui-même EST la "zone" du wizard, pas de niveau intermédiaire dédié
// (§ /admin/hubs). Un livreur ne couvre que son unique Hub de rattachement
// (Utilisateur.hubId) — plus de granularité par quartier/zone texte libre.
const COMMANDE_ELIGIBLE_BASE = {
  statut: 'recu_au_hub',
  bonDistributionId: null,
} satisfies Prisma.CommandeWhereInput;

const commandeEligibleInclude = {
  marchand: { select: { nomBoutique: true } },
} satisfies Prisma.CommandeInclude;

export type CommandeEligibleDistribution = Prisma.CommandeGetPayload<{ include: typeof commandeEligibleInclude }>;

const livreurSelect = {
  id: true,
  nomComplet: true,
  telephone: true,
  hubId: true,
} satisfies Prisma.UtilisateurSelect;

export interface HubDistributionResume {
  id: string;
  nom: string;
  nbColisAuHub: number;
  nbLivreursActifs: number;
}

export interface LivreurEligible {
  id: string;
  nomComplet: string;
  telephone: string | null;
  nbColisEligibles: number;
}

// § Étape 1 (choix du hub / "zone") : résolution + garde d'existence,
// réutilisée par les étapes 2/3 ci-dessous.
export async function getHubDistribution(hubId: string) {
  const hub = await prisma.hub.findUnique({ where: { id: hubId }, select: { id: true, nom: true } });
  if (!hub) throw new ApiError(404, 'Hub introuvable');
  return hub;
}

// § Étape 1 : liste des hubs (§ /admin/hubs) avec le volume de colis
// actuellement au hub et le nombre de livreurs actifs qui y sont rattachés,
// pour servir de "zone" au wizard. `hubIdUnique` restreint la liste à un seul
// hub — c'est le cas du Planner, qui ne planifie que son hub de rattachement.
export async function getHubsDistribution(hubIdUnique?: string): Promise<HubDistributionResume[]> {
  const hubs = await prisma.hub.findMany({
    where: hubIdUnique ? { id: hubIdUnique } : undefined,
    select: { id: true, nom: true },
    orderBy: { nom: 'asc' },
  });

  return Promise.all(
    hubs.map(async (hub) => {
      const [nbColisAuHub, nbLivreursActifs] = await Promise.all([
        prisma.commande.count({ where: { ...COMMANDE_ELIGIBLE_BASE, hubActuelId: hub.id } }),
        prisma.utilisateur.count({ where: { role: 'livreur', actif: true, hubId: hub.id } }),
      ]);

      return { id: hub.id, nom: hub.nom, nbColisAuHub, nbLivreursActifs };
    })
  );
}

// § Étape 2 (choix du livreur) : livreurs actifs rattachés au hub, avec leur
// compteur de colis éligibles respectif.
export async function getLivreursEligibles(hubId: string): Promise<LivreurEligible[]> {
  const hub = await getHubDistribution(hubId);

  const [livreurs, nbColisAuHub] = await Promise.all([
    prisma.utilisateur.findMany({
      where: { role: 'livreur', actif: true, hubId: hub.id },
      select: livreurSelect,
      orderBy: { nomComplet: 'asc' },
    }),
    prisma.commande.count({ where: { ...COMMANDE_ELIGIBLE_BASE, hubActuelId: hub.id } }),
  ]);

  return livreurs.map((l) => ({
    id: l.id,
    nomComplet: l.nomComplet,
    telephone: l.telephone,
    nbColisEligibles: nbColisAuHub,
  }));
}

async function resolveLivreurEligible(hubId: string, livreurId: string) {
  const hub = await getHubDistribution(hubId);
  const livreur = await prisma.utilisateur.findUnique({ where: { id: livreurId }, select: livreurSelect });
  if (!livreur) throw new ApiError(400, 'Livreur introuvable');
  if (livreur.hubId !== hub.id) {
    throw new ApiError(409, 'Ce livreur ne couvre pas ce hub de distribution');
  }

  return { hub, livreur };
}

// § Étape 3 (composition du panier) : colis éligibles pour le couple
// hub/livreur, revalidés côté serveur (ajout manuel '+' comme scan).
export async function getColisEligiblesDistribution(hubId: string, livreurId: string): Promise<CommandeEligibleDistribution[]> {
  const { hub } = await resolveLivreurEligible(hubId, livreurId);

  return prisma.commande.findMany({
    where: { ...COMMANDE_ELIGIBLE_BASE, hubActuelId: hub.id },
    include: commandeEligibleInclude,
    orderBy: { dateCreation: 'asc' },
  });
}

// § Champ de scan ("CLIC ICI AVANT LE SCAN") : résout un codeSuivi/QR contre
// l'éligibilité réelle du couple hub/livreur, même principe que
// POST /api/bons-envoi/verifier-colis.
export async function resolveColisParCode(hubId: string, livreurId: string, codeSuivi: string): Promise<CommandeEligibleDistribution> {
  const eligibles = await getColisEligiblesDistribution(hubId, livreurId);
  const match = eligibles.find((c) => c.codeSuivi === codeSuivi);
  if (match) return match;

  const commande = await prisma.commande.findUnique({ where: { codeSuivi } });
  if (!commande) {
    throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
  }
  if (commande.bonDistributionId) {
    throw new ApiError(409, 'Ce colis est déjà inclus dans un autre Bon de Distribution.');
  }
  throw new ApiError(
    409,
    `Ce colis (statut "${commande.statut}", ville "${commande.ville}") n'est pas éligible pour ce livreur/ce hub.`
  );
}

// ============================================================
// § Clôture de tournée (/admin/bon-distribution/[id]/cloture)
// ============================================================

// Périmètre de planification : un planner ne voit et ne compose QUE les
// tournées de son hub de rattachement (Utilisateur.hubId) — le hubId reçu
// dans la requête est ignoré pour lui, exactement comme le scan de réception
// impose son hub à l'agent_hub (cf. POST /api/commandes/scan-reception). Un
// admin, lui, travaille sur tous les hubs et doit donc le fournir.
export async function resolveHubPlanification(
  session: { sub: string; role: Role },
  hubIdDemande?: string | null
): Promise<{ id: string; nom: string; ville: string }> {
  if (session.role === 'planner') {
    return resolveUserHub(session.sub);
  }
  const hubId = hubIdDemande?.trim();
  if (!hubId) {
    throw new ApiError(400, 'hubId est requis');
  }
  const hub = await prisma.hub.findUnique({ where: { id: hubId }, select: { id: true, nom: true, ville: true } });
  if (!hub) throw new ApiError(404, 'Hub introuvable');
  return hub;
}

// Filtre de liste : l'admin voit toutes les tournées, le planner uniquement
// celles de son hub. Renvoyé sous forme de `where` partiel pour rester
// composable avec les autres filtres de la route.
export async function scopeHubBonsDistribution(session: {
  sub: string;
  role: Role;
}): Promise<Prisma.BonDistributionWhereInput> {
  if (session.role !== 'planner') return {};
  const hub = await resolveUserHub(session.sub);
  return { hubId: hub.id };
}

// Charge une tournée en vérifiant que l'appelant a le droit d'y toucher
// (planner : son hub uniquement). Utilisé par le bilan, le scan retour et la
// clôture, qui partagent exactement la même garde.
export async function resolveBonDistributionAutorise(session: { sub: string; role: Role }, bonId: string) {
  const bon = await prisma.bonDistribution.findUnique({
    where: { id: bonId },
    include: {
      livreur: { select: { id: true, nomComplet: true, telephone: true, fraisLivraison: true, fraisRefus: true } },
      hub: { select: { id: true, nom: true, ville: true } },
    },
  });
  if (!bon) throw new ApiError(404, 'Bon de distribution introuvable');
  if (session.role === 'planner') {
    const hub = await resolveUserHub(session.sub);
    if (bon.hubId !== hub.id) {
      throw new ApiError(403, 'Cette tournée ne relève pas de votre hub');
    }
  }
  return bon;
}

// Tarifs applicables à un livreur : surcharge par ville (TarifLivreurVille)
// avec repli sur les frais par défaut du compte (Utilisateur.fraisLivraison /
// fraisRefus), eux-mêmes à 0 s'ils n'ont jamais été renseignés. Résolus une
// seule fois par tournée puis appliqués colis par colis, plutôt qu'une
// requête par colis.
export interface TarifsLivreur {
  parVilleId: Map<string, { livraison: number; refus: number }>;
  defautLivraison: number;
  defautRefus: number;
}

export async function getTarifsLivreur(livreur: {
  id: string;
  fraisLivraison: Prisma.Decimal | null;
  fraisRefus: Prisma.Decimal | null;
}): Promise<TarifsLivreur> {
  const tarifs = await prisma.tarifLivreurVille.findMany({
    where: { utilisateurId: livreur.id },
    select: { villeId: true, fraisLivraison: true, fraisRefus: true },
  });

  return {
    parVilleId: new Map(
      tarifs.map((t) => [t.villeId, { livraison: Number(t.fraisLivraison), refus: Number(t.fraisRefus) }])
    ),
    defautLivraison: livreur.fraisLivraison ? Number(livreur.fraisLivraison) : 0,
    defautRefus: livreur.fraisRefus ? Number(livreur.fraisRefus) : 0,
  };
}

function tarifPourColis(tarifs: TarifsLivreur, villeId: string | null, type: 'livraison' | 'refus'): number {
  const surcharge = villeId ? tarifs.parVilleId.get(villeId) : undefined;
  if (surcharge) return surcharge[type];
  return type === 'livraison' ? tarifs.defautLivraison : tarifs.defautRefus;
}

// Colis encore "dehors" : il a quitté le hub avec le livreur et n'a pas
// encore été scanné au retour. Tout ce qui n'est ni livré ni déjà rentré
// (retourne_au_hub) est à récupérer physiquement — y compris les colis
// reportés, qui repartiront dans une prochaine tournée mais dorment au dépôt
// entre-temps (cf. règle produit : un seul décompte, nb sortis = livrés +
// scannés au retour).
export function estColisARecuperer(statut: StatutCommande): boolean {
  return statut !== 'livre' && statut !== 'retourne_au_hub';
}

// § Dérogation de réintégration directe (POST .../scan-retour) : un colis
// encore "mise_en_distribution" au retour du camion est un colis que le
// livreur n'a PAS qualifié sur son application (oubli, panne, batterie) alors
// qu'il est physiquement au quai. Le scanner revient donc à trancher à sa
// place — d'où une autorisation plus étroite que le simple "non livré", et
// une trace d'audit distincte dans l'historique du colis. La liste est
// identique à celle du module aujourd'hui, mais elle est vérifiée
// explicitement au moment du scan plutôt que déduite du garde d'entrée de la
// route : si le module venait à s'ouvrir à un rôle de plus (agent de quai,
// superviseur...), ce rôle hériterait sinon de la dérogation sans que
// personne ne l'ait décidé.
export const ROLES_DEROGATION_REINTEGRATION: Role[] = ['admin', 'planner'];

const colisTourneeSelect = {
  id: true,
  codeSuivi: true,
  clientNom: true,
  clientTelephone: true,
  ville: true,
  villeId: true,
  adresse: true,
  montantCod: true,
  statut: true,
  motifRetour: true,
  dateNouvelleLivraison: true,
  dateLivraison: true,
  marchand: { select: { nomBoutique: true } },
  // Le libellé du statut "retourne_au_hub" porte la ville du hub où le colis
  // est physiquement rentré — « Retourné au Hub (Casablanca) » et non un
  // "Retourné au Hub" hors-sol (cf. STATUTS_SUFFIXES_HUB dans
  // components/StatutBadge.tsx). Le scan de retour pose hubActuelId sur le hub
  // de la tournée, c'est donc bien lui la source.
  hubActuel: { select: { ville: true } },
} satisfies Prisma.CommandeSelect;

export type ColisTournee = Prisma.CommandeGetPayload<{ select: typeof colisTourneeSelect }>;

export interface LigneDetailGain {
  libelle: string;
  nb: number;
  tarifMoyen: number;
  total: number;
}

export interface BilanTournee {
  bonId: string;
  numero: string;
  statut: StatutBonDistribution;
  dateGeneration: Date;
  dateCloture: Date | null;
  hub: { id: string; nom: string; ville: string };
  livreur: { id: string; nomComplet: string; telephone: string | null };
  nbColis: number;
  // Volet caisse — le livreur remet 100 % du CRBT collecté, sans aucune
  // déduction (ses gains sont réglés séparément, cf. gainLivreur ci-dessous).
  colisLivres: ColisTournee[];
  montantCrbtAttendu: number;
  // Volet physique — ce que le Planner doit récupérer, et ce qu'il a déjà scanné.
  colisARecuperer: ColisTournee[];
  colisRetournes: ColisTournee[];
  // Volet rémunération, calculé mais jamais soustrait de la caisse.
  gainLivreur: number;
  detailGain: LigneDetailGain[];
  // Rémunération colis par colis, avant agrégation. C'est cette liste que la
  // clôture fige sur chaque Commande (§ Commande.fraisLivreur) : sans elle,
  // le montant par colis serait définitivement perdu et la fiche de paie ne
  // pourrait rien justifier de plus qu'un total.
  fraisParColis: { colisId: string; frais: number; livre: boolean }[];
  // Une tournée ne peut se clôturer que lorsque plus rien n'est "dehors".
  pretACloturer: boolean;
}

// Décompte exact fourni au Planner au retour du livreur : l'argent dû, la
// liste des colis à récupérer, et la rémunération à créditer au livreur. Tout
// est recalculé à la volée depuis les colis de la tournée — la photo figée
// n'est écrite sur BonDistribution qu'au moment de la clôture (c'est elle qui
// fait foi ensuite, ce calcul restant le reflet de l'état courant).
export async function getBilanTournee(session: { sub: string; role: Role }, bonId: string): Promise<BilanTournee> {
  const bon = await resolveBonDistributionAutorise(session, bonId);

  const colis = await prisma.commande.findMany({
    where: { bonDistributionId: bon.id },
    select: colisTourneeSelect,
    orderBy: { codeSuivi: 'asc' },
  });

  const colisLivres = colis.filter((c) => c.statut === 'livre');
  const colisRetournes = colis.filter((c) => c.statut === 'retourne_au_hub');
  const colisARecuperer = colis.filter((c) => estColisARecuperer(c.statut));

  const montantCrbtAttendu = colisLivres.reduce((somme, c) => somme + Number(c.montantCod), 0);

  const tarifs = await getTarifsLivreur(bon.livreur);
  const fraisParColis = [
    ...colisLivres.map((c) => ({
      colisId: c.id,
      frais: tarifPourColis(tarifs, c.villeId, 'livraison'),
      livre: true,
    })),
    // Le frais de refus s'applique aux colis effectivement rentrés au dépôt :
    // tant qu'un colis est encore dehors il n'est ni livré ni refusé, donc il
    // ne rémunère rien — il basculera dans l'un des deux camps au scan retour.
    ...colisRetournes.map((c) => ({
      colisId: c.id,
      frais: tarifPourColis(tarifs, c.villeId, 'refus'),
      livre: false,
    })),
  ];

  const gainLivraisons = fraisParColis.reduce((s, l) => (l.livre ? s + l.frais : s), 0);
  const gainRefus = fraisParColis.reduce((s, l) => (l.livre ? s : s + l.frais), 0);

  return {
    bonId: bon.id,
    numero: bon.numero,
    statut: bon.statut,
    dateGeneration: bon.dateGeneration,
    dateCloture: bon.dateCloture,
    hub: bon.hub,
    livreur: { id: bon.livreur.id, nomComplet: bon.livreur.nomComplet, telephone: bon.livreur.telephone },
    nbColis: colis.length,
    colisLivres,
    montantCrbtAttendu: arrondi(montantCrbtAttendu),
    colisARecuperer,
    colisRetournes,
    gainLivreur: arrondi(gainLivraisons + gainRefus),
    fraisParColis,
    detailGain: [
      ligneGain('Colis livrés', colisLivres.length, gainLivraisons),
      ligneGain('Colis retournés', colisRetournes.length, gainRefus),
    ],
    pretACloturer: colisARecuperer.length === 0,
  };
}

function arrondi(valeur: number): number {
  return Number(valeur.toFixed(2));
}

function ligneGain(libelle: string, nb: number, total: number): LigneDetailGain {
  return { libelle, nb, tarifMoyen: nb > 0 ? arrondi(total / nb) : 0, total: arrondi(total) };
}
