import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { originForHost } from '@/lib/spaces';
import {
  deconnecterBoutiqueYoucan,
  lireEtatBoutiqueYoucan,
  urlRetourOAuth,
  urlWebhookYoucan,
  versApiErrorYoucan,
} from '@/lib/youcan';

// § Intégration YouCan — la boutique du marchand connecté
// (/marchand/integrations). Réservé au rôle marchand, comme Shopify. La
// connexion passe par ./tester, ./connecter puis le retour OAuth ./callback.

async function marchandConnecte(): Promise<string> {
  const session = await requireUser(['marchand']);
  const marchand = await resolveMarchandForUser(session.sub);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return marchand.id;
}

export async function GET(request: Request) {
  try {
    const marchandId = await marchandConnecte();
    return NextResponse.json({
      boutique: await lireEtatBoutiqueYoucan(marchandId),
      // À déclarer par le marchand dans SON application YouCan : l'écran la
      // lui affiche, prête à copier.
      urlRetour: urlRetourOAuth(originForHost(request.headers.get('host') ?? '')),
      urlPubliqueConfiguree: urlWebhookYoucan() !== null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE() {
  try {
    const marchandId = await marchandConnecte();
    try {
      await deconnecterBoutiqueYoucan(marchandId);
    } catch (error) {
      throw versApiErrorYoucan(error);
    }
    return NextResponse.json({ boutique: await lireEtatBoutiqueYoucan(marchandId) });
  } catch (error) {
    return jsonError(error);
  }
}
