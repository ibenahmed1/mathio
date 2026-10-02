import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { boutiqueYoucanConnectee, synchroniserProduitsYoucan, versApiErrorYoucan } from '@/lib/youcan';

// § Intégration YouCan — réimporter le catalogue dans les Marchandises (rejouable).
export async function POST() {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    try {
      const synchro = await synchroniserProduitsYoucan(await boutiqueYoucanConnectee(marchand.id));
      return NextResponse.json({ synchro });
    } catch (error) {
      throw versApiErrorYoucan(error);
    }
  } catch (error) {
    return jsonError(error);
  }
}
