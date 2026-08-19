import { NextResponse, type NextRequest } from 'next/server';
import {
  EXTRA_ROLES_HEADER,
  IMPERSONATED_HEADER,
  ROLES_BACKOFFICE,
  ROLES_HUB_UNIQUEMENT,
  ROLES_KANBAN_UNIQUEMENT,
  ROLES_PLANIFICATION,
  SESSION_SPACE_HEADER,
  USER_ID_HEADER,
  USER_ROLE_HEADER,
  assertSpaceHostsConfigured,
  roleMatches,
  spaceForHost,
  spaceOrigin,
  verifySpaceCookie,
  type SessionPayload,
  type SessionSpace,
} from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

// Chemins publics sous /api/** qui ne nécessitent pas de session existante,
// avec l'ensemble des espaces (donc des hôtes) où ils ont un sens. Ce second
// niveau compte autant que le premier : l'inscription marchand, par exemple,
// n'a aucune raison d'être atteignable depuis le domaine du back-office ou
// depuis l'app terrain — la restreindre ici réduit d'autant la surface
// publique de chaque hôte.
const PUBLIC_API_PATHS: Record<string, SessionSpace[]> = {
  '/api/auth/login': ['admin', 'planner', 'marchand', 'terrain'],
  '/api/auth/mot-de-passe-oublie': ['admin', 'planner', 'marchand', 'terrain'],
  '/api/auth/reinitialiser-mot-de-passe': ['admin', 'planner', 'marchand', 'terrain'],
  '/api/marchands/inscription': ['marchand'],
  // Échange d'un jeton de transfert contre une session : par construction
  // appelé sans session sur l'hôte cible (cf. lib/auth.ts, § Transfert de
  // session entre domaines).
  '/api/session-handoff/consume': ['marchand', 'planner'],
};

interface PageGuard {
  prefix: string;
  space: SessionSpace;
  allowedRoles: Role[];
}

// Une section de pages = un espace applicatif = un hôte = un cookie = un
// ensemble de rôles autorisés. Le proxy ne fait jamais confiance au layout
// React pour bloquer l'accès : il vérifie systématiquement l'hôte, la validité
// du token ET le rôle relu en base avant de laisser passer le rendu.
//
// `space` n'est plus seulement le cookie à lire : c'est aussi le SEUL hôte sur
// lequel ces pages existent. Une requête `/marchand/colis` arrivant sur le
// domaine du back-office reçoit un 404, avant toute lecture de cookie.
const PAGE_GUARDS: PageGuard[] = [
  // ROLES_KANBAN_UNIQUEMENT (design, gestionnaire_hub) et
  // ROLES_HUB_UNIQUEMENT (agent_hub) partagent l'espace admin pour atteindre
  // respectivement /admin/tasks et /admin/scan/reception, mais ne doivent voir
  // AUCUNE autre page /admin/** — le confinement à leur sous-chemin respectif
  // est appliqué juste après la vérification de session ci-dessous, pas ici.
  {
    prefix: '/admin',
    space: 'admin',
    allowedRoles: [...ROLES_BACKOFFICE, ...ROLES_KANBAN_UNIQUEMENT, ...ROLES_HUB_UNIQUEMENT],
  },
  // § Web app Planner : espace à part entière depuis la séparation par
  // domaines (son propre sous-domaine, son propre cookie, son propre claim
  // `aud`). Le rôle `planner` n'existe plus du tout dans l'espace admin, ce
  // qui rend inutile l'ancienne redirection de confinement.
  { prefix: '/planner', space: 'planner', allowedRoles: ROLES_PLANIFICATION },
  { prefix: '/marchand', space: 'marchand', allowedRoles: ['marchand'] },
  { prefix: '/ramasseur', space: 'terrain', allowedRoles: ['ramasseur'] },
  { prefix: '/livreur', space: 'terrain', allowedRoles: ['livreur'] },
];

const PREFIXE_KANBAN = '/admin/tasks';
const PREFIXE_SCAN_RECEPTION_HUB = '/admin/scan/reception';
// § Bon d'Envoi (/admin/bon-envoi) : accessible à l'Agent Hub pour consulter
// et réceptionner les BE de son propre hub, MAIS pas /admin/bon-envoi/creer
// (création réservée admin, cf. PREFIXE_BON_ENVOI_CREER ci-dessous).
const PREFIXE_BON_ENVOI = '/admin/bon-envoi';
const PREFIXE_BON_ENVOI_CREER = '/admin/bon-envoi/creer';

