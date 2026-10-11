import { NextResponse } from 'next/server';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { skuDejaPris } from '@/lib/stock-sku';

// Vérification d'unicité en direct (debounce côté formulaire "Ajouter Produit") :
// l'unicité de la référence est isolée par marchand, donc on ne teste que dans
// le catalogue du marchand connecté — produits ET variantes, sans casse
// (lib/stock-sku.ts), exactement comme la création.
export async function GET(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');

    const { searchParams } = new URL(request.url);
    const reference = (searchParams.get('reference') ?? '').trim();
    if (!reference) {
      throw new ApiError(400, 'reference est requise');
    }

    return NextResponse.json({ disponible: !(await skuDejaPris(marchand.id, [reference])) });
  } catch (error) {
    return jsonError(error);
  }
}
