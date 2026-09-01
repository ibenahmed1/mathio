import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';

// Deux unicités cohabitent sur Hub, et un 409 qui les confondrait enverrait
// l'admin renommer son hub alors que le vrai problème est ailleurs :
//   • `nom` — libellé, unique pour tout le réseau ;
//   • (prestataireId, ville) — un prestataire n'a qu'un quai par ville-siège.
export function messageConflitHub(error: Prisma.PrismaClientKnownRequestError): string {
  const cibles = error.meta?.target;
  const champs = Array.isArray(cibles) ? cibles.map(String) : [String(cibles ?? '')];
  if (champs.some((champ) => champ.includes('ville'))) {
    return "Ce prestataire a déjà une agence dans cette ville — modifiez celle qui existe plutôt que d'en créer une seconde";
  }
  return 'Ce nom de hub existe déjà';
}

// § Sous-traitance — retrouve (ou crée) le hub d'une grille fournisseur.
//
// Les imports appariaient l'agence sur son NOM (`hub.upsert({ where: { nom } })`
// avec `update: { prestataireId } }`). Comme `Hub.nom` est unique pour tout le
// réseau, le jour où deux prestataires nomment leur quai de la même façon —
// « Agence Casablanca » — le second import réaffectait le hub du premier,
// SANS erreur, et les villes rattachées suivaient : un réseau entier changeait
// de propriétaire en silence. Le nom est un libellé ; l'identité d'une agence,
// c'est (prestataire, ville-siège), désormais contrainte en base
// (§ @@unique([prestataireId, ville]) sur Hub).
//
// Trois cas, et un seul crée quelque chose :
//   • l'agence existe pour ce couple → on la réutilise telle quelle ;
//   • le nom voulu est déjà pris par un AUTRE hub → on refuse, en nommant le
//     propriétaire actuel : c'est un arbitrage humain, pas une reprise ;
//   • sinon → création.
// `prestataireId: null` = hub interne : il n'a pas de clé (prestataire, ville),
// on l'apparie donc sur son nom — mais on refuse tout autant de le prendre à
// un prestataire, ce que faisait `update: { prestataireId: null }`.
export async function resoudreHubImport(params: {
  prestataireId: string | null;
  ville: string;
  nom: string;
}): Promise<{ id: string; nom: string; cree: boolean }> {
  const { prestataireId, ville, nom } = params;

  if (prestataireId) {
    const agence = await prisma.hub.findUnique({
      where: { prestataireId_ville: { prestataireId, ville } },
      select: { id: true, nom: true },
    });
    if (agence) return { ...agence, cree: false };
  }

  const homonyme = await prisma.hub.findUnique({
    where: { nom },
    select: { id: true, nom: true, ville: true, prestataireId: true, prestataire: { select: { nom: true } } },
  });

  if (homonyme) {
    // Le seul cas où reprendre un hub existant est licite : il est déjà chez
    // le même propriétaire. Sinon on s'arrête — transférer un quai d'un réseau
    // à l'autre est une décision, pas un effet de bord d'import.
    if (homonyme.prestataireId === prestataireId) {
      return { id: homonyme.id, nom: homonyme.nom, cree: false };
    }
    const proprietaire = homonyme.prestataire ? `l'agence de ${homonyme.prestataire.nom}` : 'un hub interne';
    throw new ApiError(
      409,
      `« ${nom} » est déjà ${proprietaire} (ville-siège : ${homonyme.ville}). ` +
        'Choisissez un autre nom : reprendre celui-ci transférerait ce hub et ses villes.'
    );
  }

  const cree = await prisma.hub.create({
    data: { nom, ville, prestataireId },
    select: { id: true, nom: true },
  });
  return { ...cree, cree: true };
}

