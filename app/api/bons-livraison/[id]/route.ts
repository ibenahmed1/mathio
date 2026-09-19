import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { exigerMarchandOperationnel } from '@/lib/marchand-scope';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'marchand']);
    const { id } = await params;

    const bon = await prisma.bonDeLivraison.findUnique({
      where: { id },
      include: {
        marchand: {
          select: { nomBoutique: true, utilisateur: { select: { nomComplet: true, telephone: true } } },
        },
        commandes: { orderBy: { codeSuivi: 'asc' } },
      },
    });

    if (!bon) throw new ApiError(404, 'Bon de livraison introuvable');

    // RG-07 / RNF-02 : cloisonnement des données par rôle, et § inscription
    // progressive : un dossier incomplet n'ouvre aucun bon, même le sien.
    if (session.role === 'marchand') {
      const marchand = await exigerMarchandOperationnel(session.sub);
      if (marchand.id !== bon.marchandId) throw new ApiError(403, 'Accès refusé');
    }

    return NextResponse.json(bon);
  } catch (error) {
    return jsonError(error);
  }
}
