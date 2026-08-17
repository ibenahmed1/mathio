import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getColisEligiblesDistribution } from '@/lib/bon-distribution';

// § Étape 3 de la création d'un Bon de Distribution : liste complète des
// colis éligibles pour le couple hub/livreur, avec ajout manuel via bouton '+'.
export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);

    const hubId = request.nextUrl.searchParams.get('hubId')?.trim();
    const livreurId = request.nextUrl.searchParams.get('livreurId')?.trim();
    if (!hubId || !livreurId) {
      throw new ApiError(400, 'hubId et livreurId sont requis');
    }

    const data = await getColisEligiblesDistribution(hubId, livreurId);
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
