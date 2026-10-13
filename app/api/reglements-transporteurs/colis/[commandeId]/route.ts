import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { argentDuColis } from '@/lib/reglements-transporteurs';

// « Argent du colis » (fenêtre de suivi) : COD, part gardée par le
// transporteur, attendu, et où en est le paiement. null = colis non livré par
// un transporteur.
export async function GET(_request: Request, { params }: { params: Promise<{ commandeId: string }> }) {
  try {
    await requireUser(['admin']);
    const { commandeId } = await params;
    return NextResponse.json(await argentDuColis(commandeId));
  } catch (error) {
    return jsonError(error);
  }
}
