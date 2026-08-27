import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getBonPaiement } from '@/lib/bon-paiement';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

// Détail d'un bon de paiement, tournées incluses — alimente aussi la vue
// d'impression signée par le livreur (/bons-paiement/[id]).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLES_PAIEMENT]);
    const { id } = await params;
    return NextResponse.json(await getBonPaiement(id));
  } catch (error) {
    return jsonError(error);
  }
}
