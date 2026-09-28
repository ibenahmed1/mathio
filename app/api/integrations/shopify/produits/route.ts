import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { boutiqueConnectee, synchroniserProduits, versApiError } from '@/lib/shopify';

// § Intégration Shopify — réimporter le catalogue de la boutique dans les
// Marchandises. Rejouable : rien n'est dupliqué (cf. synchroniserProduits).
export async function POST() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    try {
      const boutique = await boutiqueConnectee(marchand.id);
      const synchro = await synchroniserProduits(boutique);
      return NextResponse.json({ synchro });
    } catch (error) {
      throw versApiError(error);
    }
  } catch (error) {
    return jsonError(error);
  }
}
