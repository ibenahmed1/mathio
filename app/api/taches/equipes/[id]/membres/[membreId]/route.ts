import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

// Composition des équipes — les rôles cantonnés au Kanban (design,
// gestionnaire_hub) n'y ont pas accès, cf. app/api/taches/equipes/[id]/membres/route.ts.
const ROLES_GESTION_EQUIPES: Role[] = (
  ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'] as Role[]
).filter((r) => !ROLES_KANBAN_UNIQUEMENT.includes(r));

// Retire un membre du pôle sans désactiver son compte : contrairement à
// MarchandMembre, un utilisateur interne peut appartenir à d'autres équipes
// ou rester assignable hors pôle (voir /api/taches/membres).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; membreId: string }> }
) {
  try {
    const session = await requireUser(ROLES_GESTION_EQUIPES);
    // Refus explicite : design et gestionnaire_hub passent requireUser par
    // la permission `poles:members` qu'ils détiennent par défaut.
    if (ROLES_KANBAN_UNIQUEMENT.includes(session.role)) {
      throw new ApiError(403, 'Accès refusé pour ce rôle');
    }
    const { id, membreId } = await params;

    const membre = await prisma.equipeTacheMembre.findUnique({ where: { id: membreId } });
    if (!membre || membre.equipeId !== id) {
      throw new ApiError(404, 'Membre introuvable');
    }

    await prisma.equipeTacheMembre.delete({ where: { id: membreId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
