import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Édition admin de l'emplacement d'entrepôt d'une variante (page "Modifier
// produit"). Le nom et la référence d'une variante restent immuables une
// fois créés, comme pour Produit.reference.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const variante = await prisma.produitVariante.findUnique({ where: { id } });
    if (!variante) throw new ApiError(404, 'Variante introuvable');

    const body = await request.json();
    if (!('rayonnage' in body)) {
      throw new ApiError(400, 'rayonnage est requis');
    }
    const rayonnage = typeof body.rayonnage === 'string' && body.rayonnage.trim() ? body.rayonnage.trim() : null;

    const updated = await prisma.produitVariante.update({ where: { id }, data: { rayonnage } });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
