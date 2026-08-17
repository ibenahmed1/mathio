import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { Role } from '@/app/generated/prisma/enums';

const ROLES_BACKOFFICE: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'];

// Fil de discussion d'une tâche, avec mentions "@membre" (§ /admin/tasks).
// mentionIds n'est qu'un surlignage côté UI, aucune notification n'est envoyée.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE);
    const { id } = await params;
    const body = await request.json();

    const texte = typeof body.texte === 'string' ? body.texte.trim() : '';
    if (!texte) throw new ApiError(400, 'Le champ texte est requis');

    const tache = await prisma.tache.findUnique({ where: { id } });
    if (!tache) throw new ApiError(404, 'Tâche introuvable');

    const mentionIds = Array.isArray(body.mentionIds)
      ? body.mentionIds.filter((v: unknown): v is string => typeof v === 'string')
      : [];

    const commentaire = await prisma.commentaireTache.create({
      data: { tacheId: id, auteurId: session.sub, texte, mentionIds },
      include: { auteur: { select: { id: true, nomComplet: true } } },
    });

    return NextResponse.json(commentaire, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
