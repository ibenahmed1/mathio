import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getColisEligiblesEnvoi } from '@/lib/hub-envoi';

// § Étape 3 de la création d'un Bon d'Envoi : liste complète des colis
// éligibles pour le hub choisi, avec ajout manuel via bouton '+'.
export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);

    const hubDestinationId = request.nextUrl.searchParams.get('hubDestinationId')?.trim();
    if (!hubDestinationId) {
      throw new ApiError(400, 'hubDestinationId est requis');
    }

    const eligibles = await getColisEligiblesEnvoi();
    const data = eligibles.filter((e) => e.hub.hubId === hubDestinationId).map((e) => e.commande);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
