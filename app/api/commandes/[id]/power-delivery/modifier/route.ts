import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { modifierColisChezPower } from '@/lib/actions-power-delivery';

// § Power Delivery — transmet à Power l'état ACTUEL du colis chez nous
// (destinataire, téléphone, adresse, ouverture, COD, ville). Aucun corps : on
// corrige d'abord le colis dans l'application, puis on pousse la correction —
// jamais l'inverse, pour que les deux systèmes ne divergent pas.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('bon_envoi:manage');
    const { id } = await params;
    return NextResponse.json(await modifierColisChezPower(id, session.sub));
  } catch (error) {
    return jsonError(error);
  }
}
