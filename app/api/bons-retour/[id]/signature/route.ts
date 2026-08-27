import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { bilanBonRetour, getBonRetour } from '@/lib/bon-retour';

// Temps 3 : la décharge. Le marchand signe — à l'écran, ou sur le bon papier
// dont le ramasseur prend une photo. Au moins une des deux preuves est
// exigée : un bon clos sans preuve ne vaut rien le jour d'un litige, et c'est
// précisément le jour du litige qu'on vient le chercher.
//
// La signature est REFUSÉE tant qu'un colis du bon n'a pas été remis : la
// même tolérance zéro que la clôture de tournée. Faire signer une décharge
// pour des colis restés dans le véhicule engagerait le marchand sur ce qu'il
// n'a pas reçu.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['ramasseur', 'admin', 'planner']);
    const { id } = await params;
    const body = await request.json();

    const bon = await getBonRetour(id);
    if (session.role === 'ramasseur' && bon.ramasseurId !== session.sub) {
      throw new ApiError(404, 'Bon de retour introuvable');
    }
    if (bon.statut === 'remis') throw new ApiError(409, 'Ce bon est déjà signé');
    if (bon.statut === 'nouveau') {
      throw new ApiError(409, "Ce bon n'a pas encore été confié à un ramasseur");
    }

    const bilan = bilanBonRetour(bon);
    if (!bilan.pretASigner) {
      throw new ApiError(
        409,
        `${bilan.colisRestants.length} colis n'ont pas encore été remis au marchand — scannez-les avant de faire signer.`
      );
    }

    const signatureUrl = typeof body.signatureUrl === 'string' ? body.signatureUrl.trim() : '';
    const photoDechargeUrl = typeof body.photoDechargeUrl === 'string' ? body.photoDechargeUrl.trim() : '';
    if (!signatureUrl && !photoDechargeUrl) {
      throw new ApiError(400, 'Une signature à l\'écran ou une photo du bon signé est requise');
    }

    const nomSignataire = typeof body.nomSignataire === 'string' ? body.nomSignataire.trim() : '';
    if (!nomSignataire) {
      throw new ApiError(400, 'Le nom de la personne qui signe est requis');
    }

    const signe = await prisma.bonRetour.update({
      where: { id },
      data: {
        statut: 'remis',
        dateRemise: new Date(),
        nomSignataire,
        signatureUrl: signatureUrl || null,
        photoDechargeUrl: photoDechargeUrl || null,
      },
      include: { marchand: { select: { nomBoutique: true } } },
    });

    return NextResponse.json(signe);
  } catch (error) {
    return jsonError(error);
  }
}
