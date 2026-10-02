import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { perimetreComptable } from '@/lib/comptabilite-perimetre';
import { restaurerCommandeStockHub } from '@/lib/journal-comptable';

// Remet dans la liste une commande d'inventaire supprimée. Même clé que la
// suppression, comme pour les écritures (app/api/finance/[id]/restaurer).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, marchandId } = await perimetreComptable('suppression');
    const { id } = await params;
    await restaurerCommandeStockHub(id, session.sub, marchandId);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}
