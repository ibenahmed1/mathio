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
// référentiel plat Hub ↔ Ville. N'importe quel hub peut être une destination
// de transit sous le modèle généralisé.
//
// UNE VILLE PEUT DÉSORMAIS APPARTENIR À PLUSIEURS HUBS (§ @@unique([hubId, nom])
// sur Ville) : depuis la sous-traitance, deux prestataires annoncent souvent la
// même ville — Taza, Aknoul et Tahla sont chez Meta Livraison ET chez EST
// Livraison, chacun à son prix. `Commande.ville` étant du texte libre, il faut
// pourtant en désigner UN.
//
// Le choix est COMMERCIAL, tranché par l'exploitation le 05/10/2026 : une ville
// desservie par plusieurs réseaux part chez le MOINS CHER. La règle reste
// déterministe, plutôt que dictée par l'ordre de lecture de la base :
//
//   1. un hub INTERNE l'emporte sur une agence sous-traitée — ce que nous
//      savons livrer nous-mêmes n'a pas à partir chez un tiers ;
//   2. le hub CENTRAL l'emporte parmi les hubs internes ;
//   3. entre agences, le TARIF DE LIVRAISON le plus bas (celui du prestataire
//      de l'agence, § TarifPrestataireVille). Une ville sans tarif passe après
//      toute ville tarifée : un coût inconnu n'est pas un coût nul ;
//   4. à égalité, le nom de hub le plus petit dans l'ordre alphabétique —
//      arbitraire, mais stable et vérifiable.
//
// `villesPartagees()` ci-dessous expose les cas où cette règle a dû trancher.
export function meilleurHub<V extends VilleAvecHub>(a: V, b: V): V {
  const rang = (v: VilleAvecHub) => (v.hub.isCentral ? 0 : v.hub.prestataireId ? 2 : 1);
  if (rang(a) !== rang(b)) return rang(a) < rang(b) ? a : b;
  const prix = (v: VilleAvecHub) => v.tarif ?? Number.POSITIVE_INFINITY;
  if (prix(a) !== prix(b)) return prix(a) < prix(b) ? a : b;
  return a.hub.nom.localeCompare(b.hub.nom, 'fr', { sensitivity: 'base' }) <= 0 ? a : b;
}

export type VilleAvecHub = {
  id: string;
  nom: string;
  hub: { id: string; nom: string; isCentral: boolean; prestataireId: string | null };
  // Tarif de livraison du prestataire de l'agence pour cette ville ; null pour
  // un hub interne ou une ville non tarifée.
  tarif: number | null;
};

// MÊME VILLE, ÉCRITE AUTREMENT par deux réseaux (relevé du 03/10/2026). Chaque
// grille garde sa graphie à l'écran, mais le routage doit les voir comme UNE
// ville pour que le moins cher l'emporte — sinon c'est l'orthographe tapée par
// le marchand qui choisirait le transporteur. Le premier nom de chaque groupe
// sert de clé.
const VILLES_EQUIVALENTES: readonly (readonly string[])[] = [
  ['Boulmane', 'Bouleman'],
  ['guigo', 'Guigou'],
  ['timahdit', 'Timahdite'],
  ['outat el haj', 'Outat Lhaj'],
  ['OUAD AMLIL', 'Oued Amlil'],
  ['AJDIR TAZA', 'Ajdir-Taza'],
  ['Sidi ifni', 'sidi fini'],
  ['Mirleft', 'merleft'],
  // Nom de la grille du transporteur, fusionné dans la ville d'implantation le
  // 07/10/2026 (§ scripts/decisions-villes-octobre-2026.ts, point 10).
  ['Oujda', 'Oujda (Centre & Quartiers)'],
  ['Taounate', 'taounate centre'],
  // Confiées à EST seul le 07/10/2026 : la ligne Meta « TAZA »/« GUERCIF »
  // a disparu, et la ligne EST porte le nom de sa grille. Sans ces groupes, un
  // colis saisi « Taza » ou « Guercif » ne trouvait plus aucune ville.
  ['Taza Ville', 'Taza'],
  ['Guercif Ville', 'Guercif'],
  // Noms rendus à la grille EST / Power le 03/10 (restituer-lignes-sources.ts) :
  // la forme usuelle, saisie en texte libre (API, import), doit les retrouver.
  // Pas « Sidi moussa » (deux villes distinctes) ni « La Zone Industrielle »
  // (trop générique pour désigner celle de Béni Mellal).
  ['Nador Ville', 'Nador'],
  ['Al Hoceima Ville', 'Al Hoceima'],
  ['Beni Drar (Bnidrar)', 'Beni Drar', 'Bnidrar'],
  ["Ras El Ma (Cap de l'Eau)", 'Ras El Ma', "Cap de l'Eau"],
  ['TNIN CHTOUKA - EL JADIDA', 'Tnin Chtouka'],
];

const CLE_EQUIVALENTE = new Map(
  VILLES_EQUIVALENTES.flatMap((groupe) => groupe.map((nom) => [normaliserVille(nom), normaliserVille(groupe[0])]))
);

