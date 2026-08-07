import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';

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

    // Le scanner caméra (app/ramasseur) lit le contenu brut du QR code imprimé
    // sur l'étiquette : le numéro de série signé HMAC (`buildQrPayload`, voir
    // lib/parcel-serial.ts), pas le codeSuivi en clair. La saisie manuelle de
    // secours envoie elle directement le codeSuivi.
    const qrPayload = typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '';
    // Insensible à la casse : la saisie manuelle (clavier tactile) peut
    // renvoyer du minuscule alors que codeSuivi est toujours généré en
    // majuscules (nextCodeSuivi, lib/codes.ts).
    let codeSuivi = typeof body.codeSuivi === 'string' ? body.codeSuivi.trim().toUpperCase() : '';

    if (qrPayload) {
      const result = validateQrPayload(qrPayload);
      if (!result.valid || result.parcelId === undefined) {
        throw new ApiError(400, result.reason ?? 'QR code invalide');
      }
      codeSuivi = `PD-${String(result.parcelId).padStart(6, '0')}`;
    }

    if (!codeSuivi) {
      throw new ApiError(400, 'codeSuivi ou qrPayload est requis');
    }

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
