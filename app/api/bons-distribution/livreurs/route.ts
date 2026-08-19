import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getLivreursEligibles, resolveHubPlanification } from '@/lib/bon-distribution';

// § Étape 2 de la création d'un Bon de Distribution : livreurs actifs
// couvrant le hub choisi, avec leur compteur de colis éligibles chacun.
// Le hub est résolu par resolveHubPlanification : imposé pour un planner (son
// hub de rattachement), fourni en query string pour un admin.
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const hub = await resolveHubPlanification(session, request.nextUrl.searchParams.get('hubId'));

    const data = await getLivreursEligibles(hub.id);
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