// Clé de routage d'un nom de ville : casse et accents repliés, puis graphie
// ramenée à celle de son groupe d'équivalence.
export function cleRoutage(ville: string): string {
  const cle = normaliserVille(ville);
  return CLE_EQUIVALENTE.get(cle) ?? cle;
}

export async function chargerVillesRoutage(): Promise<(VilleAvecHub & { numero: number })[]> {
  const villes = await prisma.ville.findMany({
    select: {
      id: true,
      nom: true,
      numero: true,
      hub: { select: { id: true, nom: true, isCentral: true, prestataireId: true } },
      tarifsPrestataires: { select: { prestataireId: true, tarifLivraison: true } },
    },
  });
  return villes.map(({ tarifsPrestataires, ...v }) => {
    const tarif = tarifsPrestataires.find((t) => t.prestataireId === v.hub.prestataireId);
    return { ...v, tarif: tarif ? Number(tarif.tarifLivraison) : null };
  });
}

// Ville retenue pour chaque clé de routage.
export function villesRetenues<V extends VilleAvecHub>(villes: V[]): Map<string, V> {
  const retenues = new Map<string, V>();
  for (const v of villes) {
    const cle = cleRoutage(v.nom);
    const dejaLa = retenues.get(cle);
    retenues.set(cle, dejaLa ? meilleurHub(dejaLa, v) : v);
  }
  return retenues;
}

export async function getVilleHubIndex(): Promise<Map<string, HubDestination>> {
  const index = new Map<string, HubDestination>();
  for (const [cle, v] of villesRetenues(await chargerVillesRoutage())) {
    index.set(cle, { hubId: v.hub.id, hubNom: v.hub.nom });
  }
  return index;
}

// Référentiel pour la CRÉATION d'un colis : `Commande.villeId` doit désigner la
// ville que le routage retient, sans quoi le colis partirait chez un réseau et
// serait facturé au tarif d'un autre (le coût d'achat se lit par villeId, cf.
// getCoutsPrestataire). `villes` sert aux rapprochements tolérants (Shopify,
// YouCan) ; `preferee` ramène n'importe laquelle d'entre elles à la ville
// retenue de son groupe ; `pour` résout directement un texte saisi.
export type VilleRetenue = { id: string; nom: string };

export interface ReferentielRoutage {
  villes: VilleRetenue[];
  preferee(villeId: string): VilleRetenue | null;
  pour(texte: string): VilleRetenue | null;
}

export async function chargerReferentielRoutage(): Promise<ReferentielRoutage> {
  const villes = await chargerVillesRoutage();
  const retenues = villesRetenues(villes);
  const cleDe = new Map(villes.map((v) => [v.id, cleRoutage(v.nom)]));
  const reduire = (v: VilleAvecHub | undefined): VilleRetenue | null => (v ? { id: v.id, nom: v.nom } : null);
  return {
    villes: villes.map(({ id, nom }) => ({ id, nom })),
    preferee: (villeId) => {
      const cle = cleDe.get(villeId);
      return cle === undefined ? null : reduire(retenues.get(cle));
    },
    pour: (texte) => reduire(retenues.get(cleRoutage(texte))),
  };
}

// § /admin/hubs — villes annoncées par plusieurs hubs, et lequel le routage
// retient. Sert à rendre visible un arbitrage que l'index fait en silence : une
// ville partagée signifie qu'on paie peut-être le mauvais prestataire.
export async function villesPartagees(): Promise<
  { nom: string; hubs: string[]; retenu: string }[]
> {
  const villes = await chargerVillesRoutage();

  const parNom = new Map<string, VilleAvecHub[]>();
  for (const v of villes) {
    const cle = cleRoutage(v.nom);
    parNom.set(cle, [...(parNom.get(cle) ?? []), v]);
  }

  return [...parNom.values()]
    .filter((groupe) => groupe.length > 1)
    .map((groupe) => ({
      nom: groupe[0].nom,
      hubs: groupe.map((v) => v.hub.nom).sort((a, b) => a.localeCompare(b, 'fr')),
      retenu: groupe.reduce(meilleurHub).hub.nom,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

// Hub où se trouve physiquement un colis pas encore scanné (hubActuelId
// null) : les colis de stock (ramasse+enStock) n'ont jamais été réceptionnés
// au quai, ils sont implicitement à l'entrepôt central (Hub.isCentral, cf.
// lib/hub-stock.ts) jusqu'à preuve du contraire.
export async function hubCentralId(): Promise<string | null> {
  const hub = await prisma.hub.findFirst({ where: { isCentral: true }, select: { id: true } });
  return hub?.id ?? null;
}

// § Utilisé par POST /api/bons-envoi/verifier-colis pour distinguer, quand un
// colis scanné n'est pas éligible au transit, le cas "ville déjà locale au
// hub où se trouve le colis" (message dédié invitant à passer par un Bon de
// Distribution) du cas générique (statut/ville hors référentiel).
export async function estVilleLocaleAuHub(commande: { ville: string; hubActuelId: string | null }): Promise<boolean> {
  const [index, central] = await Promise.all([getVilleHubIndex(), hubCentralId()]);
  const destination = index.get(cleRoutage(commande.ville));
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
    const hub = villeIndex.get(cleRoutage(commande.ville));
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
