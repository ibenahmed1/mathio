import { NextResponse } from 'next/server';
import { jsonError, requireUser } from '@/lib/api-utils';
import { getPaieLivreur } from '@/lib/bon-paiement';

// § /livreur/bons-paiement : la paie du livreur CONNECTÉ. Le livreurId n'est
// jamais lu depuis la requête — il vient de la session, sinon n'importe quel
// livreur consulterait la paie d'un collègue en changeant un paramètre d'URL.
//
// Cet écran répond à trois questions que l'espace livreur laissait sans
// réponse : où en est ma paie du mois, pourquoi mon net diffère de mes
// commissions, et que me reste-t-il à percevoir.
export async function GET() {
  try {
    const session = await requireUser(['livreur']);
    return NextResponse.json(await getPaieLivreur(session.sub));
  } catch (error) {
    return jsonError(error);
  }
}
