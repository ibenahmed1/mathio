import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { originForHost } from '@/lib/spaces';
import { testerIdentifiantsYoucan, urlRetourOAuth, validerIdentifiants, versApiErrorYoucan } from '@/lib/youcan';

// § Intégration YouCan — tester le Client ID / Client Secret SANS rien
// enregistrer (pendant de /api/integrations/shopify/tester).
export async function POST(request: Request) {
  try {
    await requireUser(['marchand']);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, 'Corps JSON attendu');

    try {
      const identifiants = validerIdentifiants(body);
      await testerIdentifiantsYoucan(identifiants, urlRetourOAuth(originForHost(request.headers.get('host') ?? '')));
      return NextResponse.json({ ok: true });
    } catch (error) {
      throw versApiErrorYoucan(error);
    }
  } catch (error) {
    return jsonError(error);
  }
}