// § Sous-traitance (/admin/hubs) — le tarif d'achat d'une ville se saisit là où
// on saisit la ville elle-même, dans le formulaire du référentiel, plutôt que
// dans un écran de grille séparé : une ville d'agence sans tarif est une ville
// qu'on ne sait pas facturer, autant les créer d'un même geste. La grille
// complète (plusieurs prestataires sur une même ville) reste, elle, accessible
// par prestataire — cf. TarifPrestataireVille.
//
// Le tarif est toujours rattaché au PRESTATAIRE qui exploite le hub couvrant la
// ville, jamais au hub : c'est le prestataire qui nous facture, ses agences ne
// sont que ses quais.
export async function appliquerTarifPrestataire(
  villeId: string,
  hubId: string,
  tarif: unknown,
  // Optionnel et distinct de `tarif` : `undefined` laisse la valeur en place,
  // `null`/'' l'efface. Beaucoup de grilles fournisseurs ne chiffrent pas le
  // retour, et un formulaire qui ne l'envoie pas ne doit pas l'écraser.
  tarifRetour?: unknown
): Promise<void> {
  const hub = await prisma.hub.findUnique({ where: { id: hubId }, select: { prestataireId: true } });
  if (!hub?.prestataireId) {
    // Hub interne : il n'y a pas de prestataire à facturer. On ignore
    // silencieusement plutôt que de refuser — le formulaire de ville est
    // commun aux deux cas, et un tarif saisi puis le hub repassé en interne ne
    // doit pas bloquer l'enregistrement.
    return;
  }

  const cle = { prestataireId_villeId: { prestataireId: hub.prestataireId, villeId } };

  // null / chaîne vide = on retire la ligne : la ville redevient non tarifée
  // pour ce prestataire, ce qui est un état légitime (ville tout juste ouverte,
  // tarif encore en négociation).
  if (tarif === null || tarif === '') {
    await prisma.tarifPrestataireVille.deleteMany({
      where: { prestataireId: hub.prestataireId, villeId },
    });
    return;
  }

  const tarifLivraison = Number(tarif);
  if (!Number.isFinite(tarifLivraison) || tarifLivraison < 0) {
    throw new ApiError(400, 'Le tarif doit être un montant positif');
  }

  let retour: number | null | undefined;
  if (tarifRetour !== undefined) {
    if (tarifRetour === null || tarifRetour === '') {
      retour = null;
    } else {
      retour = Number(tarifRetour);
      if (!Number.isFinite(retour) || retour < 0) {
        throw new ApiError(400, 'Le tarif de retour doit être un montant positif');
      }
    }
  }

  await prisma.tarifPrestataireVille.upsert({
    where: cle,
    update: { tarifLivraison, ...(retour === undefined ? {} : { tarifRetour: retour }) },
    create: { prestataireId: hub.prestataireId, villeId, tarifLivraison, tarifRetour: retour ?? null },
  });
}

// § Marge (/admin/factures) — ce que la sous-traitance nous coûte, ville par
// ville, pour les seules villes RÉELLEMENT couvertes par une agence : le tarif
// retenu est celui du prestataire qui exploite le hub de la ville, pas le moins
// cher de la grille. Une ville tarifée chez un prestataire qui ne la dessert
// pas aujourd'hui est une offre, pas un coût.
//
// Résolu en UNE requête pour toute la facture puis lu en mémoire colis par
// colis — même stratégie que getTarifsMarchand (lib/facturation.ts) et
// getTarifsLivreur (lib/bon-distribution.ts) : le référentiel tient en quelques
// dizaines de villes, une requête par ligne de facture serait ruineuse.
export type CoutsPrestataire = Map<string, { livraison: number; retour: number | null }>;

export async function getCoutsPrestataire(): Promise<CoutsPrestataire> {
  const villes = await prisma.ville.findMany({
    where: { hub: { prestataireId: { not: null } } },
    select: {
      id: true,
      hub: { select: { prestataireId: true } },
      tarifsPrestataires: { select: { prestataireId: true, tarifLivraison: true, tarifRetour: true } },
    },
  });

  const couts: CoutsPrestataire = new Map();
  for (const ville of villes) {
    const tarif = ville.tarifsPrestataires.find((t) => t.prestataireId === ville.hub.prestataireId);
    // Ville d'agence sans tarif convenu : on n'inscrit rien plutôt que 0 — le
    // coût est INCONNU, et la facture doit pouvoir le dire (cf.
    // Facture.nbLignesCoutInconnu).
    if (!tarif) continue;
    couts.set(ville.id, {
      livraison: Number(tarif.tarifLivraison),
      // Souvent absent : les grilles fournisseurs ne chiffrent pas toujours le
      // retour. Null, donc, et non le tarif de livraison par défaut — facturer
      // un retour au prix d'une livraison serait une invention.
      retour: tarif.tarifRetour === null ? null : Number(tarif.tarifRetour),
    });
  }
  return couts;
}
