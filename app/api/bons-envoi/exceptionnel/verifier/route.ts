import { NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { validateQrPayload } from '@/lib/parcel-serial';
import { verifierColisExceptionnel } from '@/lib/bon-envoi-exceptionnel';

// § Bon d'envoi exceptionnel — scan d'un colis (douchette ou caméra). Ne mute
// rien : le panier reste à l'écran jusqu'à POST /api/bons-envoi/exceptionnel.
export async function POST(request: Request) {
  try {
    await requirePermission('bon_envoi:create');
    const body = await request.json();

    const prestataireId = typeof body.prestataireId === 'string' ? body.prestataireId.trim() : '';
    if (!prestataireId) throw new ApiError(400, 'Choisissez le transporteur');

    const qrPayload = typeof body.qrPayload === 'string' ? body.qrPayload.trim() : '';
    let codeSuivi = typeof body.codeSuivi === 'string' ? body.codeSuivi.trim().toUpperCase() : '';
    if (qrPayload) {
      const result = validateQrPayload(qrPayload);
      if (!result.valid || result.parcelId === undefined) throw new ApiError(400, result.reason ?? 'QR code invalide');
      codeSuivi = `PD-${String(result.parcelId).padStart(6, '0')}`;
    }
    if (!codeSuivi) throw new ApiError(400, 'codeSuivi ou qrPayload est requis');

    return NextResponse.json(await verifierColisExceptionnel(codeSuivi, prestataireId));
  } catch (error) {
    return jsonError(error);
  }
}
