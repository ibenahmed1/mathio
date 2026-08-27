import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError } from '@/lib/api-utils';
import { generateResetToken, originForHost, spaceForHost } from '@/lib/auth';
import { sendPasswordResetEmail } from '@/lib/mailer';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit';

// Message générique dans tous les cas (RG-12) : ne jamais révéler si l'email
// existe en base, sans quoi cet endpoint deviendrait un oracle d'énumération
// de comptes.
const GENERIC_MESSAGE = "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé.";

// 5 tentatives/minute/IP : évite le spam d'emails de reset (saturation de
// lib/mailer.ts) autant que le bruteforce.
const RESET_RATE_LIMIT = { max: 5, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request) ?? 'unknown';
    const rateLimit = await checkRateLimit(`mot-de-passe-oublie:${ip}`, RESET_RATE_LIMIT.max, RESET_RATE_LIMIT.windowMs);
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit.retryAfterSeconds);
    }

    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email) {
      return NextResponse.json({ error: 'Le champ "email" est requis' }, { status: 400 });
    }

    const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });

    if (utilisateur) {
      const { token, tokenHash, expiresAt } = generateResetToken();
      await prisma.utilisateur.update({
        where: { id: utilisateur.id },
        data: { resetTokenHash: tokenHash, resetTokenExpire: expiresAt },
      });

      // L'hôte de la requête et non `request.nextUrl.origin` : ce dernier porte
      // l'adresse interne du serveur (localhost:PORT, ou l'hôte vu par le
      // process derrière un reverse proxy), pas le domaine que l'utilisateur a
      // réellement visité. Le lien reçu par email doit ramener exactement là,
      // seul hôte où son cookie de session pourra être posé — d'où originForHost
      // plutôt que l'hôte canonique de l'espace, qui peut différer en dev.
      const hote = request.headers.get('host');
      if (!spaceForHost(hote)) {
        return NextResponse.json({ message: GENERIC_MESSAGE });
      }
      const resetUrl = `${originForHost(hote as string)}/reinitialiser-mot-de-passe?token=${token}`;
      await sendPasswordResetEmail(email, resetUrl);
    }

    return NextResponse.json({ message: GENERIC_MESSAGE });
  } catch (error) {
    return jsonError(error);
  }
}
