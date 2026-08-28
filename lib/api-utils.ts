import { NextResponse } from 'next/server';
import type { Role } from '@/app/generated/prisma/enums';
import {
  ROLES_BACKOFFICE,
  getRoutePermission,
  getSessionUser,
  roleMatches,
  sessionHasPermission,
  type SessionPayload,
} from '@/lib/auth';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
}

// Déduplique et ne garde que les chaînes non vides d'un champ `unknown` de
// body JSON (ex. `colisIds` d'une sélection multiple) — un seul endroit pour
// ce filtrage plutôt que de le dupliquer (et de retomber sur des soucis
// d'inférence `any`/`unknown`) dans chaque route qui reçoit ce genre de payload.
export function parseStringIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0)));
}

// Middleware garantit déjà la présence d'une session pour /api/**, mais on
// revérifie ici pour que chaque handler reste sûr indépendamment de la config
// de routage du middleware.
//
// --- Rôles ET permissions ---------------------------------------------------
//
// Les listes de rôles passées ici datent d'avant le catalogue de permissions
// (§ lib/permissions.ts). Elles restent la règle : un rôle autorisé passe,
// comme avant. Un compte qui n'a PAS le rôle passe malgré tout s'il détient la
// permission qui gouverne ce chemin (résolue par le proxy, cf.
// ROUTE_PERMISSION_HEADER) — sans quoi cocher une case dans l'écran de gestion
// des utilisateurs ouvrirait l'écran mais pas les données qu'il affiche, et la
// permission ne voudrait rien dire.
//
// DEUX GARDE-FOUS bornent cet octroi, et il faut les deux :
//
//   1. La permission doit être celle du chemin COURANT, posée par le proxy —
//      pas une permission quelconque du compte. Le header est réécrit à chaque
//      requête (`Headers.set`, cf. withUserHeaders), une valeur homonyme
//      envoyée par le client est donc systématiquement remplacée.
//   2. La liste de rôles doit contenir au moins UN rôle back-office. Une route
//      réservée au marchand (`['marchand']`) ou au terrain (`['livreur']`)
//      n'est JAMAIS ouverte par une permission : son handler suppose une
//      session marchand/livreur (périmètre boutique, tournée du jour…) et
//      s'effondrerait sur une session de back-office. C'est aussi ce qui
//      garantit qu'une permission ne fait pas franchir une frontière d'espace.
// Exportée pour être testée seule : c'est la règle qui décide si une case
// cochée vaut réellement un accès, et elle n'a pas d'autre point d'observation.
export function permissionAutorise(
  user: Pick<SessionPayload, 'permissions'>,
  allowedRoles: Role[],
  routePermission: string | null
): boolean {
  if (!routePermission) return false;
  if (!allowedRoles.some((r) => ROLES_BACKOFFICE.includes(r))) return false;
  return user.permissions.includes(routePermission);
}

export async function requireUser(allowedRoles?: Role[]): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError(401, 'Authentification requise');
  }
  if (allowedRoles && !roleMatches(user, allowedRoles)) {
    const routePermission = await getRoutePermission();
    if (!permissionAutorise(user, allowedRoles, routePermission)) {
      throw new ApiError(403, 'Accès refusé pour ce rôle');
    }
  }
  return user;
}

// Exige une permission nommée, indépendamment du rôle. À utiliser dans un
// handler dont l'accès se décrit mieux par une permission que par une liste de
// rôles ; le contrôle du proxy reste la première ligne, celui-ci la double
// pour les appels qui ne passeraient pas par lui (Server Actions).
export async function requirePermission(permission: string): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError(401, 'Authentification requise');
  }
  if (!sessionHasPermission(user, permission)) {
    throw new ApiError(403, 'Accès refusé : permission manquante');
  }
  return user;
}
