import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getLivreursEligibles } from '@/lib/bon-distribution';

// § Étape 2 de la création d'un Bon de Distribution : livreurs actifs
// couvrant le hub choisi, avec leur compteur de colis éligibles chacun.
export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);

    const hubId = request.nextUrl.searchParams.get('hubId')?.trim();
    if (!hubId) {
      throw new ApiError(400, 'hubId est requis');
    }

    const data = await getLivreursEligibles(hubId);
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
