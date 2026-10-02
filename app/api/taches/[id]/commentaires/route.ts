import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { boardsVisibles, exigerTacheAutorisee } from '@/lib/taches-scope';
import type { Role } from '@/app/generated/prisma/enums';
import { lecteursTache, notifier } from '@/lib/notifications';

function extraitCommentaire(texte: string): string {
  return texte.length > 140 ? `${texte.slice(0, 140)}…` : texte;
}

const ROLES_BACKOFFICE: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'];

// Fil de discussion d'une tâche, avec mentions "@membre" (§ /admin/tasks).
// Les mentionnés reçoivent une notification (tache.mention) ; l'assigné et le
// créateur, s'ils ne sont pas mentionnés, une notification de commentaire. Dans
// les deux cas, seulement s'ils peuvent lire la tâche (lecteursTache).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE);
    const { id } = await params;
    const body = await request.json();

    const texte = typeof body.texte === 'string' ? body.texte.trim() : '';
    if (!texte) throw new ApiError(400, 'Le champ texte est requis');

    const tache = await prisma.tache.findUnique({ where: { id } });
    if (!tache) throw new ApiError(404, 'Tâche introuvable');
    // Commenter / joindre un document suit le périmètre de la tâche elle-même
    // (§ boardsVisibles) : hors de ses pôles, la tâche n'existe pas.
    exigerTacheAutorisee(session, await boardsVisibles(session), tache);

    const mentionIds = Array.isArray(body.mentionIds)
      ? body.mentionIds.filter((v: unknown): v is string => typeof v === 'string')
      : [];

    const commentaire = await prisma.commentaireTache.create({
      data: { tacheId: id, auteurId: session.sub, texte, mentionIds },
      include: { auteur: { select: { id: true, nomComplet: true } } },
    });

    // § Notifications — la mention prime : quelqu'un de mentionné ET assigné
    // ne reçoit qu'une notification, la plus précise.
    const mentionnes = await lecteursTache(tache, mentionIds);
    const auteur = commentaire.auteur.nomComplet;
    await notifier(mentionnes, {
      type: 'tache.mention',
      titre: `${auteur} vous a mentionné · ${tache.titre}`,
      corps: extraitCommentaire(texte),
      lien: '/admin/tasks',
    }, { sauf: session.sub });
    const suiveurs = [tache.assigneeId, tache.createurId].filter((u): u is string => !!u && !mentionnes.includes(u));
    await notifier(await lecteursTache(tache, suiveurs), {
      type: 'tache.commentaire',
      titre: `${auteur} a commenté · ${tache.titre}`,
      corps: extraitCommentaire(texte),
      lien: '/admin/tasks',
    }, { sauf: session.sub });

    return NextResponse.json(commentaire, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
