import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  signSession,
  verifySecret,
  getSessionCookieName,
  getSessionSpace,
  normalizePhoneMaroc,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
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
    const ip = getClientIp(request) ?? 'unknown';
    const rateLimit = await checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT.max, LOGIN_RATE_LIMIT.windowMs);
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

    await prisma.utilisateur.update({
      where: { id: user.id },
      data: { derniereConnexion: new Date() },
    });

    const token = await signSession({ sub: user.id, role: user.role });

    const response = NextResponse.json({
      id: user.id,
      nomComplet: user.nomComplet,
      role: user.role,
    });

    // Un cookie distinct par espace applicatif (admin/marchand/terrain) :
    // deux sessions de rôles différents peuvent coexister dans le même
    // navigateur (ex. deux onglets) sans que l'une n'écrase l'autre.
    // L'espace back-office (admin/superviseur/moderateur/equipe_suivi/responsable) est le seul
    // à justifier `sameSite: 'strict'` : il n'a jamais besoin d'être atteint
    // depuis un lien externe (email/SMS), contrairement au marchand ou au
    // terrain, donc on retire toute exposition CSRF résiduelle pour lui.
    const space = getSessionSpace(user.role);
    response.cookies.set(getSessionCookieName(user.role), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: space === 'admin' ? 'strict' : 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    // Nettoyage de l'ancien cookie unique (avant l'isolation par espace) pour
    // qu'il ne traîne pas indéfiniment chez les clients déjà connectés.
    response.cookies.delete(LEGACY_SESSION_COOKIE_NAME);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
