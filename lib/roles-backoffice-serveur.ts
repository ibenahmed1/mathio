import type { Role } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { FONCTIONS_EQUIPE } from '@/lib/fonctions-equipe';
import type { RoleBackofficeExpose } from '@/lib/roles-backoffice';

// § Équipe & rôles — accès base des rôles de l'équipe interne.

// Crée les rôles prédéfinis manquants (un par fonction, `cle` = la fonction),
// à partir de ROLE_PERMISSIONS, puis rattache à celui de leur fonction les
// comptes de l'équipe qui n'ont pas encore de rôle.
//
// Idempotent et SANS ÉCRASEMENT : un rôle prédéfini déjà présent garde ce que
// l'admin en a fait. Appelé à chaque lecture (comme les catégories par défaut
// de la comptabilité marchande) : une base neuve ou fraîchement migrée se
// remplit d'elle-même, sans script à lancer en production.
export async function assurerRolesPredefinis(): Promise<void> {
  const existants = await prisma.roleBackoffice.findMany({ where: { cle: { not: null } }, select: { cle: true } });
  const presentes = new Set(existants.map((r) => r.cle));
  for (const f of FONCTIONS_EQUIPE) {
    if (presentes.has(f.role)) continue;
    // Un rôle personnalisé aurait pu prendre le nom avant nous : le prédéfini
    // se distingue alors par un suffixe plutôt que d'échouer sur l'unicité.
    const pris = await prisma.roleBackoffice.findUnique({ where: { nom: f.nom }, select: { id: true } });
    await prisma.roleBackoffice
      .create({
        data: {
          cle: f.role,
          nom: pris ? `${f.nom} (prédéfini)` : f.nom,
          description: f.description,
          fonction: f.role as Role,
          permissions: f.terrain ? [] : (ROLE_PERMISSIONS[f.role as Role] ?? []),
        },
      })
      // Deux premières visites simultanées : la seconde bute sur `cle` unique.
      .catch(() => undefined);
  }

  const predefinis = await prisma.roleBackoffice.findMany({ where: { cle: { not: null } }, select: { id: true, cle: true } });
  for (const r of predefinis) {
    await prisma.utilisateur.updateMany({
      where: { roleBackofficeId: null, role: r.cle as Role },
      data: { roleBackofficeId: r.id },
    });
  }
}

export async function idRolePredefini(fonction: string): Promise<string | null> {
  await assurerRolesPredefinis();
  const r = await prisma.roleBackoffice.findUnique({ where: { cle: fonction }, select: { id: true } });
  return r?.id ?? null;
}

const ORDRE = new Map(FONCTIONS_EQUIPE.map((f, i) => [f.role, i]));

export async function listerRolesBackoffice(): Promise<RoleBackofficeExpose[]> {
  await assurerRolesPredefinis();
  const roles = await prisma.roleBackoffice.findMany({
    select: {
      id: true,
      nom: true,
      description: true,
      fonction: true,
      cle: true,
      permissions: true,
      _count: { select: { utilisateurs: true } },
    },
  });
  // Prédéfinis dans l'ordre des fonctions, puis les personnalisés par nom.
  return roles
    .map((r) => ({
      id: r.id,
      nom: r.nom,
      description: r.description,
      fonction: r.fonction,
      predefini: r.cle !== null,
      permissions: r.permissions,
      nbMembres: r._count.utilisateurs,
    }))
    .sort((a, b) =>
      a.predefini !== b.predefini
        ? a.predefini ? -1 : 1
        : a.predefini
          ? (ORDRE.get(a.fonction) ?? 99) - (ORDRE.get(b.fonction) ?? 99)
          : a.nom.localeCompare(b.nom, 'fr')
    );
}
