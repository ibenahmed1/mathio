import { NextRequest, NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { resolveHubPlanification } from '@/lib/bon-distribution';
import { getColisEligiblesRetour, grouperParMarchand } from '@/lib/bon-retour';

const ROLES_COMPOSITION = ['admin', 'planner'] as const;

// Colis restituables du hub, avec leur regroupement par marchand.
//
// Les trois pages de la navigation (§ /admin/bon-retour/livreur, /zone,
// /client) tapent toutes ici et ne diffèrent QUE par l'axe sur lequel le
// wizard groupe ses puces de filtre, côté client : c'est la même matière,
// triée par l'angle qui arrange l'opérateur — par livreur quand il vide un
// véhicule, par marchand quand il prépare une restitution précise. Le
// groupement se fait sur le vivier déjà chargé plutôt que par une seconde
// requête : il n'y a rien de plus à demander au serveur pour l'obtenir.
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser([...ROLES_COMPOSITION]);
    const { searchParams } = request.nextUrl;

    const hub = await resolveHubPlanification(session, searchParams.get('hubId'));

    const colis = await getColisEligiblesRetour({
      hubId: hub.id,
      marchandId: searchParams.get('marchandId'),
      livreurId: searchParams.get('livreurId'),
    });

    return NextResponse.json({
      hub,
      colis,
      marchands: grouperParMarchand(colis),
    });
  } catch (error) {
    return jsonError(error);
  }
}
