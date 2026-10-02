import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError, requireUser } from '@/lib/api-utils';
import {
  SELECT_MEMBRE,
  assurerRolesSysteme,
  contexteEquipe,
  serialiserMembre,
  serialiserRole,
} from '@/lib/equipe-marchand';
import { ROLES_SYSTEME_MARCHAND } from '@/lib/permissions-marchand';

// § Équipe & accès (/marchand/equipe) — tout ce que l'écran affiche, en un
// appel : le titulaire, les membres, les rôles de la boutique et ce que
// l'utilisateur connecté peut y faire. Lecture gardée par `equipe.voir` (proxy,
// API_MARCHAND).
export async function GET() {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    await assurerRolesSysteme(ctx.marchand.id);

    const [titulaire, membres, roles] = await Promise.all([
      prisma.utilisateur.findUnique({
        where: { id: ctx.marchand.utilisateurId },
        select: { id: true, nomComplet: true, email: true, telephone: true, derniereConnexion: true, dateCreation: true },
      }),
      prisma.marchandMembre.findMany({
        where: { marchandId: ctx.marchand.id },
        orderBy: { dateAjout: 'desc' },
        select: SELECT_MEMBRE,
      }),
      prisma.roleMarchand.findMany({
        where: { marchandId: ctx.marchand.id },
        // Prédéfinis d'abord (dans l'ordre du catalogue), personnalisés ensuite.
        orderBy: [{ dateCreation: 'asc' }],
        include: { _count: { select: { membres: true } } },
      }),
    ]);

    const rang = (cle: string | null) => {
      const i = ROLES_SYSTEME_MARCHAND.findIndex((r) => r.cle === cle);
      return i === -1 ? ROLES_SYSTEME_MARCHAND.length : i;
    };
    const rolesSerialises = roles.map(serialiserRole).sort((a, b) => rang(a.cle) - rang(b.cle));

    return NextResponse.json({
      boutique: { id: ctx.marchand.id, nom: ctx.marchand.nomBoutique },
      moi: {
        utilisateurId: ctx.utilisateurId,
        estTitulaire: ctx.estTitulaire,
        permissions: ctx.permissions,
      },
      titulaire,
      membres: membres.map(serialiserMembre),
      roles: rolesSerialises,
    });
  } catch (error) {
    return jsonError(error);
  }
}
