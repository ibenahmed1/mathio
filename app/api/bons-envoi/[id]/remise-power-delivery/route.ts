import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { remettreBonEnvoiPower } from '@/lib/remise-power-delivery';

// § Power Delivery — remet par leur API les colis d'un bon d'envoi vers une
// de leurs agences (lib/remise-power-delivery.ts). Toujours 200 quand le bon
// a pu être traité, même si des colis sont refusés : chaque colis porte son
// issue, et un 4xx global dirait « rien n'a été fait » alors que d'autres
// colis sont peut-être partis.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('bon_envoi:manage');
    const { id } = await params;
    const resultat = await remettreBonEnvoiPower(id, session.sub);
    return NextResponse.json(resultat);
  } catch (error) {
    return jsonError(error);
  }
}
