import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// RF-04 : un ramasseur (ou admin) scanne un code de suivi pour confirmer la
// réception physique d'un colis dans une tournée de ramassage.
// RF-05 : idempotent — un scan rejoué (file d'attente hors-ligne synchronisée
// en retard) sur un colis déjà collecté pour ce même ramassage ne doit ni
// échouer ni compter deux fois.
// RG-13 : c'est le SEUL chemin qui fait passer une commande à `ramasse`.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['ramasseur', 'admin']);
    const { id: ramassageId } = await params;
    const body = await request.json();

    const codeSuivi = typeof body.codeSuivi === 'string' ? body.codeSuivi.trim() : '';
    if (!codeSuivi) {
      throw new ApiError(400, 'codeSuivi est requis');
    }

    const ramassage = await prisma.ramassage.findUnique({ where: { id: ramassageId } });
    if (!ramassage) {
      throw new ApiError(404, 'Ramassage introuvable');
    }

    const commande = await prisma.commande.findUnique({ where: { codeSuivi } });
    if (!commande || commande.marchandId !== ramassage.marchandId) {
      throw new ApiError(404, "Ce code de suivi ne correspond à aucun colis de ce marchand");
    }

    // Rejeu idempotent : déjà scanné pour CE ramassage, on ne refait rien.
    if (commande.statut === 'ramasse' && commande.ramassageId === ramassageId) {
      return NextResponse.json(commande);
    }
    if (commande.statut !== 'attente_de_ramassage') {
      throw new ApiError(
        409,
        `Ce colis est au statut "${commande.statut}" : seul un colis "attente_de_ramassage" peut être réceptionné`
      );
    }

    const horodatageScan =
      typeof body.horodatageScan === 'string' && !Number.isNaN(Date.parse(body.horodatageScan))
        ? new Date(body.horodatageScan)
        : new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id: commande.id },
        data: {
          statut: 'ramasse',
          ramassageId,
          ramasseurId: session.role === 'ramasseur' ? session.sub : commande.ramasseurId,
          dateCollecte: horodatageScan,
        },
      });

      // RG-10 / RNF-11 : historisation avec auteur et horodatage — sert de
      // trace de "qui a réceptionné quel colis", pas besoin de table dédiée.
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: commande.id,
          ancienStatut: 'attente_de_ramassage',
          nouveauStatut: 'ramasse',
          utilisateurId: session.sub,
        },
      });

      await tx.ramassage.update({
        where: { id: ramassageId },
        data: { nbColisReels: { increment: 1 } },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
