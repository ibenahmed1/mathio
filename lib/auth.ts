import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { Role } from '@/app/generated/prisma/enums';

// Réduit de 7 jours à 24h : même si `verifySpaceCookie` (ci-dessous) revérifie
// désormais `Utilisateur.actif` en base à chaque requête pour une révocation
// immédiate, une durée plus courte reste une seconde ligne de défense —
// elle borne la fenêtre d'exposition d'un cookie volé indépendamment de ce
// contrôle applicatif.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 heures

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

// Rôles ayant accès à l'espace back-office (/admin/**) — dérivé de ROLE_SPACES
// ci-dessous (tout rôle dont l'espace est 'admin'), exposé ici pour que les
// deux garde-fous indépendants (proxy.ts et app/admin/layout.tsx, cf. leurs
// commentaires respectifs) partagent la même liste plutôt que de la dupliquer
// en dur à chaque endroit et risquer qu'elle diverge.
export const ROLES_BACKOFFICE: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi', 'responsable'];

// Rôles cantonnés à l'outil Kanban (/admin/tasks) uniquement : ils partagent
// le cookie/espace admin (pour atteindre /admin/tasks) mais PAS ROLES_BACKOFFICE
// — aucune route API hors taches/** ne les autorise, et proxy.ts les
// redirige hors de toute page /admin/** qui n'est pas /admin/tasks.
export const ROLES_KANBAN_UNIQUEMENT: Role[] = ['design', 'gestionnaire_hub'];

// Rôle cantonné à la réception de dépôt au hub régional (§ /admin/scan/reception)
// uniquement : même principe et mécanisme de confinement que
// ROLES_KANBAN_UNIQUEMENT ci-dessus, appliqué dans proxy.ts et
// filterNavByRole (components/admin/nav.ts) — pas ROLES_BACKOFFICE, aucun
// accès aux colis marchand normaux ni au reste du back-office. Doit
// obligatoirement être rattaché à un Hub (Utilisateur.hubId), validé côté
// API (POST/PATCH /api/utilisateurs).
export const ROLES_HUB_UNIQUEMENT: Role[] = ['agent_hub'];

// Rôle cantonné à sa propre web app (§ /planner : accueil, bons de
// distribution — composition, clôture de tournée — et poste de scan) : même
// principe et mécanisme de confinement que ROLES_HUB_UNIQUEMENT ci-dessus,
// appliqué dans proxy.ts, à ceci près que le Planner est renvoyé hors du
// back-office entièrement plutôt que cantonné à une de ses pages. Aucun accès
// au reste du back-office (colis marchand, finances, utilisateurs). Doit
// obligatoirement
// être rattaché à un Hub (Utilisateur.hubId, validé côté API) : toutes les
// routes /api/bons-distribution/** forcent son périmètre sur ce hub, jamais
// sur un hubId fourni dans la requête.
export const ROLES_PLANNER_UNIQUEMENT: Role[] = ['planner'];

// Rôles ayant accès à la web app Planner (/planner/**) : le Planner lui-même,
// et l'admin — qui planifie tous les hubs et doit pouvoir dépanner depuis
// l'écran terrain. Exactement la liste que les routes
// /api/bons-distribution/** autorisent déjà (`requireUser(['admin',
// 'planner'])`), exposée ici pour que le proxy et app/planner/layout.tsx
// partagent la même définition plutôt que de la redupliquer.
export const ROLES_PLANIFICATION: Role[] = ['admin', ...ROLES_PLANNER_UNIQUEMENT];

const ROLE_SPACES: Record<Role, SessionSpace> = {
  admin: 'admin',
  superviseur: 'admin',
  moderateur: 'admin',
  equipe_suivi: 'admin',
  responsable: 'admin',
  design: 'admin',
  gestionnaire_hub: 'admin',
  agent_hub: 'admin',
  planner: 'admin',
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
// Rôles supplémentaires (voir SessionPayload.extraRoles), liste séparée par
// des virgules — vide si aucun octroi, jamais absent une fois qu'une session
// est posée (cf. withUserHeaders dans proxy.ts).
export const EXTRA_ROLES_HEADER = 'x-pd-user-extra-roles';

function getAuthSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set');
  }
  return new TextEncoder().encode(secret);
}

// Politique de robustesse appliquée à tous les mots de passe/secrets créés ou
// réinitialisés dans l'app (compte équipe, marchand, membre marchand, reset
// self-service ou admin) — un seul endroit à faire évoluer plutôt que six
// seuils divergents (4 ou 6 caractères) éparpillés dans les routes.
const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_POLICY_MESSAGE =
  'Le mot de passe doit contenir au moins 8 caractères, avec une majuscule, un chiffre et un caractère spécial';

// Format canonique des numéros de téléphone marocains stockés en base :
// "0" + 9 chiffres (05/06/07), identique au format déjà utilisé par les
// comptes existants (cf. prisma/seed.ts) — on normalise vers ce format
// plutôt que vers l'E.164 ("+212...") pour ne pas avoir à migrer les
// numéros déjà en base. Accepte en entrée les variantes avec espaces,
// tirets, "+212" ou "212" en préfixe.
const PHONE_REGEX = /^0[5-7]\d{8}$/;

