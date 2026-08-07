import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { Role } from '@/app/generated/prisma/enums';

// Notes internes sur un colis (équipe uniquement — le marchand ne les voit
// pas, il ne peut d'ailleurs pas non plus en poster). Partagé entre GET et POST.
const ROLES_NOTES_INTERNES: Role[] = ['admin', 'superviseur', 'equipe_suivi', 'moderateur', 'responsable', 'livreur', 'ramasseur'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(ROLES_NOTES_INTERNES);
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_NOTES_INTERNES);
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
