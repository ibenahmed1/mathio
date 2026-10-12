import { ApiError } from '@/lib/api-utils';
import type { SessionPayload } from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

// § Gestion des comptes déléguée (`users:manage`). requireUser(['admin'])
// laisse aussi passer un compte back-office qui détient la permission du
// chemin (cf. permissionAutorise, lib/api-utils.ts) : c'est voulu, l'écran
// Équipe & rôles se délègue. Mais sans borne, ce délégué devenait admin en un
// geste — réinitialiser le mot de passe d'un admin, le désactiver, ou
// s'accorder lui-même tout le catalogue. Ces gardes ramènent la délégation à
// ce qu'elle doit être : gérer l'équipe, jamais au-delà de ses propres droits.

// Comptes qu'un délégué non admin peut toucher : l'équipe, ni admin ni
// marchand (un marchand repris par mot de passe donne la main sur son RIB).
const ROLES_GERABLES_PAR_DELEGUE: Role[] = [
  'superviseur',
  'moderateur',
  'equipe_suivi',
  'responsable',
  'ramasseur',
  'livreur',
  'design',
  'gestionnaire_hub',
  'agent_hub',
  'planner',
];

export function estAdminReel(session: SessionPayload): boolean {
  return session.role === 'admin';
}

// Refuse qu'un délégué agisse sur lui-même ou sur un compte hors équipe.
export function exigerCibleGerable(session: SessionPayload, cible: { id: string; role: Role }) {
  if (estAdminReel(session)) return;
  if (cible.id === session.sub) {
    throw new ApiError(403, 'Vous ne pouvez pas modifier votre propre compte depuis cet écran');
  }
  if (!ROLES_GERABLES_PAR_DELEGUE.includes(cible.role)) {
    throw new ApiError(403, 'Seul un admin peut agir sur ce compte');
  }
}

// Refuse qu'un délégué accorde une permission qu'il ne détient pas lui-même.
export function exigerPermissionsDetenues(session: SessionPayload, permissions: string[]) {
  if (estAdminReel(session)) return;
  const detenues = new Set(session.permissions);
  const enTrop = permissions.filter((p) => !detenues.has(p));
  if (enTrop.length > 0) {
    throw new ApiError(403, `Vous ne pouvez pas accorder des permissions que vous n'avez pas : ${enTrop.join(', ')}`);
  }
}
