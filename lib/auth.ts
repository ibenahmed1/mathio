import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { Role } from '@/app/generated/prisma/enums';
import { SESSION_COOKIE_NAMES, spaceForHost, type SessionSpace } from '@/lib/spaces';

// Réduit de 7 jours à 24h : même si `verifySpaceCookie` (ci-dessous) revérifie
// désormais `Utilisateur.actif` en base à chaque requête pour une révocation
// immédiate, une durée plus courte reste une seconde ligne de défense —
// elle borne la fenêtre d'exposition d'un cookie volé indépendamment de ce
// contrôle applicatif.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 heures

// Configuration des espaces (hôtes, cookies) : définie dans lib/spaces.ts,
// module pur sans dépendance runtime, et ré-exportée ici pour que les
// appelants n'aient qu'un seul point d'entrée `@/lib/auth`.
export {
  SESSION_SPACES,
  SPACE_HOSTS,
  SESSION_COOKIE_NAMES,
  LEGACY_SESSION_COOKIE_NAMES,
  assertSpaceHostsConfigured,
  spaceForHost,
  spaceOrigin,
} from '@/lib/spaces';
export type { SessionSpace } from '@/lib/spaces';

// Rôles ayant accès plein à l'espace back-office (/admin/**), servi sur le
// domaine "ops". Brique de base de SPACE_ROLES.admin ci-dessous, exposée ici
// pour que les deux garde-fous indépendants (proxy.ts et
// app/admin/layout.tsx, cf. leurs commentaires respectifs) partagent la même
// liste plutôt que de la dupliquer en dur à chaque endroit et risquer qu'elle
// diverge.
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
// distribution — composition, clôture de tournée — et poste de scan), servie
// sur son propre sous-domaine du domaine métier. Contrairement aux
// confinements ROLES_KANBAN_UNIQUEMENT / ROLES_HUB_UNIQUEMENT ci-dessus, qui
// restent des REDIRECTIONS appliquées dans proxy.ts à l'intérieur de l'espace
// admin, celui du Planner est désormais STRUCTUREL : `planner` n'est pas dans
// SPACE_ROLES.admin, donc il ne peut pas détenir de session sur le domaine
// ops, et son cookie n'y est de toute façon jamais envoyé. Doit
// obligatoirement être rattaché à un Hub (Utilisateur.hubId, validé côté
// API) : toutes les routes /api/bons-distribution/** forcent son périmètre sur
// ce hub, jamais sur un hubId fourni dans la requête.
export const ROLES_PLANNER_UNIQUEMENT: Role[] = ['planner'];

// Rôles ayant accès à la web app Planner (/planner/**) : le Planner lui-même,
// et l'admin — qui planifie tous les hubs et doit pouvoir dépanner depuis
// l'écran terrain. Exactement la liste que les routes
// /api/bons-distribution/** autorisent déjà (`requireUser(['admin',
// 'planner'])`), exposée ici pour que le proxy et app/planner/layout.tsx
// partagent la même définition plutôt que de la redupliquer.
export const ROLES_PLANIFICATION: Role[] = ['admin', ...ROLES_PLANNER_UNIQUEMENT];

// Rôles autorisés à DÉTENIR une session dans chaque espace. Remplace
// l'ancienne table `ROLE_SPACES` (un rôle → un espace) : depuis que le Planner
// a son propre hôte, l'admin doit pouvoir détenir une session dans deux
// espaces (le back-office, et la web app Planner qu'il utilise pour planifier
// tous les hubs et dépanner depuis l'écran terrain). Un rôle peut donc figurer
// dans plusieurs espaces, mais chaque session reste liée à un seul, scellé
// dans le claim `aud` du JWT (cf. signSession).
export const SPACE_ROLES: Record<SessionSpace, Role[]> = {
  admin: [...ROLES_BACKOFFICE, ...ROLES_KANBAN_UNIQUEMENT, ...ROLES_HUB_UNIQUEMENT],
  planner: ROLES_PLANIFICATION,
  marchand: ['marchand'],
  terrain: ['livreur', 'ramasseur'],
};

