import { NextResponse, type NextRequest } from 'next/server';
import {
  EXTRA_ROLES_HEADER,
  IMPERSONATED_HEADER,
  ROLES_BACKOFFICE,
  ROLES_HUB_UNIQUEMENT,
  ROLES_KANBAN_UNIQUEMENT,
  PERMISSIONS_HEADER,
  ROUTE_PERMISSION_HEADER,
  SESSION_SPACE_HEADER,
  USER_ID_HEADER,
  USER_ROLE_HEADER,
  assertSpaceHostsConfigured,
  roleMatches,
  originForHost,
  spaceForHost,
  verifySpaceCookie,
  type SessionPayload,
  type SessionSpace,
} from '@/lib/auth';
import { apiPermissionFor, pagePermissionFor } from '@/lib/permission-routes';
import type { Role } from '@/app/generated/prisma/enums';

// Chemins publics sous /api/** qui ne nécessitent pas de session existante,
// avec l'ensemble des espaces (donc des hôtes) où ils ont un sens. Ce second
// niveau compte autant que le premier : l'inscription marchand, par exemple,
// n'a aucune raison d'être atteignable depuis le domaine du back-office ou
// depuis l'app terrain — la restreindre ici réduit d'autant la surface
// publique de chaque hôte.
const PUBLIC_API_PATHS: Record<string, SessionSpace[]> = {
  '/api/auth/login': ['admin', 'marchand', 'terrain'],
  '/api/auth/mot-de-passe-oublie': ['admin', 'marchand', 'terrain'],
  '/api/auth/reinitialiser-mot-de-passe': ['admin', 'marchand', 'terrain'],
  '/api/marchands/inscription': ['marchand'],
  // Échange d'un jeton de transfert contre une session : par construction
  // appelé sans session sur l'hôte cible (cf. lib/auth.ts, § Transfert de
  // session entre domaines). Seule l'impersonation d'un marchand par un admin
  // en émet encore.
  '/api/session-handoff/consume': ['marchand'],
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
  //
  // `planner` n'est PAS de ceux-là : il fait partie de ROLES_BACKOFFICE depuis
  // le passage à trois domaines et circule dans tout /admin/**, sans
  // confinement de chemin. Ce qu'il peut y faire est borné route par route
  // (`requireUser([...])`) et par son hub de rattachement, pas par le proxy.
  {
    prefix: '/admin',
    space: 'admin',
    allowedRoles: [...ROLES_BACKOFFICE, ...ROLES_KANBAN_UNIQUEMENT, ...ROLES_HUB_UNIQUEMENT],
  },
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

function withUserHeaders(request: NextRequest, session: SessionPayload, routePermission?: string | null) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(USER_ID_HEADER, session.sub);
  requestHeaders.set(USER_ROLE_HEADER, session.role);
  requestHeaders.set(EXTRA_ROLES_HEADER, session.extraRoles.join(','));
  requestHeaders.set(PERMISSIONS_HEADER, session.permissions.join(','));
  // Toujours écrit (chaîne vide quand le chemin n'est gouverné par aucune
  // permission), jamais laissé au hasard : un header homonyme envoyé par le
  // client serait sinon lu tel quel par requireUser et vaudrait octroi.
  requestHeaders.set(ROUTE_PERMISSION_HEADER, routePermission ?? '');
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
  const hote = request.headers.get('host');
  const space = spaceForHost(hote);
  if (!space) {
    return new NextResponse(null, { status: 404 });
  }

  // Origine de l'hôte servi, et non celle de l'hôte canonique de l'espace :
  // en développement plusieurs hôtes mènent au même espace (le `.localhost`
  // et, le cas échéant, un tunnel), et une redirection doit laisser le
  // visiteur sur celui qu'il a réellement ouvert. En production, où chaque
  // espace n'a qu'un hôte, les deux coïncident.
  const origine = originForHost(hote as string);

  // --- 2. Contrôle d'origine (CSRF) ----------------------------------------
  // Les trois espaces vivent sur trois domaines RACINES distincts : toute
  // paire est *cross-site*, et `sameSite` bloque déjà à lui seul l'envoi du
  // cookie sur une requête d'écriture venue d'un autre espace. Ce contrôle
  // reste, en barrière INDÉPENDANTE, pour trois raisons concrètes :
  //
  //   - en développement les trois hôtes sont frères sous `.localhost` (cf.
  //     SPACE_HOSTS_DEV) : c'est ici la SEULE barrière, et c'est aussi ce que
  //     les scripts d'audit exercent ;
  //   - il ne dépend d'aucune valeur par défaut du navigateur, alors que
  //     `sameSite` en dépend entièrement ;
  //   - les handlers font `await request.json()` sans exiger un Content-Type
  //     JSON : une requête "simple", sans préflight CORS, atteindrait sinon
  //     les 95 routes.
  if (!METHODES_SURES.has(request.method)) {
    const origin = request.headers.get('origin');
    if (origin !== origine) {
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
      // `origine` et NON `request.url` comme base : dans Next.js, `request.url`
      // porte l'adresse interne du serveur (localhost:PORT), pas le `Host` de la
      // requête. Bâtir la redirection dessus renverrait l'utilisateur sur un
      // hôte qui n'appartient à aucun espace — donc un 404 — au lieu du /login
      // de son propre domaine.
      return NextResponse.redirect(new URL('/login', origine));
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
      return NextResponse.redirect(new URL(PREFIXE_KANBAN, origine));
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
      return NextResponse.redirect(new URL(PREFIXE_SCAN_RECEPTION_HUB, origine));
    }

    // --- 3 bis. Permissions de module --------------------------------------
    // Troisième couche, après l'hôte (§1) et le rôle (ci-dessus) : ce compte
    // a-t-il la permission qui gouverne cet écran (§ lib/permission-routes.ts) ?
    //
    // Ne s'applique qu'à l'espace back-office : les espaces marchand et
    // terrain ne sont pas gouvernés par le catalogue (cf. lib/permissions.ts),
    // et pagePermissionFor n'y renvoie de toute façon rien.
    //
    // Un chemin sans permission mappée n'est pas « ouvert » : il reste protégé
    // par les couches 1 et 2 comme avant l'introduction des permissions.
    const permissionPage = guard.space === 'admin' ? pagePermissionFor(pathname) : null;
    if (permissionPage && !session.permissions.includes(permissionPage)) {
      // Repli sur l'accueil du back-office plutôt que sur /login : la session
      // est valide, c'est le module qui est fermé. Le 403 ne sert que si
      // l'accueil lui-même lui est fermé — sans quoi la redirection bouclerait.
      if (pathname !== '/admin' && session.permissions.includes('dashboard:view')) {
        return NextResponse.redirect(new URL('/admin', origine));
      }
      return new NextResponse('Accès refusé : permission manquante', { status: 403 });
    }

    return withUserHeaders(request, session, permissionPage);
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

    // Pendant API du §3 bis. Scopé à l'espace back-office : les mêmes routes
    // appelées depuis le domaine marchand ou terrain (une bonne part est
    // partagée) gardent exactement le contrôle qu'elles avaient — celui de
    // leur `requireUser([...])`.
    //
    // La permission résolue est transmise au handler (ROUTE_PERMISSION_HEADER)
    // pour qu'il puisse honorer un octroi par permission là où sa liste de
    // rôles ne suffirait pas (cf. requireUser, lib/api-utils.ts).
    const permissionApi = space === 'admin' ? apiPermissionFor(pathname, request.method) : null;
    if (permissionApi && !session.permissions.includes(permissionApi)) {
      return NextResponse.json({ error: 'Accès refusé : permission manquante' }, { status: 403 });
    }

    return withUserHeaders(request, session, permissionApi);
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
