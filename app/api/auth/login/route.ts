import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  signSession,
  verifySecret,
  getHomeSpace,
  normalizePhoneMaroc,
  spaceForHost,
  spaceOrigin,
  LEGACY_SESSION_COOKIE_NAMES,
  SESSION_COOKIE_NAMES,
  SESSION_MAX_AGE_SECONDS,
  SPACE_HOSTS,
  SPACE_LOGIN_ROLES,
} from '@/lib/auth';
import { jsonError } from '@/lib/api-utils';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';

// Message générique : ne jamais révéler si le compte existe, si le mot de
// passe/PIN est incorrect, ou si le compte est désactivé (RG-12).
const INVALID_CREDENTIALS_MESSAGE = 'Téléphone/email ou identifiant incorrect';

// 5 tentatives/minute/IP : assez pour une faute de frappe légitime, trop peu
// pour un bruteforce d'identifiants.
const LOGIN_RATE_LIMIT = { max: 5, windowMs: 60_000 };

export async function POST(request: Request) {
  try {
    // L'hôte détermine l'espace dans lequel cette connexion ouvre une session.
    // Le proxy a déjà rejeté les hôtes inconnus ; on revérifie pour que la
    // route reste sûre indépendamment de la config de routage.
    const space = spaceForHost(request.headers.get('host'));
    if (!space) {
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }

    const ip = getClientIp(request) ?? 'unknown';
    // Quota par espace ET par IP : un bruteforce sur le portail marchand ne
    // doit pas consommer (ni masquer) le quota du back-office, et inversement.
    const rateLimit = await checkRateLimit(
      `login:${space}:${ip}`,
      LOGIN_RATE_LIMIT.max,
      LOGIN_RATE_LIMIT.windowMs
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit.retryAfterSeconds);
    }

    const body = await request.json();
    // Le champ "telephone" du body accepte historiquement un numéro, mais
    // aussi un email : les membres d'équipe marchand invités par email (voir
    // MarchandMembre) n'ont pas forcément de téléphone et se connectent avec
    // leur email — un seul champ d'identifiant, résolu sur les deux colonnes.
    const identifiant = typeof body.telephone === 'string' ? body.telephone.trim() : '';
    const secret = typeof body.secret === 'string' ? body.secret : '';

    if (!identifiant || !secret) {
      return NextResponse.json({ error: 'Téléphone/email et identifiant requis' }, { status: 400 });
    }

    // L'identifiant peut être saisi avec des espaces ou un préfixe +212/212
    // (ex. copié depuis un contact) : on le normalise vers le même format
    // que celui stocké en base avant de chercher par téléphone. Si ce n'est
    // pas un numéro reconnu, `normalizePhoneMaroc` renvoie null et seule la
    // recherche par email s'applique (comportement identique à avant).
    const telephoneNormalise = normalizePhoneMaroc(identifiant);

    const user = await prisma.utilisateur.findFirst({
      where: { OR: [{ telephone: telephoneNormalise ?? identifiant }, { email: identifiant }] },
    });

    if (!user || !user.actif) {
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }

    // Tous les rôles s'authentifient de la même façon (téléphone + secret
    // comparé au hash) ; "secret" est un mot de passe pour les rôles internes
    // et peut être un PIN pour les rôles terrain, la vérification est identique.
    const valid = await verifySecret(secret, user.motDePasseHash);

    if (!valid) {
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }

    // Le rôle a-t-il le droit d'ouvrir une session PAR MOT DE PASSE sur cet
    // hôte ? (cf. SPACE_LOGIN_ROLES). Deux cas distincts :
    //
    //  - le compte relève du back-office : on renvoie l'échec générique, sans
    //    jamais confirmer depuis un domaine public qu'un domaine ops existe,
    //    ni que ces identifiants y sont valables. Les trois racines n'ayant
    //    aucun parent commun, ce domaine ne se devine pas non plus ;
    //  - le compte relève de l'autre espace public : l'utilisateur est déjà
    //    authentifié avec succès, l'orienter vers le bon domaine ne lui
    //    apprend donc rien qu'il ne sache — et sans ça il resterait bloqué.
    if (!SPACE_LOGIN_ROLES[space].includes(user.role)) {
      const home = getHomeSpace(user.role);
      if (home === 'admin' || space === 'admin') {
        return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
      }
      return NextResponse.json(
        {
          error: `Ce compte s'utilise sur ${SPACE_HOSTS[home]}`,
          redirectTo: `${spaceOrigin(home)}/login`,
        },
        { status: 403 }
      );
    }

    await prisma.utilisateur.update({
      where: { id: user.id },
      data: { derniereConnexion: new Date() },
    });

    const token = await signSession({
      sub: user.id,
      role: user.role,
      space,
      impersonated: false,
    });

    const response = NextResponse.json({
      id: user.id,
      nomComplet: user.nomComplet,
      role: user.role,
    });

    // Un cookie par espace, et chaque espace ayant son propre domaine racine,
    // le cookie est de fait lié à cet hôte (préfixe `__Host-` en production,
    // cf. lib/auth.ts).
    //
    // Le back-office est le seul à justifier `sameSite: 'strict'` : il n'a
    // jamais besoin d'être atteint depuis un lien externe. Le marchand et le
    // terrain restent en 'lax' parce qu'ils SONT atteints ainsi — lien de
    // réinitialisation de mot de passe, invitation, notification — et que
    // 'strict' ferait arriver ces visiteurs déconnectés. Les trois domaines
    // étant cross-site deux à deux, 'lax' suffit déjà à bloquer toute requête
    // d'ÉCRITURE authentifiée venue d'un autre espace ; 'strict' n'ajoute pour
    // le back-office que le refus des navigations entrantes.
    response.cookies.set(SESSION_COOKIE_NAMES[space], token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: space === 'admin' ? 'strict' : 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    // Nettoyage des cookies d'avant la séparation par domaines, pour qu'ils ne
    // traînent pas indéfiniment chez les clients déjà connectés.
    for (const nom of LEGACY_SESSION_COOKIE_NAMES) {
      response.cookies.delete(nom);
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
