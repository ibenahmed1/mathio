import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { hashSecret, ROLES_KANBAN_UNIQUEMENT, getPasswordPolicyError } from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

const ROLES_BACKOFFICE: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'];

// Composition des équipes (ajout/retrait/invitation de membres) — les rôles
// cantonnés au Kanban (design, gestionnaire_hub) n'y ont pas accès : ils
// utilisent le tableau mais ne pilotent pas l'organisation des pôles.
const ROLES_GESTION_EQUIPES: Role[] = ROLES_BACKOFFICE.filter(
  (r) => !ROLES_KANBAN_UNIQUEMENT.includes(r)
);

const SELECT_MEMBRE = {
  id: true,
  dateAjout: true,
  utilisateur: { select: { id: true, nomComplet: true, email: true, role: true, actif: true } },
} as const;

async function getEquipe(id: string) {
  const equipe = await prisma.equipeTache.findUnique({ where: { id } });
  if (!equipe) throw new ApiError(404, 'Équipe introuvable');
  return equipe;
}

// Remplace en un appel la composition d'une équipe (§ workflow d'assignation,
// case à cocher "multi-select" côté UI) : synchronise vers l'ensemble
// utilisateurIds fourni plutôt que d'exiger un appel par membre ajouté/retiré.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(ROLES_GESTION_EQUIPES);
    const { id } = await params;
    await getEquipe(id);

    const body = await request.json();
    const utilisateurIds: string[] = Array.isArray(body.utilisateurIds)
      ? body.utilisateurIds.filter((v: unknown) => typeof v === 'string')
      : [];

    const actuels = await prisma.equipeTacheMembre.findMany({ where: { equipeId: id } });
    const actuelsIds = new Set(actuels.map((m) => m.utilisateurId));
    const voulusIds = new Set(utilisateurIds);

    const aRetirer = actuels.filter((m) => !voulusIds.has(m.utilisateurId)).map((m) => m.id);
    const aAjouter = utilisateurIds.filter((uid) => !actuelsIds.has(uid));

    await prisma.$transaction([
      prisma.equipeTacheMembre.deleteMany({ where: { id: { in: aRetirer } } }),
      ...aAjouter.map((utilisateurId) =>
        prisma.equipeTacheMembre.create({ data: { equipeId: id, utilisateurId } })
      ),
    ]);

    const membres = await prisma.equipeTacheMembre.findMany({
      where: { equipeId: id },
      orderBy: { dateAjout: 'asc' },
      select: SELECT_MEMBRE,
    });

    return NextResponse.json({ data: membres });
  } catch (error) {
    return jsonError(error);
  }
}

// Invitation d'une personne qui n'a pas encore de compte (§ workflow
// d'assignation) : crée le compte Utilisateur puis l'associe directement à
// l'équipe, en un seul appel — même schéma que /api/marchands/membres
// (email + mot de passe choisi par l'invitant, pas de téléphone requis).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(ROLES_GESTION_EQUIPES);
    const { id } = await params;
    await getEquipe(id);

    const body = await request.json();
    const nomComplet = typeof body.nomComplet === 'string' ? body.nomComplet.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const secret = typeof body.secret === 'string' ? body.secret : '';
    const role = body.role as Role | undefined;

    if (!nomComplet || !email || !secret || !role) {
      throw new ApiError(400, 'nomComplet, email, secret et role sont requis');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, 'Email invalide');
    }
    const passwordError = getPasswordPolicyError(secret);
    if (passwordError) {
      throw new ApiError(400, passwordError);
    }
    if (!ROLES_BACKOFFICE.includes(role)) {
      throw new ApiError(400, `Rôle invalide. Valeurs possibles : ${ROLES_BACKOFFICE.join(', ')}`);
    }

    const existant = await prisma.utilisateur.findUnique({ where: { email } });
    if (existant) {
      throw new ApiError(409, 'Cet email est déjà utilisé');
    }

    const motDePasseHash = await hashSecret(secret);

    const membre = await prisma.$transaction(async (tx) => {
      const utilisateur = await tx.utilisateur.create({
        data: { nomComplet, email, motDePasseHash, role, actif: true },
      });
      return tx.equipeTacheMembre.create({
        data: { equipeId: id, utilisateurId: utilisateur.id },
        select: SELECT_MEMBRE,
      });
    });

    return NextResponse.json(membre, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
