import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import {
  contexteEquipe,
  exigerSansEscalade,
  journaliser,
  lireDescriptionRole,
  lireNomRole,
  serialiserRole,
} from '@/lib/equipe-marchand';
import { nettoyerPermissionsMarchand, permissionsDuRole } from '@/lib/permissions-marchand';

// Création d'un rôle personnalisé, à partir de zéro ou en dupliquant un rôle
// existant (`dupliquerDe`) — c'est ainsi qu'on « modifie » un rôle prédéfini.
// Les permissions sont nettoyées (clés inconnues retirées, dépendances
// ajoutées) avant le contrôle d'escalade : c'est la liste réellement accordée
// qui est confrontée aux droits de l'auteur.
export async function POST(request: Request) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const body = await request.json();

    let permissions = nettoyerPermissionsMarchand(body.permissions);
    let description = lireDescriptionRole(body.description);
    if (typeof body.dupliquerDe === 'string' && body.dupliquerDe) {
      const source = await prisma.roleMarchand.findUnique({ where: { id: body.dupliquerDe } });
      if (!source || source.marchandId !== ctx.marchand.id) throw new ApiError(404, 'Rôle source introuvable');
      if (!Array.isArray(body.permissions)) permissions = permissionsDuRole(source);
      if (description === null) description = source.description;
    }
    const nom = lireNomRole(body.nom);
    if (permissions.length === 0) throw new ApiError(400, 'Cochez au moins une permission');
    exigerSansEscalade(ctx, permissions);

    const doublon = await prisma.roleMarchand.findFirst({
      where: { marchandId: ctx.marchand.id, nom: { equals: nom, mode: 'insensitive' } },
      select: { id: true },
    });
    if (doublon) throw new ApiError(409, 'Un rôle porte déjà ce nom');

    const role = await prisma.roleMarchand.create({
      data: { marchandId: ctx.marchand.id, nom, description, permissions },
      include: { _count: { select: { membres: true } } },
    });

    await journaliser(ctx, 'role_cree', nom, `${permissions.length} permission${permissions.length > 1 ? 's' : ''}`);
    return NextResponse.json({ role: serialiserRole(role) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
