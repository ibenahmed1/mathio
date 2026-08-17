import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_BACKOFFICE_TACHES, peutModifierTache } from '@/lib/taches-scope';

// Pièces jointes d'une tâche (§ /admin/tasks) : lien nommé (pas d'upload de
// fichier, cf. lib/taches-scope.ts et le modèle PieceJointeTache). Soumises à
// la même règle que la modification de la description : les rôles Kanban-only
// ne peuvent en ajouter que sur les tâches qu'ils ont créées ou qui leur sont
// attribuées (§ peutModifierTache).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE_TACHES);
    const { id } = await params;
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!nom) throw new ApiError(400, 'nom est requis');
    if (!url) throw new ApiError(400, 'url est requis');
    if (!/^https?:\/\//i.test(url)) throw new ApiError(400, "url doit être un lien http(s) valide");

    const tache = await prisma.tache.findUnique({ where: { id } });
    if (!tache) throw new ApiError(404, 'Tâche introuvable');
    if (!peutModifierTache(session, tache)) {
      throw new ApiError(403, 'Vous ne pouvez modifier que les tâches que vous avez créées ou qui vous sont attribuées');
    }

    const piece = await prisma.pieceJointeTache.create({
      data: { tacheId: id, nom, url, auteurId: session.sub },
      include: { auteur: { select: { id: true, nomComplet: true } } },
    });

    return NextResponse.json(piece, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
