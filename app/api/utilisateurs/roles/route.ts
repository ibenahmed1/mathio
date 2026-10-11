import { NextResponse } from 'next/server';
import type { Role } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { analyserRole } from '@/lib/roles-backoffice';
import { listerRolesBackoffice } from '@/lib/roles-backoffice-serveur';
import { journaliserCompte } from '@/lib/journal-equipe-admin';
import { nomFonction } from '@/lib/fonctions-equipe';

// § Équipe & rôles, onglet Rôles & permissions : lister les rôles de l'équipe
// (prédéfinis créés au besoin) et en créer un personnalisé.
export async function GET() {
  try {
    await requireUser(['admin']);
    return NextResponse.json({ data: await listerRolesBackoffice() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser(['admin']);
    const analyse = analyserRole(await request.json().catch(() => ({})), { creation: true, predefini: false });
    if (analyse.statut === 'refus') throw new ApiError(400, analyse.message);
    const { nom, description, fonction, permissions } = analyse.valeur;

    const homonyme = await prisma.roleBackoffice.findFirst({ where: { nom: { equals: nom!, mode: 'insensitive' } }, select: { id: true } });
    if (homonyme) throw new ApiError(409, `Un rôle « ${nom} » existe déjà`);

    const role = await prisma.roleBackoffice.create({
      data: { nom: nom!, description: description ?? null, fonction: fonction as Role, permissions: permissions ?? [] },
      select: { id: true },
    });

    await journaliserCompte({
      request,
      adminId: session.sub,
      action: 'role_cree',
      cibleId: role.id,
      details: `Fonction de base : ${nomFonction(fonction!)} · ${(permissions ?? []).length} droit(s)`,
    });

    return NextResponse.json(role, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
