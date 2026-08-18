import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { StatutCommande } from '@/app/generated/prisma/enums';

// Confirme la réception physique (entrepôt/admin) des colis d'un bon de
// livraison encore en attente de ramassage ou tout juste ramassés — même
// mécanisme de transition/historisation que PATCH /api/commandes/[id]/statut,
// mais appliqué en lot à tout le bon.
const STATUTS_ELIGIBLES: StatutCommande[] = ['attente_de_ramassage', 'ramasse'];

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;

    const bon = await prisma.bonDeLivraison.findUnique({
      where: { id },
      include: { commandes: true },
    });
    if (!bon) throw new ApiError(404, 'Bon de livraison introuvable');

    const eligibles = bon.commandes.filter((c) => STATUTS_ELIGIBLES.includes(c.statut));
    if (eligibles.length === 0) {
      throw new ApiError(400, "Aucun colis de ce bon n'est en attente de réception");
    }

    await prisma.$transaction(async (tx) => {
      await tx.commande.updateMany({
        where: { id: { in: eligibles.map((c) => c.id) } },
        data: { statut: 'recu' },
      });
      await tx.historiqueStatutCommande.createMany({
        data: eligibles.map((c) => ({
          commandeId: c.id,
          ancienStatut: c.statut,
          nouveauStatut: 'recu' as const,
          utilisateurId: session.sub,
        })),
      });
    });

    return NextResponse.json({ updated: eligibles.length });
  } catch (error) {
    return jsonError(error);
  }
}
