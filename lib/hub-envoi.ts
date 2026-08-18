import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { normaliserVille } from '@/lib/hub-stock';
import type { Prisma } from '@/app/generated/prisma/client';

export { normaliserVille };

// § /admin/bon-envoi : un colis est éligible au transit vers un hub si sa
// ville (texte libre, cf. lib/hub-stock.ts) résout vers ce hub ET qu'il est
// soit "recu_au_hub" (colis marchand classique réceptionné au quai de
// départ), soit "ramasse" avec enStock=true (colis de stock déjà emballé,
// sans scan de réception additionnel — § Gestion de stock) ET pas déjà pris
// dans un autre Bon d'Envoi.
const COMMANDE_ELIGIBLE_ENVOI = {
  bonEnvoiId: null,
  OR: [{ statut: 'recu_au_hub' }, { statut: 'ramasse', enStock: true }],
} satisfies Prisma.CommandeWhereInput;

const colisEligibleInclude = {
  marchand: { select: { nomBoutique: true } },
} satisfies Prisma.CommandeInclude;

export type CommandeEligibleEnvoi = Prisma.CommandeGetPayload<{ include: typeof colisEligibleInclude }>;

export interface HubDestination {
  hubId: string;
  hubNom: string;
}

export interface ColisEligibleEnvoi {
  commande: CommandeEligibleEnvoi;
  hub: HubDestination;
}

// Index ville normalisée -> hub de destination, construit à partir du
// référentiel plat Hub ↔ Ville (déjà seedé, cf. prisma/seed.ts). N'importe
// quel hub peut être une destination de transit sous le modèle généralisé.
export async function getVilleHubIndex(): Promise<Map<string, HubDestination>> {
  const villes = await prisma.ville.findMany({ include: { hub: true } });
  const index = new Map<string, HubDestination>();
  for (const v of villes) {
    index.set(normaliserVille(v.nom), { hubId: v.hub.id, hubNom: v.hub.nom });
  }
  return index;
}

// Hub où se trouve physiquement un colis pas encore scanné (hubActuelId
// null) : les colis de stock (ramasse+enStock) n'ont jamais été réceptionnés
// au quai, ils sont implicitement à l'entrepôt central (Hub.isCentral, cf.
// lib/hub-stock.ts) jusqu'à preuve du contraire.
async function hubCentralId(): Promise<string | null> {
  const hub = await prisma.hub.findFirst({ where: { isCentral: true }, select: { id: true } });
  return hub?.id ?? null;
}

// § Utilisé par POST /api/bons-envoi/verifier-colis pour distinguer, quand un
// colis scanné n'est pas éligible au transit, le cas "ville déjà locale au
// hub où se trouve le colis" (message dédié invitant à passer par un Bon de
// Distribution) du cas générique (statut/ville hors référentiel).
export async function estVilleLocaleAuHub(commande: { ville: string; hubActuelId: string | null }): Promise<boolean> {
  const [index, central] = await Promise.all([getVilleHubIndex(), hubCentralId()]);
  const destination = index.get(normaliserVille(commande.ville));
  if (!destination) return false;
  const hubActuelEffectif = commande.hubActuelId ?? central;
  return destination.hubId === hubActuelEffectif;
}

// Tous les colis éligibles à un transit, chacun résolu vers son hub de
// destination réel — génériquement : n'importe quel hub A peut envoyer vers
// n'importe quel hub B, dès lors que B (résolu depuis la ville) diffère du
// hub où le colis se trouve actuellement (hubActuelId, ou l'entrepôt central
// par défaut pour un colis de stock jamais scanné). Sert à la fois au
// comptage par hub de destination (étape 1 du BE) et à la liste détaillée
// pour un hub donné (étape 3).
export async function getColisEligiblesEnvoi(): Promise<ColisEligibleEnvoi[]> {
  const [villeIndex, central, commandes] = await Promise.all([
    getVilleHubIndex(),
    hubCentralId(),
    prisma.commande.findMany({
      where: COMMANDE_ELIGIBLE_ENVOI,
      include: colisEligibleInclude,
      orderBy: { dateCreation: 'asc' },
    }),
  ]);

  const result: ColisEligibleEnvoi[] = [];
  for (const commande of commandes) {
    const hub = villeIndex.get(normaliserVille(commande.ville));
    if (!hub) continue;
    const hubActuelEffectif = commande.hubActuelId ?? central;
    if (hub.hubId === hubActuelEffectif) continue; // déjà sur place, pas de transit à faire
    result.push({ commande, hub });
  }
  return result;
}

// § /admin/scan/reception + /admin/bon-envoi + /admin/bon-distribution : hub
// de rattachement d'un AGENT_HUB ou d'un LIVREUR (Utilisateur.hubId),
// toujours résolu côté serveur — jamais fourni par le client — pour qu'un
// utilisateur ne puisse agir "au nom" d'un autre hub.
export async function resolveUserHub(userId: string): Promise<{ id: string; nom: string; ville: string }> {
  const user = await prisma.utilisateur.findUnique({
    where: { id: userId },
    select: { hub: { select: { id: true, nom: true, ville: true } } },
  });
  if (!user?.hub) {
    throw new ApiError(403, "Votre compte n'est rattaché à aucun hub — contactez un administrateur");
  }
  return user.hub;
}
