import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, parseStringIdArray, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

// Suppression groupée, même pattern/mêmes garde-fous que DELETE
// /api/commandes/[id] (statut 'nouveau_colis' uniquement, purge de
// l'historique/commentaires avant le delete pour respecter les FK RESTRICT).
export async function POST(request: NextRequest) {
  try {
    const session = await requireUser(['admin', 'marchand']);
    const body = await request.json();

    const ids = parseStringIdArray(body.colisIds);
    if (ids.length === 0) {
      throw new ApiError(400, 'Sélectionnez au moins un colis');
    }

    let marchandId: string | null = null;
    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand) {
        throw new ApiError(403, 'Profil marchand introuvable');
      }
      marchandId = marchand.id;
    }

    const colis = await prisma.commande.findMany({
      where: { id: { in: ids }, statut: 'nouveau_colis', ...(marchandId ? { marchandId } : {}) },
    });
    if (colis.length !== ids.length) {
      throw new ApiError(400, 'Un ou plusieurs colis sélectionnés ne sont plus supprimables (statut différent de "Nouveau Colis" ou hors de votre compte)');
    }

    await prisma.$transaction([
      prisma.historiqueStatutCommande.deleteMany({ where: { commandeId: { in: ids } } }),
      prisma.commentaireCommande.deleteMany({ where: { commandeId: { in: ids } } }),
      prisma.commande.deleteMany({ where: { id: { in: ids } } }),
    ]);

    return NextResponse.json({ deleted: colis.length });
  } catch (error) {
    return jsonError(error);
  }
}
