import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import type { Role } from '@/app/generated/prisma/enums';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 jours

// --- Isolation des sessions par espace applicatif ---------------------------
//
// Chaque rôle appartient à un "espace" (back-office, marchand, terrain) et
// chaque espace a son propre cookie de session. Cela évite qu'un même
// navigateur, avec deux onglets ouverts sur des espaces différents (ex. un
// agent connecté en back-office qui teste un compte marchand dans un autre
// onglet), ne voie une session écraser l'autre : les cookies ne se marchent
// jamais sur les pieds puisqu'ils portent des noms distincts.
export type SessionSpace = 'admin' | 'marchand' | 'terrain';

export const SESSION_COOKIE_NAMES: Record<SessionSpace, string> = {
  admin: 'pd_session_admin',
  marchand: 'pd_session_marchand',
  terrain: 'pd_session_terrain',
};

const SESSION_SPACES: SessionSpace[] = ['admin', 'marchand', 'terrain'];

// Nom du cookie unique utilisé avant l'isolation par espace : conservé
// uniquement pour le supprimer proprement chez les clients qui l'ont encore.
export const LEGACY_SESSION_COOKIE_NAME = 'pd_session';

const ROLE_SPACES: Record<Role, SessionSpace> = {
  admin: 'admin',
  finance: 'admin',
  sav: 'admin',
  agent_confirmation: 'admin',
  marchand: 'marchand',
  livreur: 'terrain',
  ramasseur: 'terrain',
};

export function getSessionSpace(role: Role): SessionSpace {
  return ROLE_SPACES[role];
}

export function getSessionCookieName(role: Role): string {
  return SESSION_COOKIE_NAMES[getSessionSpace(role)];
}

// En-tête posé par lib/api-client.ts sur chaque appel /api/** pour indiquer
// depuis quel espace applicatif part la requête (déduit de l'URL de la page
// courante). Cela sert uniquement d'indice de routage pour choisir quel
// cookie vérifier en premier quand plusieurs sessions coexistent dans le même
// navigateur : la valeur du header n'autorise jamais rien par elle-même, seule
// la signature du JWT du cookie correspondant fait foi.
export const SPACE_HINT_HEADER = 'x-pd-space';

// Headers internes posés par proxy.ts une fois le JWT vérifié, pour
// éviter de re-vérifier la signature à chaque route handler.
export const USER_ID_HEADER = 'x-pd-user-id';
export const USER_ROLE_HEADER = 'x-pd-user-role';

function getAuthSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set');
  }
  return new TextEncoder().encode(secret);
}

export async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

export interface SessionPayload {
  sub: string;
  role: Role;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecretKey());
}

// Utilisé uniquement par proxy.ts (Edge/Node runtime du proxy), qui possède le JWT brut.
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecretKey());
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return { sub: payload.sub, role: payload.role as Role };
  } catch {
    return null;
  }
}

// Utilisé par les route handlers : lit les headers posés par le proxy
// (source de vérité déjà validée), pas de nouvelle vérification de signature.
export async function getSessionUser(): Promise<SessionPayload | null> {
  const h = await headers();
  const sub = h.get(USER_ID_HEADER);
  const role = h.get(USER_ROLE_HEADER);
  if (!sub || !role) return null;
  return { sub, role: role as Role };
}

interface SessionCookieJar {
  get(name: string): { value: string } | undefined;
}

// Vérifie le cookie d'un espace donné ET que le rôle qu'il contient appartient
// bien à cet espace. Ce second contrôle empêche qu'un cookie forgé/renommé à
// la main (ex. un token "marchand" posé sous le nom du cookie admin) ne soit
// accepté silencieusement.
async function verifySpaceCookie(jar: SessionCookieJar, space: SessionSpace): Promise<SessionPayload | null> {
  const token = jar.get(SESSION_COOKIE_NAMES[space])?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || getSessionSpace(session.role) !== space) return null;
  return session;
}

// Utilisé par proxy.ts pour les routes /api/** : plusieurs sessions (une par
// espace) peuvent coexister dans le même navigateur, donc on essaie d'abord
// l'espace indiqué par `x-pd-space` (posé par lib/api-client.ts), puis les
// autres. L'autorisation fine par rôle reste faite par `requireUser()` dans
// chaque route handler : ceci ne fait que choisir quelle session utiliser.
export async function resolveApiSession(
  jar: SessionCookieJar,
  preferredSpace: SessionSpace | null
): Promise<SessionPayload | null> {
  const order = preferredSpace
    ? [preferredSpace, ...SESSION_SPACES.filter((s) => s !== preferredSpace)]
    : SESSION_SPACES;

  for (const space of order) {
    const session = await verifySpaceCookie(jar, space);
    if (session) return session;
  }
  return null;
}

// Utilisé par les Server Components de pages (app/**/page.tsx, layout.tsx) et
// les Server Actions : proxy.ts protège déjà /admin/**, /marchand/** et
// /ramasseur/**, mais on revérifie ici indépendamment (les Server Actions ne
// passent pas par le proxy) et pour rester sûr même en cas de changement de
// config de routage.
//
// Si `space` est fourni, seul le cookie de cet espace est accepté (usage
// recommandé dans les layouts protégés). Sans argument, les trois espaces
// sont essayés dans l'ordre (usage pour les pages/actions partagées entre
// plusieurs espaces, ex. la vue d'un bon de livraison consultable par un
// marchand ou un admin).
export async function getPageSession(space?: SessionSpace): Promise<SessionPayload | null> {
  const store = await cookies();
  if (space) {
    return verifySpaceCookie(store, space);
  }
  for (const s of SESSION_SPACES) {
    const session = await verifySpaceCookie(store, s);
    if (session) return session;
  }
  return null;
}

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Le token brut part dans l'email/URL et n'est jamais stocké tel quel ; seul
// son hash SHA-256 est écrit en base (comme un token de session classique),
// pour qu'une fuite de la base ne permette pas de rejouer un lien de reset.
export function generateResetToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Utilisé pour la réinitialisation manuelle par l'admin : un mot de passe
// temporaire lisible, communiqué à l'utilisateur hors-app (téléphone, etc.).
export function generateTemporarySecret(): string {
  return randomBytes(6).toString('base64url'); // ~8 caractères, lisible
}
