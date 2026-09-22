import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { etatPowerDuColis } from '@/lib/actions-power-delivery';

// § Power Delivery — l'état d'un colis chez eux, tel que nous le connaissons
// (dernier statut et paiement reçus, demandes en cours). `null` : le colis n'a
// jamais été confié à Power. Aucun appel à leur API ici : c'est le rôle de
// POST …/power-delivery/actualiser.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('bon_envoi:manage');
    const { id } = await params;
    return NextResponse.json({ remise: await etatPowerDuColis(id) });
  } catch (error) {
    return jsonError(error);
  }
}
