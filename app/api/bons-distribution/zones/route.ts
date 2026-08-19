import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getHubsDistribution } from '@/lib/bon-distribution';
import { resolveUserHub } from '@/lib/hub-envoi';

// § Étape 1 de la création d'un Bon de Distribution (/admin/bon-distribution/creer) :
// liste des hubs (§ /admin/hubs, référentiel existant — le hub sert
// directement de "zone" au wizard) avec le volume de colis actuellement au
// hub et le nombre de livreurs actifs qui y sont rattachés.
// Le Planner ne planifie que son propre hub : la liste est réduite à celui-ci
// côté serveur, l'étape 1 se résout alors d'elle-même côté UI.
export async function GET() {
  try {
    const session = await requireUser(['admin', 'planner']);

    if (session.role === 'planner') {
      const hub = await resolveUserHub(session.sub);
      const data = await getHubsDistribution(hub.id);
      return NextResponse.json({ data });
    }

    const data = await getHubsDistribution();
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
