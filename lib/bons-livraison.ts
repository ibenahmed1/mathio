import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { nextBonLivraisonNumero } from '@/lib/codes';

// § Bon de livraison — génération.
//
// Cette règle n'existait que dans la Server Action marchand
// (app/marchand/bons-livraison/actions.ts). L'admin peut désormais générer un
// BL pour le compte d'un marchand (POST /api/bons-livraison), et deux copies
// de la même règle auraient fini par diverger sur ce qui compte ici : un BL ne
// contient QUE des colis d'un seul marchand, tous éligibles au même titre, et
// leur passage en `attente_de_ramassage` est historisé (RG-10).
//
// Le périmètre marchand n'est donc plus déduit de la session : il est passé en
// paramètre. `marchandId` renseigné = flux marchand, la sélection est bornée à
// ses propres colis. `marchandId` absent = flux admin, la sélection peut
// couvrir plusieurs boutiques et produit alors un bon PAR marchand — même
// mécanique que POST /api/bons-preparation, et c'est ce regroupement, et non
// un identifiant reçu du client, qui garantit l'invariant « un BL, un
// marchand ».

// Forme sérialisable d'un bon tout juste généré : `montantTotalCod` est rendu
// en chaîne, pas en Decimal — aucun Decimal Prisma ne doit remonter jusqu'à
// une réponse JSON ni jusqu'à un composant client.
export interface BonDeLivraisonGenere {
  id: string;
  numero: string;
  marchandId: string;
  nbColis: number;
  montantTotalCod: string;
}

function arrondi(valeur: number): number {
  return Number(valeur.toFixed(2));
}

// Total COD d'un lot de colis, arrondi une seule fois, à la fin.
//
// Les montants arrivent en `Decimal(10,2)` : les convertir en `number` un par
// un puis les sommer laisse filer l'erreur du flottant (0.1 + 0.2 vaut
// 0.30000000000000004), et ce total-là n'est pas un affichage — c'est le
// montant que le ramasseur contresigne en prenant le sac.
export function totalCod(montants: (number | string)[]): number {
  return arrondi(montants.reduce<number>((total, montant) => total + Number(montant), 0));
}

// Regroupe une sélection de colis par marchand, dans l'ordre de première
// apparition — un bon sera créé par entrée de la table.
export function grouperParMarchand<T extends { marchandId: string }>(colis: T[]): Map<string, T[]> {
  const parMarchand = new Map<string, T[]>();
  for (const ligne of colis) {
    const liste = parMarchand.get(ligne.marchandId);
    if (liste) liste.push(ligne);
    else parMarchand.set(ligne.marchandId, [ligne]);
  }
  return parMarchand;
}

export interface OptionsCreationBonLivraison {
  colisIds: string[];
  // Auteur de l'opération, porté par l'historique de statut : le marchand qui
  // déclare son dépôt, ou l'admin qui le saisit pour lui. C'est la vérité de
  // la traçabilité — le rattachement au marchand, lui, reste porté par
  // `BonDeLivraison.marchandId`, donc rien ne se perd.
  utilisateurId: string;
  // Absent = flux admin, sélection multi-marchands autorisée (un bon chacun).
  marchandId?: string;
}

// Regroupe les colis `nouveau_colis` encore libres de tout bon en un ou
// plusieurs bons de livraison, et fait passer ces colis en
// `attente_de_ramassage`.
export async function creerBonsDeLivraison({
  colisIds,
  utilisateurId,
  marchandId,
}: OptionsCreationBonLivraison): Promise<BonDeLivraisonGenere[]> {
  const ids = Array.from(new Set(colisIds.filter((id) => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) {
    throw new ApiError(400, 'Sélectionnez au moins un colis');
  }

  // Les critères d'éligibilité sont dans le `where`, pas vérifiés après coup :
  // un colis déjà rattaché à un bon, sorti du statut `nouveau_colis`, du
  // pipeline stock (`enStock`) ou d'une autre boutique n'est tout simplement
  // pas ramené, et l'écart de cardinalité ci-dessous fait échouer l'ensemble.
  const colis = await prisma.commande.findMany({
    where: {
      id: { in: ids },
      statut: 'nouveau_colis',
      bonLivraisonId: null,
      enStock: false,
      ...(marchandId ? { marchandId } : {}),
    },
    select: { id: true, marchandId: true, montantCod: true },
  });

  if (colis.length !== ids.length) {
    throw new ApiError(
      400,
      'Un ou plusieurs colis sélectionnés ne sont plus disponibles (déjà rattachés à un bon, hors du statut « nouveau colis », ou hors de votre périmètre)',
    );
  }

  const parMarchand = grouperParMarchand(colis);

  return prisma.$transaction(async (tx) => {
    const generes: BonDeLivraisonGenere[] = [];

    for (const [idMarchand, lignes] of parMarchand) {
      // `tx` et non le client global : la numérotation compte les BL du jour,
      // et doit voir ceux créés plus tôt dans CETTE transaction — sinon une
      // sélection multi-marchands produit deux fois le même numéro, sur une
      // colonne `@unique` (cf. nextBonLivraisonNumero dans lib/codes.ts).
      const numero = await nextBonLivraisonNumero(tx);
      const montantTotalCod = totalCod(lignes.map((ligne) => ligne.montantCod.toString()));

      const bon = await tx.bonDeLivraison.create({
        data: { numero, marchandId: idMarchand, nbColis: lignes.length, montantTotalCod },
      });

      const idsLignes = lignes.map((ligne) => ligne.id);

      await tx.commande.updateMany({
        where: { id: { in: idsLignes } },
        data: { bonLivraisonId: bon.id, statut: 'attente_de_ramassage', dateConfirmation: new Date() },
      });

      // RG-10 : toute transition de statut est historisée, y compris celle-ci
      // qui est faite en masse.
      await tx.historiqueStatutCommande.createMany({
        data: idsLignes.map((id) => ({
          commandeId: id,
          ancienStatut: 'nouveau_colis' as const,
          nouveauStatut: 'attente_de_ramassage' as const,
          utilisateurId,
        })),
      });

      generes.push({
        id: bon.id,
        numero: bon.numero,
        marchandId: bon.marchandId,
        nbColis: bon.nbColis,
        montantTotalCod: bon.montantTotalCod.toString(),
      });
    }

    return generes;
  });
}