// Méthodes sans effet de bord : exemptées du contrôle d'origine ci-dessous,
// comme le veut la définition CSRF (une lecture ne modifie rien).
const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);

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

function withUserHeaders(request: NextRequest, session: SessionPayload) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(USER_ID_HEADER, session.sub);
  requestHeaders.set(USER_ROLE_HEADER, session.role);
  requestHeaders.set(EXTRA_ROLES_HEADER, session.extraRoles.join(','));
  requestHeaders.set(SESSION_SPACE_HEADER, session.space);
  requestHeaders.set(IMPERSONATED_HEADER, session.impersonated ? '1' : '0');
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  assertSpaceHostsConfigured();

  const { pathname } = request.nextUrl;

  // --- 1. L'hôte détermine l'espace ----------------------------------------
  // Première décision de toute requête, avant même de regarder les cookies :
  // un hôte inconnu (accès direct par IP, ancien domaine encore pointé,
  // sondage automatisé sur un vhost non prévu) n'obtient rien du tout.
  const space = spaceForHost(request.headers.get('host'));
  if (!space) {
    return new NextResponse(null, { status: 404 });
  }

  // --- 2. Contrôle d'origine (CSRF) ----------------------------------------
  // Les quatre espaces ne partagent plus d'origine, mais les trois
  // sous-domaines du domaine métier restent *same-site* entre eux : un
  // `sameSite: 'lax'`/'strict'` n'empêche donc pas une page marchand compromise
  // d'émettre une requête authentifiée vers l'app terrain. Ce contrôle ferme
  // ce résidu pour les 95 routes d'un coup — d'autant plus nécessaire que les
  // handlers font `await request.json()` sans exiger un Content-Type JSON,
  // donc une requête "simple" (sans préflight CORS) passerait autrement.
  if (!METHODES_SURES.has(request.method)) {
    const origin = request.headers.get('origin');
    if (origin !== spaceOrigin(space)) {
      return NextResponse.json({ error: 'Origine non autorisée' }, { status: 403 });
    }
  }

  // --- 3. Pages gardées ----------------------------------------------------
  const guard = matchGuard(pathname);
  if (guard) {
    // Cloisonnement par hôte : les pages d'un espace n'existent que sur son
    // domaine. 404 (et non 403) pour ne rien révéler de l'arborescence des
    // autres espaces à qui sonde le mauvais domaine.
    if (guard.space !== space) {
      return new NextResponse(null, { status: 404 });
    }

    const session = await verifySpaceCookie(request.cookies, space);
    if (!session || !roleMatches(session, guard.allowedRoles)) {
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
    // hors création) : même mécanique que le confinement Kanban ci-dessus,
    // mais vers les seuls modules autorisés (scan de réception au quai +
    // consultation/réception des BE de son hub).
    if (
      ROLES_HUB_UNIQUEMENT.includes(session.role) &&
      !roleMatches(session, ROLES_BACKOFFICE) &&
      !estAccessibleAgentHub(pathname)
    ) {
      return NextResponse.redirect(new URL(PREFIXE_SCAN_RECEPTION_HUB, request.url));
    }

    return withUserHeaders(request, session);
  }

  // --- 4. API --------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    const espacesPublics = PUBLIC_API_PATHS[pathname];
    if (espacesPublics) {
      return espacesPublics.includes(space)
        ? NextResponse.next()
        : new NextResponse(null, { status: 404 });
    }

    // Une seule session possible ici : celle de l'hôte servi. L'ancien
    // `resolveApiSession` essayait les espaces l'un après l'autre parce que
    // plusieurs cookies coexistaient sur la même origine — ce n'est plus le
    // cas. L'autorisation fine par rôle reste faite par `requireUser()` dans
    // chaque route handler.
    const session = await verifySpaceCookie(request.cookies, space);
    if (!session) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
    }

    return withUserHeaders(request, session);
  }

  // --- 5. Reste (pages publiques : /login, /inscription, vues d'impression
  // partagées type /bons-livraison/[id]…) : l'hôte et l'origine ont été
  // validés ci-dessus, la session est revérifiée par le Server Component.
  return NextResponse.next();
}

// Étendu à toutes les requêtes hors assets statiques : le contrôle d'hôte
// (§1) et le contrôle d'origine (§2) doivent s'appliquer AUSSI aux pages non
// gardées — notamment aux Server Actions, qui postent sur l'URL de la page et
// ne passaient pas par l'ancien matcher.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|woff|woff2|ttf)$).*)',
  ],
};
