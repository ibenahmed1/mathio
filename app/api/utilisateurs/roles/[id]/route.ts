import { NextResponse } from 'next/server';
import type { Role } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { analyserRole } from '@/lib/roles-backoffice';
import { idRolePredefini } from '@/lib/roles-backoffice-serveur';
import { journaliserCompte } from '@/lib/journal-equipe-admin';

// § Équipe & rôles : modifier ou supprimer un rôle de l'équipe.
//
// Un rôle PRÉDÉFINI se modifie (description, permissions) mais ne se supprime
// pas, et garde son nom et sa fonction. Un rôle PERSONNALISÉ se modifie
// entièrement et se supprime. Dans les deux cas, les comptes qui le portent
// gardent leurs permissions : le rôle pré-coche à l'attribution, il ne
// gouverne pas ensuite (décision du 07/10/2026).

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const existant = await prisma.roleBackoffice.findUnique({ where: { id } });
    if (!existant) throw new ApiError(404, 'Rôle introuvable');

    const analyse = analyserRole(await request.json().catch(() => ({})), {
      creation: false,
      predefini: existant.cle !== null,
      fonctionActuelle: existant.fonction,
    });
    if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);
    const { nom, description, fonction, permissions } = analyse.valeur;

    if (nom && nom.toLowerCase() !== existant.nom.toLowerCase()) {
      const homonyme = await prisma.roleBackoffice.findFirst({
        where: { nom: { equals: nom, mode: 'insensitive' }, id: { not: id } },
        select: { id: true },
      });
      if (homonyme) throw new ApiError(409, `Un rôle « ${nom} » existe déjà`);
    }

    await prisma.roleBackoffice.update({
      where: { id },
      data: {
        ...(nom !== undefined && { nom }),
        ...(description !== undefined && { description }),
        ...(fonction !== undefined && { fonction: fonction as Role }),
        ...(permissions !== undefined && { permissions }),
      },
    });

    const changements = [
      nom !== undefined && nom !== existant.nom && `renommé (« ${existant.nom} » → « ${nom} »)`,
      permissions !== undefined &&
        [...permissions].sort().join() !== [...existant.permissions].sort().join() &&
        `${existant.permissions.length} → ${permissions.length} droit(s)`,
      fonction !== undefined && fonction !== existant.fonction && 'fonction de base changée',
    ].filter(Boolean);
    await journaliserCompte({
      request,
      adminId: session.sub,
      action: 'role_modifie',
      cibleId: id,
      details: changements.length ? changements.join(' · ') : null,
    });

    return NextResponse.json({ id });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const role = await prisma.roleBackoffice.findUnique({ where: { id }, select: { nom: true, cle: true, fonction: true } });
    if (!role) throw new ApiError(404, 'Rôle introuvable');
    if (role.cle !== null) throw new ApiError(400, 'Un rôle prédéfini ne se supprime pas : modifiez-le plutôt');

    // Ses membres passent sur le rôle prédéfini de leur fonction — même
    // fonction technique, donc mêmes routes ouvertes. Leurs permissions, elles,
    // ne bougent pas.
    const remplacant = await idRolePredefini(role.fonction);
    const { count } = await prisma.$transaction(async (tx) => {
      const deplaces = await tx.utilisateur.updateMany({ where: { roleBackofficeId: id }, data: { roleBackofficeId: remplacant } });
      await tx.roleBackoffice.delete({ where: { id } });
      return deplaces;
    });

    await journaliserCompte({
      request,
      adminId: session.sub,
      action: 'role_supprime',
      cibleId: id,
      details: `${role.nom}${count ? ` · ${count} membre(s) rattaché(s) au rôle prédéfini` : ''}`,
    });

    return NextResponse.json({ success: true, membresDeplaces: count });
  } catch (error) {
    return jsonError(error);
  }
}
