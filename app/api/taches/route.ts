import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import { ROLES_BACKOFFICE_TACHES } from '@/lib/taches-scope';
import type { Prisma } from '@/app/generated/prisma/client';
import { PRIORITES_TACHE, STATUTS_TACHE, ETIQUETTES_TACHE } from '@/lib/statuts';

const ROLES_BACKOFFICE = ROLES_BACKOFFICE_TACHES;

const INCLUDE = {
  team: true,
  assignee: { select: { id: true, nomComplet: true } },
  createur: { select: { id: true, nomComplet: true } },
  _count: { select: { commentaires: true } },
} satisfies Prisma.TacheInclude;

// Tableau Kanban (§ /admin/tasks) : renvoie toutes les tâches (tous statuts,
// regroupées par colonne côté client) filtrées optionnellement par équipe/assigné.
export async function GET(request: NextRequest) {
  try {
    await requireUser(ROLES_BACKOFFICE);
    const teamId = request.nextUrl.searchParams.get('teamId');
    const assigneeId = request.nextUrl.searchParams.get('assigneeId');

    const where: Prisma.TacheWhereInput = {};
    if (teamId) where.teamId = teamId;
    if (assigneeId) where.assigneeId = assigneeId;

    const taches = await prisma.tache.findMany({
      where,
      orderBy: { dateCreation: 'desc' },
      include: INCLUDE,
    });

    return NextResponse.json({ data: taches });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE);
    const body = await request.json();

    const titre = typeof body.titre === 'string' ? body.titre.trim() : '';
    const teamId = typeof body.teamId === 'string' ? body.teamId : '';
    if (!titre) throw new ApiError(400, 'titre est requis');
    if (!teamId) throw new ApiError(400, 'teamId est requis');

    const team = await prisma.equipeTache.findUnique({ where: { id: teamId } });
    if (!team) throw new ApiError(400, 'Équipe invalide');

    const priorite = typeof body.priorite === 'string' ? body.priorite : 'moyenne';
    if (!PRIORITES_TACHE.includes(priorite as (typeof PRIORITES_TACHE)[number])) {
      throw new ApiError(400, `priorite invalide. Valeurs possibles : ${PRIORITES_TACHE.join(', ')}`);
    }

    // statut optionnel : permet la création rapide directement dans une
    // colonne du Kanban (composer inline) plutôt que de forcer "a_faire" puis
    // un second appel PATCH.
    const statut = typeof body.statut === 'string' ? body.statut : 'a_faire';
    if (!STATUTS_TACHE.includes(statut as (typeof STATUTS_TACHE)[number])) {
      throw new ApiError(400, `statut invalide. Valeurs possibles : ${STATUTS_TACHE.join(', ')}`);
    }

    let assigneeId: string | null = null;
    if (typeof body.assigneeId === 'string' && body.assigneeId) {
      // Assignation réservée aux rôles hors Kanban-only (design, gestionnaire_hub) —
      // cf. app/api/taches/[id]/route.ts pour la même règle côté édition.
      if (ROLES_KANBAN_UNIQUEMENT.includes(session.role)) {
        throw new ApiError(403, 'Accès refusé : ce rôle ne peut pas assigner de tâche');
      }
      const assignee = await prisma.utilisateur.findUnique({ where: { id: body.assigneeId } });
      if (!assignee) throw new ApiError(400, 'assigneeId invalide');
      assigneeId = assignee.id;
    }

    const dateEcheance =
      typeof body.dateEcheance === 'string' && body.dateEcheance ? new Date(body.dateEcheance) : null;

    let etiquettes: string[] = [];
    if (Array.isArray(body.etiquettes)) {
      if (!body.etiquettes.every((e: unknown) => ETIQUETTES_TACHE.includes(e as (typeof ETIQUETTES_TACHE)[number]))) {
        throw new ApiError(400, `etiquettes invalides. Valeurs possibles : ${ETIQUETTES_TACHE.join(', ')}`);
      }
      etiquettes = body.etiquettes;
    }

    const tache = await prisma.$transaction(async (tx) => {
      const created = await tx.tache.create({
        data: {
          titre,
          description: typeof body.description === 'string' && body.description ? body.description : null,
          teamId,
          assigneeId,
          createurId: session.sub,
          priorite: priorite as (typeof PRIORITES_TACHE)[number],
          statut: statut as (typeof STATUTS_TACHE)[number],
          dateEcheance,
          etiquettes,
        },
        include: INCLUDE,
      });

      // Traçabilité du temps passé par colonne (§ /admin/tasks) : première
      // entrée de l'historique, sans ancien statut.
      await tx.historiqueStatutTache.create({
        data: { tacheId: created.id, ancienStatut: null, nouveauStatut: created.statut, utilisateurId: session.sub },
      });

      return created;
    });

    return NextResponse.json(tache, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
