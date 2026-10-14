import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { DELAI_ALERTE_RETOUR_JOURS, listerRetoursAttendus } from '@/lib/retour-transporteur';

// § Retours transporteurs (/admin/bon-retour/transporteurs) : les colis confiés
// par API qui doivent nous revenir — retour déclaré par le transporteur, ou
// échec de livraison chez lui — et pas encore scannés à notre hub. Un retour
// déclaré depuis 3 jours sans réception est en alerte (lib/retour-transporteur.ts).
export async function GET(request: Request) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const hubId = new URL(request.url).searchParams.get('hubId')?.trim() || null;
    const data = await listerRetoursAttendus(session, hubId);
    return NextResponse.json({
      delaiAlerteJours: DELAI_ALERTE_RETOUR_JOURS,
      enAlerte: data.filter((r) => r.enAlerte).length,
      data,
    });
  } catch (error) {
    return jsonError(error);
  }
}
