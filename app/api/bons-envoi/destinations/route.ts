import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getColisEligiblesEnvoi } from '@/lib/hub-envoi';

// § Étape 1 de la création d'un Bon d'Envoi (/admin/bon-envoi/creer) : liste
// des hubs avec le compteur de colis actuellement éligibles à un transit
// vers chacun.
export async function GET() {
  try {
    await requireUser(['admin']);

    const [hubs, eligibles] = await Promise.all([
      prisma.hub.findMany({ orderBy: { nom: 'asc' } }),
      getColisEligiblesEnvoi(),
    ]);

    const counts = new Map<string, number>();
    for (const e of eligibles) {
      counts.set(e.hub.hubId, (counts.get(e.hub.hubId) ?? 0) + 1);
    }

    const data = hubs.map((h) => ({
      id: h.id,
      nom: h.nom,
      nbColisEligibles: counts.get(h.id) ?? 0,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
