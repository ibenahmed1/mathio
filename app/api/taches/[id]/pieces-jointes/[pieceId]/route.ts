import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_BACKOFFICE_TACHES, peutModifierTache } from '@/lib/taches-scope';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; pieceId: string }> }
) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE_TACHES);
    const { id, pieceId } = await params;

    const tache = await prisma.tache.findUnique({ where: { id } });
    if (!tache) throw new ApiError(404, 'Tâche introuvable');
    if (!peutModifierTache(session, tache)) {
      throw new ApiError(403, 'Vous ne pouvez modifier que les tâches que vous avez créées ou qui vous sont attribuées');
    }

    const piece = await prisma.pieceJointeTache.findUnique({ where: { id: pieceId } });
    if (!piece || piece.tacheId !== id) throw new ApiError(404, 'Pièce jointe introuvable');

    await prisma.pieceJointeTache.delete({ where: { id: pieceId } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
