import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import { resolveColisParCode } from '@/lib/bon-distribution';

// § Étape 3 de la création d'un Bon de Distribution, champ "CLIC ICI AVANT LE
// SCAN" : résout un codeSuivi/QR (même logique que
// POST /api/bons-envoi/verifier-colis) et vérifie son éligibilité pour le
// couple zone/livreur choisi. Ne mute rien — le panier reste géré côté
// client jusqu'à POST /api/bons-distribution.
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const hubId = typeof body.hubId === 'string' ? body.hubId.trim() : '';
    const livreurId = typeof body.livreurId === 'string' ? body.livreurId.trim() : '';
    if (!hubId || !livreurId) {
      throw new ApiError(400, 'hubId et livreurId sont requis');
    }

    const qrPayload = typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '';
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

    const commande = await resolveColisParCode(hubId, livreurId, codeSuivi);
    return NextResponse.json(commande);
  } catch (error) {
    return jsonError(error);
  }
}
