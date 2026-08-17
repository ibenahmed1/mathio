import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

// Vérification d'unicité en direct (debounce côté formulaire "Ajouter Produit") :
// l'unicité de la référence est isolée par marchand, donc on ne teste que dans
// le catalogue du marchand connecté.
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

    const existant = await prisma.produit.findUnique({
      where: { marchandId_reference: { marchandId: marchand.id, reference } },
    });

    return NextResponse.json({ disponible: !existant });
  } catch (error) {
    return jsonError(error);
  }
}
