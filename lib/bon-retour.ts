import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import { STATUTS_ELIGIBLES_RETOUR } from '@/lib/statuts';
import type { Prisma } from '@/app/generated/prisma/client';

// § Bon de retour marchand (/admin/bon-retour, /planner/bons-retour,
// /ramasseur).
//
// Trois temps, trois acteurs :
//   1. Le Planner compose le bon au hub — au scan du QR de préférence, à la
//      main sinon. Le marchand n'est jamais choisi : il se DÉDUIT du premier
//      colis ajouté, et tout colis d'un autre marchand est refusé ensuite.
//      C'est ce qui rend la composition possible sans aucune saisie.
//   2. Un ramasseur est affecté et part rendre les colis.
//   3. Le marchand signe la décharge ; les colis passent `retourne`.
//
// La progression du temps 2 ne se stocke nulle part : un colis du bon encore
// différent de `retourne` est un colis non remis. Même mécanique que le bilan
// de clôture d'une tournée (lib/bon-distribution.ts), qui déduit les colis
// restants de leur statut plutôt que d'un compteur parallèle à tenir à jour.

// Un colis est éligible s'il est en échec définitif, présent au hub, et pas
// déjà réservé par un autre bon de retour.
const COLIS_ELIGIBLE_BASE = {
  statut: { in: STATUTS_ELIGIBLES_RETOUR },
  bonRetourId: null,
} satisfies Prisma.CommandeWhereInput;

const colisEligibleInclude = {
  marchand: { select: { id: true, nomBoutique: true } },
  hubActuel: { select: { id: true, nom: true } },
  // Le livreur qui a rapporté le colis n'est pas une donnée du bon de retour :
  // il ne sert qu'à l'entrée « par livreur » du wizard, qui trie le vivier par
  // véhicule déchargé. Chargé ici plutôt que dans une seconde requête parce
  // que l'écran l'affiche pour chaque ligne du vivier.
  livreur: { select: { id: true, nomComplet: true } },
} satisfies Prisma.CommandeInclude;

export type ColisEligibleRetour = Prisma.CommandeGetPayload<{ include: typeof colisEligibleInclude }>;

export interface FiltresColisRetour {
  hubId?: string | null;
  marchandId?: string | null;
  // § /admin/bon-retour/livreur : filtre « colis rapportés par ce livreur »,
  // qui n'est qu'une façon de retrouver un lot physique précis sur le quai —
  // le bon produit reste groupé par marchand, pas par livreur.
  livreurId?: string | null;
}

export interface HubRetour {
  id: string;
  nom: string;
  nbColisRestituables: number;
  nbRamasseursActifs: number;
}

// § Étape 1 du wizard de composition (§ /admin/bon-retour/**, § /planner) :
// pendant exact de getHubsDistribution (lib/bon-distribution.ts), mais compté
// sur la matière du retour — les colis en échec définitif présents au hub et
// pas encore réservés.
//
// `nbRamasseursActifs` n'est PAS filtré par hub : contrairement au livreur, le
// ramasseur n'est rattaché à aucun hub (Utilisateur.hubId ne concerne que
// livreur et agent_hub) — il circule entre les marchands. Le nombre est donc
// le même sur toutes les cartes, et c'est exact : n'importe lequel d'entre eux
// peut prendre n'importe quel bon.
export async function getHubsRetour(hubIdUnique?: string): Promise<HubRetour[]> {
  const [hubs, nbRamasseursActifs] = await Promise.all([
    prisma.hub.findMany({
      where: hubIdUnique ? { id: hubIdUnique } : undefined,
      select: { id: true, nom: true },
      orderBy: { nom: 'asc' },
    }),
    prisma.utilisateur.count({ where: { role: 'ramasseur', actif: true } }),
  ]);

  return Promise.all(
    hubs.map(async (hub) => ({
      id: hub.id,
      nom: hub.nom,
      nbColisRestituables: await prisma.commande.count({
        where: { ...COLIS_ELIGIBLE_BASE, hubActuelId: hub.id },
      }),
      nbRamasseursActifs,
    }))
  );
}

export async function getColisEligiblesRetour(filtres: FiltresColisRetour = {}): Promise<ColisEligibleRetour[]> {
  return prisma.commande.findMany({
    where: {
      ...COLIS_ELIGIBLE_BASE,
      ...(filtres.hubId ? { hubActuelId: filtres.hubId } : {}),
      ...(filtres.marchandId ? { marchandId: filtres.marchandId } : {}),
      ...(filtres.livreurId ? { livreurId: filtres.livreurId } : {}),
    },
    include: colisEligibleInclude,
    orderBy: { dateCreation: 'asc' },
  });
}

// Regroupement par marchand pour l'écran de composition : le Planner voit
// d'un coup d'œil combien de colis chaque marchand a en attente de
// restitution, et ouvre celui qu'il traite.
export interface MarchandARestituer {
  marchandId: string;
  nomBoutique: string;
  nbColis: number;
  montantTotalCod: number;
}

