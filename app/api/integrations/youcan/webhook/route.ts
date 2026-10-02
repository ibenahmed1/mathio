import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import {
  activerWebhooksYoucan,
  boutiqueYoucanConnectee,
  lireEtatBoutiqueYoucan,
  versApiErrorYoucan,
} from '@/lib/youcan';

// § Intégration YouCan — relancer l'abonnement aux webhooks après un échec.
export async function POST() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    try {
      await activerWebhooksYoucan(await boutiqueYoucanConnectee(marchand.id));
    } catch (error) {
      throw versApiErrorYoucan(error);
    }
    return NextResponse.json({ boutique: await lireEtatBoutiqueYoucan(marchand.id) });
  } catch (error) {
    return jsonError(error);
  }
}