// Rôles autorisés à ouvrir une session PAR MOT DE PASSE sur l'hôte d'un
// espace — sous-ensemble strict de SPACE_ROLES. L'admin en est délibérément
// exclu côté Planner : ses identifiants ne doivent jamais être saisis sur le
// domaine métier, exposé à Internet, alors que le back-office peut être
// filtré par IP/VPN. Il accède au Planner par transfert de session à usage
// unique depuis le back-office (cf. POST /api/session-handoff), ce qui lui
// conserve l'accès sans déplacer la surface d'attaque de son mot de passe.
export const SPACE_LOGIN_ROLES: Record<SessionSpace, Role[]> = {
  admin: SPACE_ROLES.admin,
  planner: ROLES_PLANNER_UNIQUEMENT,
  marchand: ['marchand'],
  terrain: ['livreur', 'ramasseur'],
};

export function spaceAllowsRole(space: SessionSpace, role: Role): boolean {
  return SPACE_ROLES[space].includes(role);
}

// Espace "d'origine" d'un rôle : celui où il atterrit après connexion, et
// celui qui fait référence pour interdire qu'un rôle supplémentaire franchisse
// une frontière d'espace (cf. PATCH /api/utilisateurs/[id]). Distinct de
// SPACE_ROLES : l'admin peut détenir une session Planner, mais son espace
// d'origine reste le back-office.
const HOME_SPACES: Record<Role, SessionSpace> = {
  admin: 'admin',
  superviseur: 'admin',
  moderateur: 'admin',
  equipe_suivi: 'admin',
  responsable: 'admin',
  design: 'admin',
  gestionnaire_hub: 'admin',
  agent_hub: 'admin',
  planner: 'planner',
  marchand: 'marchand',
  livreur: 'terrain',
  ramasseur: 'terrain',
};

export function getHomeSpace(role: Role): SessionSpace {
  return HOME_SPACES[role];
}

// Headers internes posés par proxy.ts une fois le JWT vérifié, pour
// éviter de re-vérifier la signature à chaque route handler. Tous sont
// écrasés (`Headers.set`) à chaque requête : une valeur homonyme envoyée par
// le client est donc systématiquement remplacée, jamais lue.
export const USER_ID_HEADER = 'x-pd-user-id';
export const USER_ROLE_HEADER = 'x-pd-user-role';
// Rôles supplémentaires (voir SessionPayload.extraRoles), liste séparée par
// des virgules — vide si aucun octroi, jamais absent une fois qu'une session
// est posée (cf. withUserHeaders dans proxy.ts).
export const EXTRA_ROLES_HEADER = 'x-pd-user-extra-roles';
// Espace de la session, déduit du `Host` par le proxy. Remplace l'ancien
// `x-pd-space` posé par le client : même nom de concept, mais la valeur ne
// vient plus du navigateur et vaut donc autorisation.
export const SESSION_SPACE_HEADER = 'x-pd-session-space';
// "1" quand la session résulte d'une impersonation admin (cf.
// /api/session-handoff) : sert à l'UI (bandeau + retour back-office) et à la
// traçabilité, jamais à accorder un droit supplémentaire.
export const IMPERSONATED_HEADER = 'x-pd-impersonated';

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
  // Espace (donc hôte) d'où provient la session — utile aux handlers partagés
  // entre plusieurs espaces pour construire un lien de retour correct.
  space: SessionSpace;
  // Session ouverte par un admin sur le compte d'un tiers (impersonation
  // marchand). Purement informatif : n'accorde ni ne retire aucun droit.
  impersonated: boolean;
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
  space: SessionSpace;
  impersonated: boolean;
}

// L'espace est scellé dans le claim `aud` : un token émis pour l'espace
// marchand échoue à la VÉRIFICATION sur l'hôte du back-office, avant même la
// relecture du rôle en base. C'est le pendant cryptographique du cloisonnement
// par cookie : un token recopié à la main d'un espace à l'autre (ou un cookie
// renommé) est rejeté par la signature, pas seulement par la logique métier.
export async function signSession(payload: JwtSessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role, imp: payload.impersonated })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setAudience(payload.space)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecretKey());
}

// `space` est l'espace attendu (déduit du `Host`), pas une valeur lue dans le
// token : jwtVerify échoue si l'`aud` du token ne correspond pas.
export async function verifySessionToken(
  token: string,
  space: SessionSpace
): Promise<JwtSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecretKey(), { audience: space });
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return {
      sub: payload.sub,
      role: payload.role as Role,
      space,
      impersonated: payload.imp === true,
    };
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
  const space = spaceForHost(h.get('host'));
  if (!space) return null;
  return {
    sub,
    role: role as Role,
    extraRoles,
    space,
    impersonated: h.get(IMPERSONATED_HEADER) === '1',
  };
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

