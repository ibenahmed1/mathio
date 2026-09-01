import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import { boardsVisibles, peutAssignerHorsPole } from '@/lib/taches-scope';
import type { Prisma } from '@/app/generated/prisma/client';
import type { Role } from '@/app/generated/prisma/enums';

// Comptes back-office pouvant être assignés/mentionnés sur une tâche (§
// /admin/tasks) — liste allégée, accessible à tous les rôles back-office
// (contrairement à /api/utilisateurs qui reste réservé à "admin").
const ROLES_BACKOFFICE: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'];

// ?equipeId=... restreint la liste aux membres de ce pôle (§ workflow
// d'assignation) : ouvrir le menu « Assigné » sur le board Design ne doit
// proposer que les gens qui ont accès à ce board.
//
// Deux régimes se superposent :
//   - le PARAMÈTRE `equipeId`, simple cadrage demandé par l'écran ;
//   - le PÉRIMÈTRE du compte connecté, lui imposé. Un membre ordinaire ne
//     peut interroger que les pôles dont il fait partie ; l'encadrement
//     projet (§ ROLES_ASSIGNATION_TOUS_POLES) n'est pas cloisonné, puisqu'il
//     doit pouvoir attribuer une tâche à n'importe qui.
// Sans le second, il suffisait de forger un `equipeId` pour lister les
// membres d'un pôle auquel on n'appartient pas.
export async function GET(request: NextRequest) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE);
    const equipeId = request.nextUrl.searchParams.get('equipeId');
    const scope = peutAssignerHorsPole(session.role) ? null : await boardsVisibles(session);

    const where: Prisma.UtilisateurWhereInput = { role: { in: ROLES_BACKOFFICE }, actif: true };
    if (equipeId) {
      // Pôle hors périmètre : liste vide plutôt qu'un refus, pour que le menu
      // s'affiche vide au lieu de casser l'écran sur une erreur.
      if (scope !== null && !scope.includes(equipeId)) return NextResponse.json({ data: [] });
      where.equipesTaches = { some: { equipeId } };
    } else if (scope !== null) {
      // Sans pôle demandé, un membre ordinaire ne voit que ses collègues de
      // pôle — et non tout le back-office comme auparavant.
      where.equipesTaches = { some: { equipeId: { in: scope } } };
    }

    const membres = await prisma.utilisateur.findMany({
      where,
      orderBy: { nomComplet: 'asc' },
      select: { id: true, nomComplet: true, role: true },
    });

    return NextResponse.json({ data: membres });
  } catch (error) {
    return jsonError(error);
  }
}
