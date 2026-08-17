import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import type { Prisma } from '@/app/generated/prisma/client';
import type { Role } from '@/app/generated/prisma/enums';

// Comptes back-office pouvant être assignés/mentionnés sur une tâche (§
// /admin/tasks) — liste allégée, accessible à tous les rôles back-office
// (contrairement à /api/utilisateurs qui reste réservé à "admin").
const ROLES_BACKOFFICE: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'];

// ?equipeId=... restreint la liste aux membres de ce pôle (§ workflow
// d'assignation) — évite de polluer le menu "Assigné" avec tout le
// back-office quand une équipe précise est déjà sélectionnée dans le Kanban.
export async function GET(request: NextRequest) {
  try {
    await requireUser(ROLES_BACKOFFICE);
    const equipeId = request.nextUrl.searchParams.get('equipeId');

    const where: Prisma.UtilisateurWhereInput = { role: { in: ROLES_BACKOFFICE }, actif: true };
    if (equipeId) {
      where.equipesTaches = { some: { equipeId } };
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