// Vérifie le cookie de l'espace courant, à trois niveaux successifs :
//   1. signature du JWT ET claim `aud` == espace attendu (verifySessionToken) ;
//   2. compte toujours actif, rôle et rôles supplémentaires RELUS EN BASE
//      (getSessionAuthState) — jamais ceux figés dans le token ;
//   3. le rôle ainsi relu est bien autorisé dans cet espace (SPACE_ROLES).
//
// Le niveau 3 invalide la session d'un utilisateur dont un admin a changé le
// rôle vers un autre espace : il doit se reconnecter sur le bon domaine.
// Un cookie recopié d'un espace à l'autre échoue dès le niveau 1 — et, en
// production, n'est de toute façon jamais envoyé, les cookies `__Host-` étant
// liés à l'hôte exact qui les a posés.
export async function verifySpaceCookie(
  jar: SessionCookieJar,
  space: SessionSpace
): Promise<SessionPayload | null> {
  const token = jar.get(SESSION_COOKIE_NAMES[space])?.value;
  if (!token) return null;
  const decoded = await verifySessionToken(token, space);
  if (!decoded) return null;
  const state = await getSessionAuthState(decoded.sub);
  if (!state || !state.actif) return null;
  if (!spaceAllowsRole(space, state.role)) return null;
  return {
    sub: decoded.sub,
    role: state.role,
    extraRoles: state.extraRoles,
    space,
    impersonated: decoded.impersonated,
  };
}

// Espace de la requête en cours, déduit du `Host`. `null` si l'hôte n'est pas
// un des quatre configurés — cas traité en 404 par le proxy.
export async function getCurrentSpace(): Promise<SessionSpace | null> {
  const h = await headers();
  return spaceForHost(h.get('host'));
}

// Utilisé par les Server Components de pages (app/**/page.tsx, layout.tsx) et
// les Server Actions : proxy.ts protège déjà les préfixes gardés, mais on
// revérifie ici indépendamment (les Server Actions ne passent pas par le
// proxy) et pour rester sûr même en cas de changement de config de routage.
//
// L'espace n'est plus un choix de l'appelant : c'est celui de l'hôte servi.
// L'argument `allowed` déclare seulement sur quel(s) hôte(s) la page a un sens
// — une page servie sur un autre hôte est traitée comme non authentifiée
// (redirection /login par l'appelant). Un tableau couvre les pages partagées
// entre espaces, ex. la vue d'un bon de livraison consultable côté back-office
// comme côté marchand.
export async function getPageSession(
  allowed?: SessionSpace | SessionSpace[]
): Promise<SessionPayload | null> {
  const space = await getCurrentSpace();
  if (!space) return null;
  if (allowed) {
    const liste = Array.isArray(allowed) ? allowed : [allowed];
    if (!liste.includes(space)) return null;
  }
  const store = await cookies();
  return verifySpaceCookie(store, space);
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

// --- Transfert de session entre domaines ------------------------------------
//
// Les cookies étant liés à l'hôte exact qui les pose (`__Host-`), le
// back-office ne peut PLUS écrire directement une session sur le domaine
// métier — c'est précisément ce qu'on recherche. Les deux passerelles
// légitimes qui en avaient besoin passent donc par un jeton à usage unique et
// à durée très courte, échangé contre une vraie session sur l'hôte cible :
//
//   1. impersonation d'un marchand par un admin (support, dépannage) ;
//   2. accès de l'admin à la web app Planner, dont le formulaire de connexion
//      refuse son rôle (cf. SPACE_LOGIN_ROLES) pour que son mot de passe ne
//      soit jamais saisi sur le domaine exposé à Internet.
//
// 60 secondes : le jeton ne vit que le temps d'une redirection navigateur.
// Il transite dans une URL (donc potentiellement journalisée par un proxy),
// d'où l'usage unique + le TTL très court + le stockage en base du seul hash.
export const HANDOFF_TOKEN_TTL_MS = 60 * 1000; // 60 secondes

export function generateHandoffToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + HANDOFF_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

export function hashHandoffToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
