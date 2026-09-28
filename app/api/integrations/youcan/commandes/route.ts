import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import {
  boutiqueYoucanConnectee,
  lireEtatBoutiqueYoucan,
  rattraperCommandesYoucan,
  versApiErrorYoucan,
} from '@/lib/youcan';

// § Intégration YouCan — importer les commandes récentes que le webhook n'a
// pas apportées. Rejouable : une commande déjà reçue n'est jamais doublée.
export async function POST() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    try {
      const rattrapage = await rattraperCommandesYoucan(await boutiqueYoucanConnectee(marchand.id));
      return NextResponse.json({ rattrapage, boutique: await lireEtatBoutiqueYoucan(marchand.id) });
    } catch (error) {
      throw versApiErrorYoucan(error);
    }
  } catch (error) {
    return jsonError(error);
  }
}
