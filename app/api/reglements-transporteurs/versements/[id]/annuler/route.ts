import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { texteFacultatif } from '@/lib/finance';
import { annulerVersement } from '@/lib/reglements-transporteurs';

// Versement saisi par erreur : ses colis redeviennent « à recevoir » et
// l'écriture du journal est neutralisée. Le versement reste, pour l'audit.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    await annulerVersement(id, session.sub, texteFacultatif(body?.motif));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
