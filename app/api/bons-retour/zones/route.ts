import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getHubsRetour } from '@/lib/bon-retour';
import { resolveUserHub } from '@/lib/hub-envoi';

// § Étape 1 de la composition d'un Bon de Retour : les hubs avec le volume de
// colis actuellement restituables et le nombre de ramasseurs actifs.
//
// Route jumelle de /api/bons-distribution/zones, et confinée de la même façon :
// le Planner ne compose que pour son propre hub, la liste est réduite à
// celui-ci côté serveur et l'étape 1 se résout alors d'elle-même côté UI.
export async function GET() {
  try {
    const session = await requireUser(['admin', 'planner']);

    if (session.role === 'planner') {
      const hub = await resolveUserHub(session.sub);
      return NextResponse.json({ data: await getHubsRetour(hub.id) });
    }

    return NextResponse.json({ data: await getHubsRetour() });
  } catch (error) {
    return jsonError(error);
  }
}
