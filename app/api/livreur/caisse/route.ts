import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getCaisseJour } from '@/lib/livreur';

// § /livreur/bons-paiement : détail des colis livrés aujourd'hui par ce
// livreur et du CRBT total encaissé.
export async function GET() {
  try {
    const session = await requireUser(['livreur']);
    const { commandes, total } = await getCaisseJour(session.sub);
    return NextResponse.json({ commandes, total: total.toFixed(2) });
  } catch (error) {
    return jsonError(error);
  }
}
