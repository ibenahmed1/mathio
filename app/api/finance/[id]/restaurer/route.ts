import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { perimetreComptable } from '@/lib/comptabilite-perimetre';
import { restaurerTransaction } from '@/lib/journal-comptable';

// Remet dans le journal une écriture supprimée — et sa compensation si elles
// avaient été supprimées ensemble (lib/journal-comptable.ts, idsARestaurer).
// Même clé que la suppression : qui peut retirer une ligne peut la remettre.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, marchandId } = await perimetreComptable('suppression');
    const { id } = await params;
    await restaurerTransaction(id, session.sub, marchandId);
    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}
