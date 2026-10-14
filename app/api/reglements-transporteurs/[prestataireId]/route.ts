import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { creancesARecevoir, versementsDuTransporteur } from '@/lib/reglements-transporteurs';

// Colis livrés à recevoir chez ce transporteur, et ses versements.
export async function GET(_request: Request, { params }: { params: Promise<{ prestataireId: string }> }) {
  try {
    await requireUser(['admin']);
    const { prestataireId } = await params;
    const [creances, versements] = await Promise.all([
      creancesARecevoir(prestataireId),
      versementsDuTransporteur(prestataireId),
    ]);
    return NextResponse.json({ creances, versements });
  } catch (error) {
    return jsonError(error);
  }
}
