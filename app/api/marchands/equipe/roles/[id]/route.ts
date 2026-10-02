import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import {
  contexteEquipe,
  contientTout,
  exigerSansEscalade,
  journaliser,
  lireDescriptionRole,
  lireNomRole,
  serialiserRole,
  type ContexteEquipe,
} from '@/lib/equipe-marchand';
import { nettoyerPermissionsMarchand, permissionsDuRole } from '@/lib/permissions-marchand';

async function roleModifiable(ctx: ContexteEquipe, id: string) {
  const role = await prisma.roleMarchand.findUnique({
    where: { id },
    include: { _count: { select: { membres: true } } },
  });
  if (!role || role.marchandId !== ctx.marchand.id) throw new ApiError(404, 'Rôle introuvable');
  if (role.cle) {
    throw new ApiError(409, 'Un rôle prédéfini ne se modifie pas : dupliquez-le pour en faire un rôle personnalisé');
  }
  if (!ctx.estTitulaire) {
    // Règle 3 appliquée aux rôles : modifier le rôle qu'on porte, c'est
    // modifier ses propres droits.
    const monRole = await prisma.marchandMembre.findUnique({
      where: { utilisateurId: ctx.utilisateurId },
      select: { roleId: true },
    });
    if (monRole?.roleId === role.id) {
      throw new ApiError(403, 'Vous ne pouvez pas modifier le rôle que vous portez vous-même');
    }
    // Règle 2 : un rôle plus large que ses propres droits reste hors de portée.
    if (!contientTout(ctx.permissions, permissionsDuRole(role))) {
      throw new ApiError(403, 'Ce rôle accorde des droits que vous n’avez pas : seul le titulaire peut le modifier');
    }
  }
  return role;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const { id } = await params;
    const role = await roleModifiable(ctx, id);
    const body = await request.json();

    const data: { nom?: string; description?: string | null; permissions?: string[] } = {};
    if ('nom' in body) {
      const nom = lireNomRole(body.nom);
      if (nom.toLowerCase() !== role.nom.toLowerCase()) {
        const doublon = await prisma.roleMarchand.findFirst({
          where: { marchandId: ctx.marchand.id, nom: { equals: nom, mode: 'insensitive' }, NOT: { id } },
          select: { id: true },
        });
        if (doublon) throw new ApiError(409, 'Un rôle porte déjà ce nom');
      }
      data.nom = nom;
    }
    if ('description' in body) data.description = lireDescriptionRole(body.description);
    if ('permissions' in body) {
      const permissions = nettoyerPermissionsMarchand(body.permissions);
      if (permissions.length === 0) throw new ApiError(400, 'Cochez au moins une permission');
      exigerSansEscalade(ctx, permissions);
      data.permissions = permissions;
    }

    const misAJour = await prisma.roleMarchand.update({
      where: { id },
      data,
      include: { _count: { select: { membres: true } } },
    });

    // Détail lisible des droits ajoutés/retirés : c'est ce qu'on cherche dans
    // un journal quand un membre « n'a plus accès depuis hier ».
    const details: string[] = [];
    if (data.nom && data.nom !== role.nom) details.push(`renommé (ancien nom : « ${role.nom} »)`);
    if (data.permissions) {
      const avant = new Set(permissionsDuRole(role));
      const apres = new Set(data.permissions);
      const ajoutees = [...apres].filter((p) => !avant.has(p)).length;
      const retirees = [...avant].filter((p) => !apres.has(p)).length;
      if (ajoutees) details.push(`${ajoutees} droit${ajoutees > 1 ? 's' : ''} ajouté${ajoutees > 1 ? 's' : ''}`);
      if (retirees) details.push(`${retirees} droit${retirees > 1 ? 's' : ''} retiré${retirees > 1 ? 's' : ''}`);
      if (role._count.membres > 0 && (ajoutees || retirees)) {
        details.push(`${role._count.membres} membre${role._count.membres > 1 ? 's' : ''} concerné${role._count.membres > 1 ? 's' : ''}`);
      }
    }
    await journaliser(ctx, 'role_modifie', misAJour.nom, details.join(', ') || null);

    return NextResponse.json({ role: serialiserRole(misAJour) });
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression d'un rôle personnalisé. S'il est encore porté, `?reaffecterVers=`
// désigne le rôle qui le remplace pour ses membres — dans la même transaction,
// pour qu'aucun membre ne se retrouve un instant sans rôle. Sans ce paramètre,
// la suppression d'un rôle porté est refusée (409) et l'écran propose le choix.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const { id } = await params;
    const role = await roleModifiable(ctx, id);
    const cibleId = request.nextUrl.searchParams.get('reaffecterVers');

    if (role._count.membres > 0) {
      if (!cibleId) {
        throw new ApiError(409, 'Ce rôle est encore attribué : choisissez le rôle qui le remplacera pour ses membres');
      }
      if (cibleId === id) throw new ApiError(400, 'Choisissez un autre rôle');
      const cible = await prisma.roleMarchand.findUnique({ where: { id: cibleId } });
      if (!cible || cible.marchandId !== ctx.marchand.id) throw new ApiError(400, 'Rôle de remplacement introuvable');
      exigerSansEscalade(ctx, permissionsDuRole(cible));

      await prisma.$transaction([
        prisma.marchandMembre.updateMany({ where: { roleId: id }, data: { roleId: cible.id } }),
        prisma.roleMarchand.delete({ where: { id } }),
      ]);
      await journaliser(
        ctx,
        'role_supprime',
        role.nom,
        `${role._count.membres} membre${role._count.membres > 1 ? 's' : ''} réaffecté${role._count.membres > 1 ? 's' : ''} à « ${cible.nom} »`
      );
    } else {
      await prisma.roleMarchand.delete({ where: { id } });
      await journaliser(ctx, 'role_supprime', role.nom);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
