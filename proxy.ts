import { NextResponse, type NextRequest } from 'next/server';
import {
  EXTRA_ROLES_HEADER,
  ROLES_BACKOFFICE,
  ROLES_HUB_UNIQUEMENT,
  ROLES_KANBAN_UNIQUEMENT,
  SESSION_COOKIE_NAMES,
  SPACE_HINT_HEADER,
  USER_ID_HEADER,
  USER_ROLE_HEADER,
  getSessionAuthState,
  resolveApiSession,
  roleMatches,
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
  // ROLES_KANBAN_UNIQUEMENT (design, gestionnaire_hub) et
  // ROLES_HUB_UNIQUEMENT (agent_hub) partagent le cookie admin pour atteindre
  // respectivement /admin/tasks et /admin/scan/reception, mais ne doivent voir
  // AUCUNE autre page /admin/** — le confinement à leur sous-chemin respectif
  // est appliqué juste après la vérification de session ci-dessous, pas ici.
  {
    prefix: '/admin',
    cookieSpace: 'admin',
    allowedRoles: [...ROLES_BACKOFFICE, ...ROLES_KANBAN_UNIQUEMENT, ...ROLES_HUB_UNIQUEMENT],
  },
  { prefix: '/marchand', cookieSpace: 'marchand', allowedRoles: ['marchand'] },
  { prefix: '/ramasseur', cookieSpace: 'terrain', allowedRoles: ['ramasseur'] },
  { prefix: '/livreur', cookieSpace: 'terrain', allowedRoles: ['livreur'] },
];

const PREFIXE_KANBAN = '/admin/tasks';
const PREFIXE_SCAN_RECEPTION_HUB = '/admin/scan/reception';
// § Bon d'Envoi (/admin/bon-envoi) : accessible à l'Agent Hub pour consulter
// et réceptionner les BE de son propre hub, MAIS pas /admin/bon-envoi/creer
// (création réservée admin, cf. PREFIXE_BON_ENVOI_CREER ci-dessous).
const PREFIXE_BON_ENVOI = '/admin/bon-envoi';
const PREFIXE_BON_ENVOI_CREER = '/admin/bon-envoi/creer';

function matchGuard(pathname: string): PageGuard | undefined {
  return PAGE_GUARDS.find((g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`));
}

// Chemins accessibles au rôle agent_hub (ROLES_HUB_UNIQUEMENT) : le scan de
// réception au quai, et la consultation/réception des Bons d'Envoi de son
// hub — jamais leur création (cf. PREFIXE_BON_ENVOI_CREER).
function estAccessibleAgentHub(pathname: string): boolean {
  if (pathname === PREFIXE_SCAN_RECEPTION_HUB || pathname.startsWith(`${PREFIXE_SCAN_RECEPTION_HUB}/`)) {
    return true;
  }
  if (pathname === PREFIXE_BON_ENVOI_CREER || pathname.startsWith(`${PREFIXE_BON_ENVOI_CREER}/`)) {
    return false;
  }
  return pathname === PREFIXE_BON_ENVOI || pathname.startsWith(`${PREFIXE_BON_ENVOI}/`);
}

async function verifyGuardCookie(request: NextRequest, guard: PageGuard): Promise<SessionPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAMES[guard.cookieSpace])?.value;
  if (!token) return null;
  const decoded = await verifySessionToken(token);
  if (!decoded) return null;
  // Revérifie le rôle, `actif` et les rôles supplémentaires en base ici aussi
  // (pas seulement dans getPageSession côté layout) : ce fichier tourne sur
  // le runtime Node.js (convention "proxy.ts" de Next.js 16, plus limité à
  // l'Edge), donc l'accès direct à Prisma est possible et cohérent avec la
  // philosophie de ce middleware — ne jamais laisser passer une page sur la
  // seule confiance du layout. Le rôle utilisé est celui relu en base (pas
  // celui figé dans le JWT à la connexion) pour qu'un changement de rôle par
  // un admin s'applique dès la requête suivante, sans attendre l'expiration
  // du cookie (24h) ni une reconnexion.
  const state = await getSessionAuthState(decoded.sub);
  if (!state || !state.actif) return null;
  const session: SessionPayload = { sub: decoded.sub, role: state.role, extraRoles: state.extraRoles };
  if (!roleMatches(session, guard.allowedRoles)) return null;
  return session;
}

function withUserHeaders(request: NextRequest, session: SessionPayload) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(USER_ID_HEADER, session.sub);
  requestHeaders.set(USER_ROLE_HEADER, session.role);
  requestHeaders.set(EXTRA_ROLES_HEADER, session.extraRoles.join(','));
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
    // Confinement des rôles Kanban-only : même avec une session admin valide,
    // toute page /admin/** hors /admin/tasks leur reste fermée — sauf si un
    // rôle supplémentaire back-office leur a été accordé (roleMatches),
    // auquel cas ils ne sont plus "Kanban-only" au sens de ce confinement.
    if (
      ROLES_KANBAN_UNIQUEMENT.includes(session.role) &&
      !roleMatches(session, ROLES_BACKOFFICE) &&
      pathname !== PREFIXE_KANBAN &&
      !pathname.startsWith(`${PREFIXE_KANBAN}/`)
    ) {
      return NextResponse.redirect(new URL(PREFIXE_KANBAN, request.url));
    }
    // Confinement de l'Agent Hub (§ /admin/scan/reception, /admin/bon-envoi
    // hors création) : même mécanique que les confinements Kanban/Agent
    // Préparation ci-dessus, mais vers les seuls modules autorisés (scan de
    // réception au quai + consultation/réception des BE de son hub).
    if (
      ROLES_HUB_UNIQUEMENT.includes(session.role) &&
      !roleMatches(session, ROLES_BACKOFFICE) &&
      !estAccessibleAgentHub(pathname)
    ) {
      return NextResponse.redirect(new URL(PREFIXE_SCAN_RECEPTION_HUB, request.url));
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
  matcher: ['/api/:path*', '/admin/:path*', '/marchand/:path*', '/ramasseur/:path*', '/livreur/:path*'],
};
