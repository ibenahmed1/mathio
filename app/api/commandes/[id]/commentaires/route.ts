import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await params;

    const commentaires = await prisma.commentaireCommande.findMany({
      where: { commandeId: id },
      orderBy: { dateCreation: 'asc' },
      include: { utilisateur: { select: { nomComplet: true } } },
    });

    return NextResponse.json({ data: commentaires });
  } catch (error) {
    return jsonError(error);
  }
}

// Notes internes sur un colis (équipe uniquement — le marchand ne poste pas).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'agent_confirmation', 'livreur', 'ramasseur', 'sav', 'finance']);
    const { id } = await params;
    const body = await request.json();

    const texte = typeof body.texte === 'string' ? body.texte.trim() : '';
    if (!texte) {
      throw new ApiError(400, 'Le champ texte est requis');
    }

    const commande = await prisma.commande.findUnique({ where: { id } });
    if (!commande) {
      throw new ApiError(404, 'Commande introuvable');
    }

    const commentaire = await prisma.commentaireCommande.create({
      data: { commandeId: id, utilisateurId: session.sub, texte },
      include: { utilisateur: { select: { nomComplet: true } } },
    });

    return NextResponse.json(commentaire, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
