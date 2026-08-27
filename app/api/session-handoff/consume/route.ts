import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  SESSION_COOKIE_NAMES,
  SESSION_MAX_AGE_SECONDS,
  hashHandoffToken,
  signSession,
  spaceAllowsRole,
  originForHost,
  spaceForHost,
  type SessionSpace,
} from '@/lib/auth';

// Échange un jeton de transfert émis par le back-office contre une vraie
// session sur l'hôte courant (cf. lib/auth.ts, § Transfert de session entre
// domaines). Appelé sans session existante — d'où sa présence dans
// PUBLIC_API_PATHS (proxy.ts), restreinte au seul espace cible.
//
// Page d'atterrissage par espace : le jeton ne sert qu'à ouvrir la session,
// la navigation reprend ensuite normalement. Un seul espace cible depuis le
// passage à trois domaines — l'impersonation d'un marchand ; la table reste
// indexée par espace pour que rouvrir un second transfert n'y coûte qu'une
// ligne.
const ATTERRISSAGE: Partial<Record<SessionSpace, string>> = {
  marchand: '/marchand',
};

export async function GET(request: NextRequest) {
  const hote = request.headers.get('host');
  const space = spaceForHost(hote);
  if (!space || !ATTERRISSAGE[space]) {
    return new NextResponse(null, { status: 404 });
  }

  // Base des redirections : l'hôte appelé, pas `request.url`. Dans Next.js,
  // `request.url` porte l'adresse interne du serveur (localhost:PORT) et non le
  // `Host` appelé — une redirection bâtie dessus quitterait l'hôte cible, et le
  // cookie qu'on vient d'y poser ne serait jamais renvoyé.
  const origine = originForHost(hote as string);
  const echec = NextResponse.redirect(new URL('/login?transfert=expire', origine));

  const token = request.nextUrl.searchParams.get('t');
  if (!token) return echec;

  // Consommation ATOMIQUE : c'est l'`updateMany` conditionnel qui fait
  // l'usage unique, pas un `findUnique` suivi d'un `update` — deux requêtes
  // concurrentes portant le même jeton (rechargement, préchargement de lien)
  // ne peuvent pas ouvrir deux sessions, une seule verra `count === 1`.
  const maintenant = new Date();
  const tokenHash = hashHandoffToken(token);
  const consommation = await prisma.sessionHandoff.updateMany({
    where: { tokenHash, consommeLe: null, expireLe: { gt: maintenant } },
    data: { consommeLe: maintenant },
  });
  if (consommation.count !== 1) return echec;

  const handoff = await prisma.sessionHandoff.findUnique({
    where: { tokenHash },
    include: { utilisateur: { select: { id: true, role: true, actif: true } } },
  });
  if (!handoff) return echec;

  // Le jeton dit pour quel espace il a été émis : un jeton "marchand" présenté
  // sur un autre hôte est refusé, même valide et non consommé.
  if (handoff.espace !== space) return echec;

  // État du compte relu MAINTENANT, pas à l'émission : un compte désactivé
  // entre-temps ne doit pas pouvoir être ouvert par un jeton déjà en vol.
  const utilisateur = handoff.utilisateur;
  if (!utilisateur.actif || !spaceAllowsRole(space, utilisateur.role)) return echec;

  const jwt = await signSession({
    sub: utilisateur.id,
    role: utilisateur.role,
    space,
    impersonated: handoff.impersonation,
  });

  const response = NextResponse.redirect(new URL(ATTERRISSAGE[space]!, origine));
  response.cookies.set(SESSION_COOKIE_NAMES[space], jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
