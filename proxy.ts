import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAMES,
  SPACE_HINT_HEADER,
  USER_ID_HEADER,
  USER_ROLE_HEADER,
  resolveApiSession,
  verifySessionToken,
  type SessionPayload,
  type SessionSpace,
} from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

// Chemins publics sous /api/** qui ne nécessitent pas de session existante.
const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/marchands/inscription',
  '/api/auth/mot-de-passe-oublie',
  '/api/auth/reinitialiser-mot-de-passe',
];

interface PageGuard {
  prefix: string;
  cookieSpace: SessionSpace;
  allowedRoles: Role[];
}

// Une section de pages = un espace applicatif = un cookie = un ensemble de
// rôles autorisés. Le proxy ne fait jamais confiance au layout React pour
// bloquer l'accès : il vérifie systématiquement la validité du token ET le
// rôle qu'il contient avant de laisser passer le rendu de la page.
const PAGE_GUARDS: PageGuard[] = [
  { prefix: '/admin', cookieSpace: 'admin', allowedRoles: ['admin'] },
  { prefix: '/marchand', cookieSpace: 'marchand', allowedRoles: ['marchand'] },
  { prefix: '/ramasseur', cookieSpace: 'terrain', allowedRoles: ['ramasseur'] },
];

function matchGuard(pathname: string): PageGuard | undefined {
  return PAGE_GUARDS.find((g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`));
}

async function verifyGuardCookie(request: NextRequest, guard: PageGuard): Promise<SessionPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAMES[guard.cookieSpace])?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || !guard.allowedRoles.includes(session.role)) return null;
  return session;
}

function withUserHeaders(request: NextRequest, session: SessionPayload) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(USER_ID_HEADER, session.sub);
  requestHeaders.set(USER_ROLE_HEADER, session.role);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /login rend toujours le formulaire, même si une session (potentiellement
  // ancienne — les cookies durent SESSION_MAX_AGE_SECONDS, 7 jours) est encore
  // valide dans un autre espace ou le même : sans ça, quiconque rouvre /login
  // pour se connecter avec un autre compte se retrouve bloqué, renvoyé de
  // force vers l'espace de la session existante sans jamais voir le
  // formulaire. Se connecter avec succès remplace naturellement le cookie de
  // l'espace concerné (voir /api/auth/login) ; un utilisateur qui veut juste
  // retrouver son espace déjà ouvert peut y naviguer directement.
  const guard = matchGuard(pathname);
  if (guard) {
    const session = await verifyGuardCookie(request, guard);
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return withUserHeaders(request, session);
  }

  if (pathname.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.some((path) => pathname === path)) {
      return NextResponse.next();
    }

    const rawHint = request.headers.get(SPACE_HINT_HEADER);
    const hint: SessionSpace | null =
      rawHint === 'admin' || rawHint === 'marchand' || rawHint === 'terrain' ? rawHint : null;

    const session = await resolveApiSession(request.cookies, hint);
    if (!session) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
    }

    return withUserHeaders(request, session);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/admin/:path*', '/marchand/:path*', '/ramasseur/:path*'],
};
