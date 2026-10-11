import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/rate-limit';

// § Équipe & rôles (/admin/equipe, onglet Journal) — qui a fait quoi sur les
// comptes de l'équipe. Pendant back-office du journal de l'équipe marchande
// (JournalEquipeMarchand), mais porté par la table AuditLog déjà en place :
// une ligne par geste, cibleType « utilisateur ».
//
// journaliserCompte() NE LÈVE JAMAIS, comme notifier() : une trace est une
// conséquence du geste, pas sa condition. Un journal injoignable ne doit pas
// empêcher de désactiver un compte compromis.

export const ACTIONS_JOURNAL_EQUIPE = [
  'compte_cree',
  'compte_modifie',
  'fonction_changee',
  'compte_active',
  'compte_desactive',
  'mot_de_passe_reinitialise',
  'compte_supprime',
  'role_cree',
  'role_modifie',
  'role_supprime',
] as const;
export type ActionJournalEquipe = (typeof ACTIONS_JOURNAL_EQUIPE)[number];

// Deux sortes de cibles : un compte de l'équipe, ou un rôle (RoleBackoffice).
const CIBLE_COMPTE = 'utilisateur';
const CIBLE_ROLE = 'role_backoffice';

export async function journaliserCompte(options: {
  request: Request;
  adminId: string;
  action: ActionJournalEquipe;
  cibleId: string;
  details?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: options.adminId,
        action: options.action,
        cibleType: options.action.startsWith('role_') ? CIBLE_ROLE : CIBLE_COMPTE,
        cibleId: options.cibleId,
        details: options.details ?? null,
        adresseIp: getClientIp(options.request),
      },
    });
  } catch (erreur) {
    console.error('[journal équipe] échec de journaliserCompte()', options.action, erreur);
  }
}

export interface LigneJournalEquipe {
  id: string;
  action: string;
  auteur: string;
  cible: string | null;
  details: string | null;
  horodatage: string;
}

const PAGE = 30;

// Page du journal, la plus récente d'abord. `avant` = horodatage ISO de la
// dernière ligne déjà affichée ; `suivant` vaut null quand tout est lu.
export async function lireJournalEquipe(avant?: string | null): Promise<{ data: LigneJournalEquipe[]; suivant: string | null }> {
  const lignes = await prisma.auditLog.findMany({
    where: {
      cibleType: { in: [CIBLE_COMPTE, CIBLE_ROLE] },
      action: { in: [...ACTIONS_JOURNAL_EQUIPE] },
      ...(avant && !Number.isNaN(Date.parse(avant)) && { horodatage: { lt: new Date(avant) } }),
    },
    orderBy: { horodatage: 'desc' },
    take: PAGE + 1,
    select: { id: true, action: true, cibleId: true, details: true, horodatage: true, admin: { select: { nomComplet: true } } },
  });
  const page = lignes.slice(0, PAGE);
  const ids = [...new Set(page.map((l) => l.cibleId).filter((id): id is string => !!id))];
  const [comptes, roles] = await Promise.all([
    prisma.utilisateur.findMany({ where: { id: { in: ids } }, select: { id: true, nomComplet: true } }),
    prisma.roleBackoffice.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true } }),
  ]);
  const nomParId = new Map([...comptes.map((c) => [c.id, c.nomComplet] as const), ...roles.map((r) => [r.id, r.nom] as const)]);
  return {
    data: page.map((l) => ({
      id: l.id,
      action: l.action,
      auteur: l.admin.nomComplet,
      // Un compte ou un rôle supprimé n'a plus de nom en base : il est dans `details`.
      cible: (l.cibleId && nomParId.get(l.cibleId)) ?? null,
      details: l.details,
      horodatage: l.horodatage.toISOString(),
    })),
    suivant: lignes.length > PAGE ? page[page.length - 1].horodatage.toISOString() : null,
  };
}