export function grouperParMarchand(colis: ColisEligibleRetour[]): MarchandARestituer[] {
  const parMarchand = new Map<string, MarchandARestituer>();
  for (const c of colis) {
    const existant = parMarchand.get(c.marchandId) ?? {
      marchandId: c.marchandId,
      nomBoutique: c.marchand.nomBoutique,
      nbColis: 0,
      montantTotalCod: 0,
    };
    existant.nbColis += 1;
    existant.montantTotalCod = Number((existant.montantTotalCod + Number(c.montantCod)).toFixed(2));
    parMarchand.set(c.marchandId, existant);
  }
  return [...parMarchand.values()].sort((a, b) => b.nbColis - a.nbColis);
}

// Normalise un scan caméra (payload QR signé) ou une saisie manuelle
// (codeSuivi) vers un codeSuivi canonique — même logique que
// POST /api/commandes/scan et POST /api/bons-distribution/scan, dont c'est la
// troisième occurrence.
export function codeSuiviDepuisScan(qrPayload: string, codeSuiviSaisi: string): string {
  if (qrPayload) {
    const result = validateQrPayload(qrPayload);
    if (!result.valid || result.parcelId === undefined) {
      throw new ApiError(400, result.reason ?? 'QR code invalide');
    }
    return `PD-${String(result.parcelId).padStart(6, '0')}`;
  }
  const codeSuivi = codeSuiviSaisi.trim().toUpperCase();
  if (!codeSuivi) {
    throw new ApiError(400, 'codeSuivi ou qrPayload est requis');
  }
  return codeSuivi;
}

// Résout un colis scanné pendant la COMPOSITION du bon. Ne mute rien : le
// panier reste côté client jusqu'à POST /api/bons-retour, comme pour le bon
// de distribution.
//
// `marchandAttendu` est null au premier scan (le marchand n'est pas encore
// connu) puis renseigné aux suivants : c'est là que se joue la règle « un bon
// = un marchand », et le message d'erreur nomme les deux boutiques parce que
// sur un quai, savoir QUEL colis on tient dans la main est tout l'enjeu.
export async function resolveColisPourRetour(
  code: string,
  options: { hubId?: string | null; marchandAttendu?: string | null } = {}
): Promise<ColisEligibleRetour> {
  const commande = await prisma.commande.findUnique({
    where: { codeSuivi: code },
    include: colisEligibleInclude,
  });

  if (!commande) {
    throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
  }

  if (commande.bonRetourId) {
    throw new ApiError(409, `Ce colis est déjà pris dans un bon de retour.`);
  }

  if (!STATUTS_ELIGIBLES_RETOUR.includes(commande.statut)) {
    throw new ApiError(
      409,
      `Ce colis est au statut "${commande.statut}" : seul un colis en échec définitif de livraison peut être restitué au marchand.`
    );
  }

  if (options.hubId && commande.hubActuelId && commande.hubActuelId !== options.hubId) {
    throw new ApiError(
      409,
      `Ce colis se trouve au hub ${commande.hubActuel?.nom ?? 'inconnu'}, pas dans celui-ci.`
    );
  }

  if (options.marchandAttendu && commande.marchandId !== options.marchandAttendu) {
    const attendu = await prisma.marchand.findUnique({
      where: { id: options.marchandAttendu },
      select: { nomBoutique: true },
    });
    throw new ApiError(
      409,
      `Ce colis appartient à ${commande.marchand.nomBoutique}, or ce bon de retour est destiné à ${attendu?.nomBoutique ?? 'un autre marchand'}. Créez un bon séparé.`
    );
  }

  return commande;
}

export async function getBonRetour(id: string) {
  const bon = await prisma.bonRetour.findUnique({
    where: { id },
    include: {
      marchand: {
        select: { id: true, nomBoutique: true, ville: true, adresse: true, utilisateur: { select: { telephone: true } } },
      },
      hub: { select: { nom: true, ville: true } },
      creePar: { select: { nomComplet: true } },
      ramasseur: { select: { id: true, nomComplet: true, telephone: true } },
      commandes: {
        select: {
          id: true,
          codeSuivi: true,
          clientNom: true,
          clientTelephone: true,
          ville: true,
          montantCod: true,
          statut: true,
          motifRetour: true,
        },
        orderBy: { codeSuivi: 'asc' },
      },
    },
  });
  if (!bon) throw new ApiError(404, 'Bon de retour introuvable');
  return bon;
}

export type BonRetourDetail = Awaited<ReturnType<typeof getBonRetour>>;

export interface BilanBonRetour {
  nbColis: number;
  colisRemis: BonRetourDetail['commandes'];
  colisRestants: BonRetourDetail['commandes'];
  pretASigner: boolean;
}

// Un colis du bon déjà passé `retourne` a été remis par le ramasseur ; les
// autres sont encore dans son véhicule. La signature ne peut clore le bon que
// lorsqu'il n'en reste aucun — même tolérance zéro que la clôture de tournée,
// et pour la même raison : la décharge signée engage le marchand sur ce qu'il
// a réellement reçu.
export function bilanBonRetour(bon: BonRetourDetail): BilanBonRetour {
  const colisRemis = bon.commandes.filter((c) => c.statut === 'retourne');
  const colisRestants = bon.commandes.filter((c) => c.statut !== 'retourne');
  return {
    nbColis: bon.commandes.length,
    colisRemis,
    colisRestants,
    pretASigner: colisRestants.length === 0 && bon.commandes.length > 0,
  };
}
