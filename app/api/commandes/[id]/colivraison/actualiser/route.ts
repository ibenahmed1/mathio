import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { actualiserColisColivraison } from '@/lib/suivi-colivraison';

// § Colivraison — interroge leur suivi (track.php) et applique ce qu'il dit
// (lib/suivi-colivraison.ts). Ils n'ont pas de webhook : c'est, avec le
// rattrapage planifié, la seule façon d'apprendre ce que devient le colis.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('bon_envoi:manage');
    const { id } = await params;
    return NextResponse.json(await actualiserColisColivraison(id));
  } catch (error) {
    return jsonError(error);
  }
}
