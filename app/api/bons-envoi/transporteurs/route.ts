import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getHubsSourceColis, getTransporteursDisponibles } from '@/lib/bon-envoi-prestataire';
import { perimetreEnvoi } from '@/lib/circuit-shipeh';

// § Étapes 1 et 2 du mode « Remise à un transporteur » (/admin/bon-envoi/creer) :
// les transporteurs sélectionnables, et les hubs où des colis attendent. Les
// deux listes remplissent le même écran au même moment — les renvoyer ensemble
// évite un second aller-retour dont l'UI ne saurait quoi faire séparément.
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(['admin']);

    const tousStatuts = request.nextUrl.searchParams.get('tousStatuts') === '1';

    const [transporteurs, hubs] = await Promise.all([
      getTransporteursDisponibles(),
      getHubsSourceColis(tousStatuts, perimetreEnvoi(session.role)),
    ]);

    return NextResponse.json({ transporteurs, hubs });
  } catch (error) {
    return jsonError(error);
  }
}
