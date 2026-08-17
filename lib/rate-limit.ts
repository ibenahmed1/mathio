import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const RATE_LIMIT_MESSAGE = 'Trop de tentatives. Réessayez dans quelques instants.';

// Réponse 429 standard pour les trois endpoints publics limités
// (login, mot de passe oublié, inscription marchand) — même message
// générique partout pour rester cohérent avec RG-12 (ne rien révéler de
// plus qu'une erreur de validation classique).
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: RATE_LIMIT_MESSAGE },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}

// Extrait l'IP appelante depuis les en-têtes posés par le proxy amont
// (Vercel/nginx/etc.) : `request.ip` n'existe pas sur l'objet Request
// standard des route handlers Next.js, donc on retombe sur les en-têtes
// usuels — utilisé à la fois pour le rate limiting et pour AuditLog.adresseIp.
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Fenêtre fixe atomique par clé (ex. "login:<ip>"), stockée en Postgres
// plutôt qu'en mémoire process (voir prisma/schema.prisma, RateLimitEntry).
// L'upsert ci-dessous incrémente le compteur si la fenêtre en cours n'est pas
// expirée, ou la réinitialise sinon — en une seule requête atomique (le
// verrouillage de ligne PostgreSQL sur ON CONFLICT évite qu'une rafale de
// requêtes concurrentes ne contourne la limite).
//
// `retryAfterSeconds` est calculé côté Postgres (EXTRACT(EPOCH ...)) plutôt
// qu'en ré-analysant `fenetre_debut` côté Node : `timestamp without time
// zone` + fuseau du serveur Postgres différent de celui du process Node
// produisait un décalage d'une heure sur la valeur recalculée en JS.
export async function checkRateLimit(key: string, maxAttempts: number, windowMs: number): Promise<RateLimitResult> {
  const rows = await prisma.$queryRaw<{ compteur: number; retry_after_seconds: number }[]>`
    INSERT INTO rate_limit_entries (id, cle, compteur, fenetre_debut)
    VALUES (${randomUUID()}, ${key}, 1, now())
    ON CONFLICT (cle) DO UPDATE SET
      compteur = CASE
        WHEN rate_limit_entries.fenetre_debut < now() - (${windowMs} * interval '1 millisecond')
          THEN 1
        ELSE rate_limit_entries.compteur + 1
      END,
      fenetre_debut = CASE
        WHEN rate_limit_entries.fenetre_debut < now() - (${windowMs} * interval '1 millisecond')
          THEN now()
        ELSE rate_limit_entries.fenetre_debut
      END
    RETURNING
      compteur,
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (fenetre_debut + (${windowMs} * interval '1 millisecond') - now())))
      )::int AS retry_after_seconds;
  `;

  const row = rows[0];
  return { allowed: row.compteur <= maxAttempts, retryAfterSeconds: row.retry_after_seconds };
}
