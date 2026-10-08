import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getColisEligiblesEnvoi } from '@/lib/hub-envoi';
import { HUBS_REGIONAUX } from '@/lib/hubs-regionaux';

// § Étape 1 de la création d'un Bon d'Envoi (/admin/bon-envoi/creer) : liste
// des hubs avec le compteur de colis actuellement éligibles à un transit
// vers chacun.
export async function GET() {
  try {
    await requireUser(['admin']);

    const [hubs, eligibles] = await Promise.all([
      // § 11 hubs régionaux : seuls les hubs servis par un transporteur sont des
      // destinations. Le hub central (d'où partent les bons) et les hubs de
      // test n'en sont pas.
      prisma.hub.findMany({ where: { prestataireId: { not: null } }, orderBy: { nom: 'asc' } }),
      getColisEligiblesEnvoi(),
    ]);

    const counts = new Map<string, number>();
    for (const e of eligibles) {
      counts.set(e.hub.hubId, (counts.get(e.hub.hubId) ?? 0) + 1);
    }

    // Dans l'ordre de la liste arrêtée (lib/hubs-regionaux.ts), pas alphabétique.
    const rang = (nom: string) => {
      const i = HUBS_REGIONAUX.findIndex((r) => r.nom === nom);
      return i < 0 ? HUBS_REGIONAUX.length : i;
    };
    hubs.sort((a, b) => rang(a.nom) - rang(b.nom) || a.nom.localeCompare(b.nom, 'fr'));

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
