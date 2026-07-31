import { NextResponse } from 'next/server';
import type { Role } from '@/app/generated/prisma/enums';
import { getSessionUser, type SessionPayload } from '@/lib/auth';

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

// Middleware garantit déjà la présence d'une session pour /api/**, mais on
// revérifie ici pour que chaque handler reste sûr indépendamment de la config
// de routage du middleware.
export async function requireUser(allowedRoles?: Role[]): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError(401, 'Authentification requise');
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new ApiError(403, 'Accès refusé pour ce rôle');
  }
  return user;
}
