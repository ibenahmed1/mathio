import { NextRequest, NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getColisEligiblesEnvoi } from '@/lib/hub-envoi';
import { enDtoColisEligible, getColisEligiblesPrestataire } from '@/lib/bon-envoi-prestataire';

// § Étape 3 de la création d'un Bon d'Envoi : les colis proposés à la
// sélection. Deux modes, selon la nature du bon en cours de composition :
//
//   ?hubDestinationId=…  TRANSIT INTERNE — liste imposée par le routage
//                        ville → hub (lib/hub-envoi.ts).
//   ?prestataireId=…     REMISE SOUS-TRAITÉE — la ville ne filtre rien ; le
//                        périmètre se règle à l'écran (hub où sont les colis,
//                        largeur des statuts), et chaque colis porte le tarif
//                        d'achat du transporteur visé, `null` s'il ne connaît
//                        pas la ville.
export async function GET(request: NextRequest) {
  try {
    await requireUser(['admin']);
    const { searchParams } = request.nextUrl;

    const prestataireId = searchParams.get('prestataireId')?.trim();
    if (prestataireId) {
      const hubActuelId = searchParams.get('hubActuelId')?.trim() || null;
      const tousStatuts = searchParams.get('tousStatuts') === '1';

      const eligibles = await getColisEligiblesPrestataire({ prestataireId, hubActuelId, tousStatuts });
      return NextResponse.json({ data: eligibles.map(enDtoColisEligible) });
    }

    const hubDestinationId = searchParams.get('hubDestinationId')?.trim();
    if (!hubDestinationId) {
      throw new ApiError(400, 'hubDestinationId ou prestataireId est requis');
    }

    const eligibles = await getColisEligiblesEnvoi();
    const data = eligibles.filter((e) => e.hub.hubId === hubDestinationId).map((e) => e.commande);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
