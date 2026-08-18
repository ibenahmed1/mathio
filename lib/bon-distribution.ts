import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import type { Prisma } from '@/app/generated/prisma/client';

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
// pour servir de "zone" au wizard.
export async function getHubsDistribution(): Promise<HubDistributionResume[]> {
  const hubs = await prisma.hub.findMany({ select: { id: true, nom: true }, orderBy: { nom: 'asc' } });

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
