import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getLivreursARegler, getTourneesARegler, periodeDepuisParams } from '@/lib/bon-paiement';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

// Détail de l'assiette d'un livreur avant génération : les tournées de la
// période qu'aucun bon n'a encore prises. `hubId` restreint au périmètre d'un
// hub (entrée « pour zone »), `livreurId` bascule sur le détail des tournées.
//
// Sans `annee`/`mois`, la période n'est pas filtrée : on voit alors tout
// l'arriéré du livreur, tous mois confondus — utile pour repérer un reliquat
// oublié sur un mois ancien.
export async function GET(request: NextRequest) {
  try {
    await requireUser([...ROLES_PAIEMENT]);
    const { searchParams } = request.nextUrl;
    const periode = periodeDepuisParams(searchParams);

    const livreurId = searchParams.get('livreurId');
    if (livreurId) {
      return NextResponse.json({ data: await getTourneesARegler(livreurId, periode) });
    }

    return NextResponse.json({ data: await getLivreursARegler(searchParams.get('hubId'), periode) });
  } catch (error) {
    return jsonError(error);
  }
}
