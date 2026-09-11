import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_BACKOFFICE_TACHES, peutModifierTache, boardsVisibles, exigerTacheAutorisee } from '@/lib/taches-scope';
import { analyserPieceJointe, nomParDefaut } from '@/lib/pieces-jointes';
import { piecesJointesExposees } from '@/lib/taches-pieces-jointes';

// Pièces jointes d'une tâche (§ /admin/tasks) : un lien externe, ou un fichier
// déposé encodé en data URL dans la même colonne — voir lib/pieces-jointes.ts
// pour la convention de stockage et la liste des formats acceptés. Soumises à
// la même règle que la modification de la description : les rôles Kanban-only
// ne peuvent en ajouter que sur les tâches qu'ils ont créées ou qui leur sont
// attribuées (§ peutModifierTache).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE_TACHES);
    const { id } = await params;
    const body = await request.json();

    const brut = typeof body.url === 'string' ? body.url.trim() : '';
    if (!brut) throw new ApiError(400, 'url est requis');

    const analyse = analyserPieceJointe(brut);
    if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);

    // Le nom n'est plus obligatoire : personne n'a envie de baptiser une
    // capture d'écran qu'il vient de déposer, et un rejet à ce motif faisait
    // perdre le fichier déjà encodé.
    const saisi = typeof body.nom === 'string' ? body.nom.trim() : '';
    const nom = saisi || nomParDefaut(analyse.piece);

    const tache = await prisma.tache.findUnique({ where: { id } });
    if (!tache) throw new ApiError(404, 'Tâche introuvable');
    // Commenter / joindre un document suit le périmètre de la tâche elle-même
    // (§ boardsVisibles) : hors de ses pôles, la tâche n'existe pas.
    exigerTacheAutorisee(session, await boardsVisibles(session), tache);
    if (!peutModifierTache(session, tache)) {
      throw new ApiError(403, 'Vous ne pouvez modifier que les tâches que vous avez créées ou qui vous sont attribuées');
    }

    // On stocke la forme normalisée (data URL sans blancs, lien avec son
    // schéma) et non la saisie : la relecture n'a plus à rattraper quoi que
    // ce soit.
    const url =
      analyse.piece.kind === 'lien'
        ? analyse.piece.url
        : `data:${analyse.piece.mime};base64,${analyse.piece.base64}`;

    const piece = await prisma.pieceJointeTache.create({ data: { tacheId: id, nom, url, auteurId: session.sub } });

    // On renvoie la forme exposée, jamais la ligne brute : le contenu d'un
    // fichier ne repart pas dans la réponse qui vient de l'écrire.
    const exposees = await piecesJointesExposees(id);
    const creee = exposees.find((p) => p.id === piece.id);
    return NextResponse.json(creee ?? { id: piece.id, nom }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
