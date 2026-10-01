import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { etatColivraisonDuColis } from '@/lib/suivi-colivraison';

// § Colivraison — l'état d'un colis chez eux, tel que nous le connaissons.
// `null` : le colis ne leur a jamais été confié. Aucun appel à leur API ici :
// c'est le rôle de POST …/colivraison/actualiser.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('bon_envoi:manage');
    const { id } = await params;
    return NextResponse.json({ remise: await etatColivraisonDuColis(id) });
  } catch (error) {
    return jsonError(error);
  }
}
