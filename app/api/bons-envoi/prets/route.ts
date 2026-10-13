import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { colisPretsParTransporteur } from '@/lib/compteurs-nav';

// § /admin/bon-envoi/prets — nombre de colis prêts à partir, transporteur par
// transporteur (la ville du colis désigne son transporteur).
export async function GET() {
  try {
    await requireUser(['admin']);
    return NextResponse.json(await colisPretsParTransporteur());
  } catch (error) {
    return jsonError(error);
  }
}
