import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getColisEligiblesDistribution, resolveHubPlanification } from '@/lib/bon-distribution';

// § Étape 3 de la création d'un Bon de Distribution : liste complète des
// colis éligibles pour le couple hub/livreur, avec ajout manuel via bouton '+'.
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const hub = await resolveHubPlanification(session, request.nextUrl.searchParams.get('hubId'));

    const livreurId = request.nextUrl.searchParams.get('livreurId')?.trim();
    if (!livreurId) {
      throw new ApiError(400, 'livreurId est requis');
    }

    const data = await getColisEligiblesDistribution(hub.id, livreurId);
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
