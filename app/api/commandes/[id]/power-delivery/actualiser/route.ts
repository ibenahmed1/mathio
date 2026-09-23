import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { actualiserColisPower } from '@/lib/actions-power-delivery';

// § Power Delivery — interroge leur suivi (`trackparcel`) et applique ce qu'il
// dit, par la même règle que leurs webhooks (lib/suivi-power-delivery.ts).
// C'est le recours quand un webhook s'est perdu.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('bon_envoi:manage');
    const { id } = await params;
    return NextResponse.json(await actualiserColisPower(id));
  } catch (error) {
    return jsonError(error);
  }
}
