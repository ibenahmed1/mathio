import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { codeSuiviDepuisScan } from '@/lib/scan-colis';

// RF-04 : le ramasseur scanne le QR (ou saisit le code) d'un colis qu'il vient
// de récupérer chez le marchand. Contrairement à un ancien modèle où il aurait
// fallu choisir une tournée planifiée au préalable, ce n'est pas comme ça que
// ça se passe sur le terrain : le ramasseur démarre simplement sa session de
// scan et chaque colis reconnu (via son numéro de série signé) bascule
// directement d'"attente_de_ramassage" à "ramasse".
// Si une tournée (Ramassage) planifiée et encore ouverte existe pour le
// marchand du colis, on la rattache et on incrémente son compteur au passage
// (pour que le suivi admin/marchand reste cohérent) — mais ce n'est jamais
// une condition bloquante du scan : sans tournée trouvée, le colis est quand
// même réceptionné.
// RF-05 : idempotent — un scan rejoué (réseau instable, double-scan) sur un
// colis déjà collecté ne doit ni échouer ni compter deux fois.
// RG-13 : c'est le SEUL chemin qui fait passer une commande à `ramasse`.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['ramasseur', 'admin']);
    const body = await request.json();

    // QR de l'étiquette, douchette ou saisie manuelle : voir lib/scan-colis.ts.
    const codeSuivi = codeSuiviDepuisScan(
      typeof body.qrPayload === 'string' ? body.qrPayload : '',
      typeof body.codeSuivi === 'string' ? body.codeSuivi : ''
    );

    const commande = await prisma.commande.findUnique({ where: { codeSuivi } });
    if (!commande) {
      throw new ApiError(404, 'Aucun colis ne correspond à ce code.');
    }

    // Rejeu idempotent : déjà réceptionné, on ne refait rien.
    if (commande.statut === 'ramasse') {
      return NextResponse.json(commande);
    }
    if (commande.statut !== 'attente_de_ramassage') {
      throw new ApiError(
        409,
        `Ce colis est au statut "${commande.statut}" : seul un colis "attente_de_ramassage" peut être réceptionné`
      );
    }

    const ramassage = await prisma.ramassage.findFirst({
      where: { marchandId: commande.marchandId, statut: { in: ['en_attente', 'confirmee'] } },
      orderBy: { datePrevue: 'asc' },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.commande.update({
        where: { id: commande.id },
        data: {
          statut: 'ramasse',
          ramassageId: ramassage?.id ?? commande.ramassageId,
          ramasseurId: session.role === 'ramasseur' ? session.sub : commande.ramasseurId,
          dateCollecte: new Date(),
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

      if (ramassage) {
        await tx.ramassage.update({
          where: { id: ramassage.id },
          data: { nbColisReels: { increment: 1 } },
        });
      }

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
