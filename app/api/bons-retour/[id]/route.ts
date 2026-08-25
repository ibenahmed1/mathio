import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { bilanBonRetour, getBonRetour } from '@/lib/bon-retour';

// Détail d'un bon de retour, avec son bilan de remise (colis déjà rendus /
// colis encore dans le véhicule du ramasseur). Sert aux quatre écrans qui
// l'affichent — Planner, ramasseur, admin, marchand — chacun avec son propre
// contrôle de périmètre ci-dessous.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'planner', 'ramasseur', 'marchand']);
    const { id } = await params;

    const bon = await getBonRetour(id);

    if (session.role === 'ramasseur' && bon.ramasseurId !== session.sub) {
      throw new ApiError(404, 'Bon de retour introuvable');
    }
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      // 404 plutôt que 403, comme pour les factures : ne rien révéler de
      // l'existence d'un bon destiné à une autre boutique.
      if (!marchand || marchand.id !== bon.marchandId || bon.statut === 'nouveau') {
        throw new ApiError(404, 'Bon de retour introuvable');
      }
    }

    return NextResponse.json({ ...bon, bilan: bilanBonRetour(bon) });
  } catch (error) {
    return jsonError(error);
  }
}
