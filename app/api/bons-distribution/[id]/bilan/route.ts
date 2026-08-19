import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getBilanTournee } from '@/lib/bon-distribution';

// § Clôture de tournée (/admin/bon-distribution/[id]/cloture) : décompte
// exact fourni au Planner au retour du livreur — argent dû (somme des CRBT
// des colis livrés), colis physiques à récupérer, colis déjà scannés au
// retour, et rémunération à créditer au livreur. Recalculé à chaque appel :
// l'écran de clôture se rafraîchit après chaque scan retour.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'planner']);
    const { id } = await params;

    const bilan = await getBilanTournee(session, id);
    return NextResponse.json(bilan);
  } catch (error) {
    return jsonError(error);
  }
}
