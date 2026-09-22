import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { restaurerCommandeStockHub } from '@/lib/journal-comptable';

// Remet dans la liste une commande d'inventaire supprimée. Même clé que la
// suppression, comme pour les écritures (app/api/finance/[id]/restaurer).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('comptabilite:delete');
    const { id } = await params;
    await restaurerCommandeStockHub(id, session.sub);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}
