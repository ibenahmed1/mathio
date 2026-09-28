import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { activerWebhookBoutique, boutiqueConnectee, lireEtatBoutique, versApiError } from '@/lib/shopify';

// § Intégration Shopify — relancer l'abonnement au webhook des commandes, après
// un échec à la connexion (URL publique absente, refus de Shopify…). L'issue
// est consignée sur la boutique et renvoyée telle quelle.
export async function POST() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    try {
      await activerWebhookBoutique(await boutiqueConnectee(marchand.id));
    } catch (error) {
      throw versApiError(error);
    }
    return NextResponse.json({ boutique: await lireEtatBoutique(marchand.id) });
  } catch (error) {
    return jsonError(error);
  }
}
