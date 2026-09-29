import { NextResponse } from 'next/server';
import { jsonError, requirePermission } from '@/lib/api-utils';
import { restaurerTransaction } from '@/lib/journal-comptable';

// Remet dans le journal une écriture supprimée — et sa compensation si elles
// avaient été supprimées ensemble (lib/journal-comptable.ts, idsARestaurer).
// Même clé que la suppression : qui peut retirer une ligne peut la remettre.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('comptabilite:delete');
    const { id } = await params;
    await restaurerTransaction(id, session.sub);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}
