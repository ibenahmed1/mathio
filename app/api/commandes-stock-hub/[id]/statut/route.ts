import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError } from '@/lib/api-utils';
import { perimetreComptable } from '@/lib/comptabilite-perimetre';
import {
  LABELS_STATUT_COMMANDE_STOCK_HUB,
  estStatutCommandeStockHub,
  peutPasserCommandeStockHub,
} from '@/lib/commandes-stock-hub';

// § Comptabilité — même périmètre d'accès que la collection voisine
// (app/api/commandes-stock-hub/route.ts), via perimetreComptable : un geste de
// saisie, dans le livre de l'appelant. Le contrôle par rôle en dur côté
// back-office est un défaut connu (CORRECTIFS_URGENTS.md §2) ; la permission
// `comptabilite:write` (ou `comptabilite.saisir` côté boutique) est de toute
// façon exigée en amont par le proxy.

// Fait avancer une commande dans son cycle (lib/commandes-stock-hub.ts). Seul le
// statut se modifie ici, sous `comptabilite:write` : c'est un geste de suivi.
// Titre, montant, date et le reste se réécrivent par PATCH
// /api/commandes-stock-hub/[id], sous `comptabilite:edit`. Cette route vivait
// à cette adresse-là jusqu'au 21/09/2026.
//
// Renvoie { id, statut } et non la commande entière : `montant` est un Decimal,
// qui ne doit pas remonter brut jusqu'au JSON, et l'écran n'a besoin que du
// nouveau statut.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { marchandId } = await perimetreComptable('saisie');
    const { id } = await params;
    const body = await request.json();

    const vers: unknown = body?.statut;
    if (!estStatutCommandeStockHub(vers)) {
      throw new ApiError(400, 'Statut invalide');
    }

    const commande = await prisma.commandeStockHub.findUnique({
      where: { id },
      select: { statut: true, supprimeLe: true, marchandId: true },
    });
    // Commande d'un autre livre : 404, comme une commande inexistante.
    if (!commande || commande.marchandId !== marchandId) {
      throw new ApiError(404, 'Commande introuvable');
    }
    if (commande.supprimeLe) {
      throw new ApiError(409, 'Commande supprimée : restaurez-la avant de changer son statut');
    }
    if (!peutPasserCommandeStockHub(commande.statut, vers)) {
      throw new ApiError(
        409,
        `Une commande « ${LABELS_STATUT_COMMANDE_STOCK_HUB[commande.statut]} » ne peut pas passer à « ${LABELS_STATUT_COMMANDE_STOCK_HUB[vers]} »`
      );
    }

    // Écriture conditionnée au statut LU juste avant : si la commande a changé
    // entre-temps (deux onglets, deux comptables), la transition validée
    // ci-dessus ne vaut plus. On refuse plutôt que d'écraser l'autre choix —
    // un « Annulée » posé par quelqu'un d'autre ne doit pas redevenir « Reçue ».
    const { count } = await prisma.commandeStockHub.updateMany({
      where: { id, marchandId, statut: commande.statut, supprimeLe: null },
      data: { statut: vers },
    });
    if (count === 0) {
      throw new ApiError(409, 'La commande a été modifiée entre-temps : rechargez la page');
    }

    return NextResponse.json({ id, statut: vers });
  } catch (error) {
    return jsonError(error);
  }
}
