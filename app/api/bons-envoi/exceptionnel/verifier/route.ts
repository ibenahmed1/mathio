import { NextResponse } from 'next/server';
import { ApiError, jsonError, requirePermission } from '@/lib/api-utils';
import { codeSuiviDepuisScan } from '@/lib/scan-colis';
import { verifierColisExceptionnel } from '@/lib/bon-envoi-exceptionnel';

// § Bon d'envoi exceptionnel — scan d'un colis (douchette ou caméra). Ne mute
// rien : le panier reste à l'écran jusqu'à POST /api/bons-envoi/exceptionnel.
export async function POST(request: Request) {
  try {
    await requirePermission('bon_envoi:create');
    const body = await request.json();

    const prestataireId = typeof body.prestataireId === 'string' ? body.prestataireId.trim() : '';
    if (!prestataireId) throw new ApiError(400, 'Choisissez le transporteur');

    const codeSuivi = codeSuiviDepuisScan(
      typeof body.qrPayload === 'string' ? body.qrPayload : '',
      typeof body.codeSuivi === 'string' ? body.codeSuivi : ''
    );

    return NextResponse.json(await verifierColisExceptionnel(codeSuivi, prestataireId));
  } catch (error) {
    return jsonError(error);
  }
}