// Un seul endroit à faire évoluer (inscription marchand, modification du
// profil marchand par son titulaire...) plutôt que de dupliquer le motif.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function normalizePhoneMaroc(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let local: string;
  if (digits.startsWith('+212')) {
    local = `0${digits.slice(4)}`;
  } else if (digits.startsWith('212') && digits.length === 12) {
    local = `0${digits.slice(3)}`;
  } else if (digits.startsWith('0')) {
    local = digits;
  } else {
    return null;
  }
  return PHONE_REGEX.test(local) ? local : null;
}

export function getPasswordPolicyError(secret: string): string | null {
  if (
    secret.length < PASSWORD_MIN_LENGTH ||
    !/[A-Z]/.test(secret) ||
    !/[0-9]/.test(secret) ||
    !/[^A-Za-z0-9]/.test(secret)
  ) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}

export async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

// Session pleinement résolue (JWT + état base) : `role` reste le rôle réel
// de l'utilisateur (espace de session, libellé UI...), `extraRoles` porte les
// rôles supplémentaires accordés ponctuellement (Utilisateur.rolesSupplementaires,
// voir prisma/schema.prisma) — toujours vérifier les deux via `roleMatches()`
// plutôt que `allowedRoles.includes(session.role)` pour honorer ces octrois.
export interface SessionPayload {
  sub: string;
  role: Role;
  extraRoles: Role[];
}

// Un utilisateur "a accès" à une liste de rôles autorisés si son rôle réel
// OU un de ses rôles supplémentaires accordés y figure.
export function roleMatches(session: SessionPayload, allowedRoles: Role[]): boolean {
  return allowedRoles.includes(session.role) || session.extraRoles.some((r) => allowedRoles.includes(r));
}

// Payload minimal porté par le JWT lui-même : sert uniquement à identifier
// l'utilisateur (`sub`) au moment de l'authentification. Ni `role` ni
// `extraRoles` ne font foi une fois le token émis — les deux sont relus en
// base à chaque requête (voir getSessionAuthState) pour qu'un changement de
// rôle par un admin s'applique immédiatement, sans attendre l'expiration du
// cookie (24h) ni une reconnexion.
interface JwtSessionPayload {
  sub: string;
  role: Role;
}

export async function signSession(payload: JwtSessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecretKey());
}

// Utilisé uniquement par proxy.ts (runtime Node.js du fichier "proxy" —
// convention Next.js 16 remplaçant "middleware"), qui possède le JWT brut.
export async function verifySessionToken(token: string): Promise<JwtSessionPayload | null> {
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
// (source de vérité déjà validée : role + actif + rolesSupplementaires
// relus en base par verifySpaceCookie/verifyGuardCookie), pas de nouvelle
// vérification de signature ni de nouvelle requête base ici.
export async function getSessionUser(): Promise<SessionPayload | null> {
  const h = await headers();
  const sub = h.get(USER_ID_HEADER);
  const role = h.get(USER_ROLE_HEADER);
  if (!sub || !role) return null;
  const extraRolesHeader = h.get(EXTRA_ROLES_HEADER);
  const extraRoles = extraRolesHeader ? (extraRolesHeader.split(',').filter(Boolean) as Role[]) : [];
  return { sub, role: role as Role, extraRoles };
}

interface SessionCookieJar {
  get(name: string): { value: string } | undefined;
}

// Revérifié à chaque requête (pas mis en cache) : le JWT lui-même ne fait foi
// que pour authentifier `sub` (signature valide) — ni le rôle principal, ni
// le statut du compte, ni les rôles supplémentaires n'y sont considérés comme
// à jour. C'est le seul moyen de révoquer immédiatement l'accès d'un compte
// désactivé (actif=false), de refléter un octroi/retrait de rôle
// supplémentaire, ou un changement du rôle principal (ex. Superviseur →
// Design) sans attendre l'expiration du cookie (24h, cf.
// SESSION_MAX_AGE_SECONDS) ni une reconnexion. Une seule requête par id (clé
// primaire) reste peu coûteuse au regard du volume de ce projet.
export interface SessionAuthState {
  role: Role;
  actif: boolean;
  extraRoles: Role[];
}

export async function getSessionAuthState(userId: string): Promise<SessionAuthState | null> {
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: userId },
    select: { role: true, actif: true, rolesSupplementaires: true },
  });
  if (!utilisateur) return null;
  return { role: utilisateur.role, actif: utilisateur.actif, extraRoles: utilisateur.rolesSupplementaires };
}

// Vérifie le cookie d'un espace donné ET que le rôle courant (relu en base,
// pas celui figé dans le JWT à la connexion) appartient bien à cet espace.
// Ce contrôle empêche à la fois un cookie forgé/renommé à la main (ex. un
// token "marchand" posé sous le nom du cookie admin) ET un cookie devenu
// obsolète parce qu'un admin a changé le rôle de l'utilisateur vers un autre
// espace applicatif — dans ce second cas, la session est invalidée et
// l'utilisateur doit se reconnecter dans le bon espace. Vérifie aussi `actif`
// et récupère les rôles supplémentaires en base (voir getSessionAuthState) à
// chaque appel.
async function verifySpaceCookie(jar: SessionCookieJar, space: SessionSpace): Promise<SessionPayload | null> {
  const token = jar.get(SESSION_COOKIE_NAMES[space])?.value;
  if (!token) return null;
  const decoded = await verifySessionToken(token);
  if (!decoded) return null;
  const state = await getSessionAuthState(decoded.sub);
  if (!state || !state.actif) return null;
  if (getSessionSpace(state.role) !== space) return null;
  return { sub: decoded.sub, role: state.role, extraRoles: state.extraRoles };
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
