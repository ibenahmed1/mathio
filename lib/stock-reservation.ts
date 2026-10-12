import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { notifierStockBas } from '@/lib/notifications';
import { reserverStockColis } from '@/lib/stock-colis';
import { STATUTS_TERMINAUX } from '@/lib/statuts';
import type { MouvementStockSortant } from '@/lib/stock-quantites';

// § Stock commun d'une plateforme (décision du 12/10/2026) — réservation DÈS
// L'ARRIVÉE d'un colis de plateforme.
//
// Les colis d'une plateforme arrivent confirmés : leur stock est retiré tout
// de suite, pour que le stock affiché soit toujours le disponible réel. Si
// une unité manque, le colis est quand même accepté et marqué « en attente de
// stock » ; il est servi automatiquement à la réception suivante du produit
// qui lui manque (servirColisEnAttente).
//
// La réservation passe par reserverStockColis, dans SA PROPRE transaction :
// c'est un tout-ou-rien, et son échec ne doit pas annuler la création du
// colis, déjà validée. Le passage en préparation (/api/stock/pret-pour-
// preparation) ne réserve plus un colis déjà réservé à l'arrivée.

export interface IssueReservation {
  reserve: boolean;
  mouvements: MouvementStockSortant[];
}

// Réserve le stock d'un colis, ou le marque en attente si une unité manque.
// N'alerte pas : l'appelant regroupe les mouvements et appelle
// notifierStockBas une fois, après coup.
export async function tenterReservation(commandeId: string, utilisateurId: string): Promise<IssueReservation> {
  try {
    const mouvements = await prisma.$transaction((tx) => reserverStockColis(tx, [{ id: commandeId }], utilisateurId));
    return { reserve: true, mouvements };
  } catch (error) {
    // 409 : stock réel insuffisant (ou contenu non rattaché au stock). Le
    // colis attend ; rien n'a été décrémenté, la transaction ayant échoué.
    if (error instanceof ApiError && error.status === 409) {
      await prisma.commande.updateMany({
        where: { id: commandeId, stockReserveLe: null },
        data: { enAttenteStock: true },
      });
      return { reserve: false, mouvements: [] };
    }
    throw error;
  }
}

// Après une réception : sert, dans l'ordre d'arrivée, les colis en attente
// qui contiennent l'un des produits reçus. Un colis qui ne peut toujours pas
// être servi reste en attente sans bloquer les suivants (il lui manque
// peut-être un autre produit, ou plus d'unités).
export async function servirColisEnAttente(produitIds: string[], utilisateurId: string): Promise<number> {
  if (produitIds.length === 0) return 0;
  const enAttente = await prisma.commande.findMany({
    where: {
      enAttenteStock: true,
      stockReserveLe: null,
      statut: { notIn: STATUTS_TERMINAUX },
      OR: [{ lignes: { some: { produitId: { in: produitIds } } } }, { produitId: { in: produitIds } }],
    },
    orderBy: { dateCreation: 'asc' },
    select: { id: true },
  });

  let servis = 0;
  const mouvements: MouvementStockSortant[] = [];
  for (const colis of enAttente) {
    const issue = await tenterReservation(colis.id, utilisateurId);
    if (issue.reserve) {
      servis += 1;
      mouvements.push(...issue.mouvements);
    }
  }
  await notifierStockBas(mouvements);
  return servis;
}
