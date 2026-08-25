// Configuration des espaces applicatifs : quel hôte sert quel espace, et sous
// quel nom de cookie. Module volontairement PUR — aucun import de `next/*`,
// de Prisma ni de crypto — pour rester chargeable depuis n'importe où : un
// composant client, un script Node hors contexte Next (scripts/*.ts), ou
// lib/auth.ts qui le ré-exporte. Y ajouter une dépendance runtime casserait
// ces trois usages d'un coup.

// --- Isolation des sessions par espace applicatif ---------------------------
//
// Un espace applicatif = un HÔTE = un cookie. Depuis la séparation par
// domaines, l'espace d'une requête n'est plus déduit d'un indice envoyé par le
// client (l'ancien header `x-pd-space`, falsifiable) mais du `Host`, que le
// navigateur pose lui-même à partir de l'origine visitée : c'est devenu une
// frontière d'autorisation, plus un simple aiguillage.
//
// Deux domaines RACINES distincts :
//   - domaine "ops"    → espace `admin` (back-office). Jamais exposé aux
//                        marchands ni au terrain, filtrable par IP/VPN.
//   - domaine "métier" → trois sous-domaines : `planner`, `marchand`,
//                        `terrain`.
//
// Le back-office étant sur un domaine racine séparé (et non un quatrième
// sous-domaine du domaine métier), toute requête entre lui et le domaine
// métier est *cross-site* : `sameSite: 'strict'` sur son cookie devient une
// barrière CSRF structurelle, et aucun sous-domaine métier compromis ne peut
// écrire un cookie visible par le back-office.
export type SessionSpace = 'admin' | 'planner' | 'marchand' | 'terrain';

export const SESSION_SPACES: SessionSpace[] = ['admin', 'planner', 'marchand', 'terrain'];

// Hôtes de développement : les noms en `.localhost` résolvent vers la boucle
// locale et sont traités comme "potentially trustworthy" par les navigateurs,
// donc compatibles avec les cookies `Secure` sans certificat local.
const SPACE_HOSTS_DEV: Record<SessionSpace, string> = {
  admin: 'admin.localhost:3000',
  planner: 'planner.localhost:3000',
  marchand: 'marchand.localhost:3000',
  terrain: 'app.localhost:3000',
};

// Lectures statiques (et non `process.env[...]` dynamique) : c'est la seule
// forme que Next.js sait remplacer à la compilation pour les variables
// NEXT_PUBLIC_, nécessaire pour que les composants clients (lien de retour
// vers le back-office, cf. MarchandShell) résolvent le même hôte que le
// serveur.
const SPACE_HOSTS_ENV: Record<SessionSpace, string | undefined> = {
  admin: process.env.NEXT_PUBLIC_HOST_ADMIN,
  planner: process.env.NEXT_PUBLIC_HOST_PLANNER,
  marchand: process.env.NEXT_PUBLIC_HOST_MARCHAND,
  terrain: process.env.NEXT_PUBLIC_HOST_TERRAIN,
};

export const SPACE_HOSTS: Record<SessionSpace, string> = {
  admin: SPACE_HOSTS_ENV.admin ?? SPACE_HOSTS_DEV.admin,
  planner: SPACE_HOSTS_ENV.planner ?? SPACE_HOSTS_DEV.planner,
  marchand: SPACE_HOSTS_ENV.marchand ?? SPACE_HOSTS_DEV.marchand,
  terrain: SPACE_HOSTS_ENV.terrain ?? SPACE_HOSTS_DEV.terrain,
};

// Hôtes ACCEPTÉS pour chaque espace — la table ci-dessus n'en donne que le
// représentant CANONIQUE. En production il n'y en a qu'un, celui configuré.
// Hors production, l'hôte `.localhost` reste accepté en plus de la surcharge
// d'environnement : sans ça, brancher un espace sur un tunnel pour le tester
// au téléphone le rendrait injoignable depuis le PC, et il faudrait rebasculer
// la configuration (donc rebuilder) à chaque aller-retour. Les quatre espaces
// restent ainsi testables en local en permanence, tunnel branché ou non.
const SPACE_HOSTS_ACCEPTES: Record<SessionSpace, string[]> = Object.fromEntries(
  SESSION_SPACES.map((s) => [
    s,
    process.env.NODE_ENV === 'production'
      ? [SPACE_HOSTS[s]]
      : [...new Set([SPACE_HOSTS[s], SPACE_HOSTS_DEV[s]])],
  ])
) as Record<SessionSpace, string[]>;

// En production, un hôte non configuré ferait tomber tous les espaces sur les
// valeurs `.localhost` : plus aucune requête réelle ne matcherait et l'app
// répondrait 404 partout. On échoue explicitement au premier passage dans le
// proxy plutôt que de laisser diagnostiquer ça en aveugle.
export function assertSpaceHostsConfigured(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const manquants = SESSION_SPACES.filter((s) => !SPACE_HOSTS_ENV[s]);
  if (manquants.length > 0) {
    throw new Error(
      `Hôtes d'espace non configurés : ${manquants
        .map((s) => `NEXT_PUBLIC_HOST_${s.toUpperCase()}`)
        .join(', ')}`
    );
  }
}

// Source de vérité de l'espace d'une requête. Le `Host` est posé par le
// navigateur d'après l'origine réellement visitée : contrairement à l'ancien
// header `x-pd-space`, il n'est pas falsifiable par du JavaScript de page.
// Derrière un reverse proxy, s'assurer que `X-Forwarded-Host` est bien
// répercuté sur `Host` (sinon tous les espaces se confondent).
export function spaceForHost(host: string | null | undefined): SessionSpace | null {
  if (!host) return null;
  const normalise = host.trim().toLowerCase();
  return (
    SESSION_SPACES.find((s) =>
      SPACE_HOSTS_ACCEPTES[s].some((h) => h.toLowerCase() === normalise)
    ) ?? null
  );
}

// Hôtes joignables en clair. Hors production, tout ce qui n'est pas la boucle
// locale ou une IP privée est joint en `https` : cas typique, un tunnel (ngrok)
// pointé sur le dev server pour tester depuis un vrai téléphone, la caméra
// exigeant un contexte sécurisé. Sans cette distinction, spaceOrigin annoncerait
// `http://` là où le navigateur pose `https://`, et le contrôle d'`Origin`
// (proxy.ts §2) refuserait tout POST — login compris.
function estHoteEnClair(host: string): boolean {
  const nom = host.split(':')[0].toLowerCase();
  if (nom === 'localhost' || nom.endsWith('.localhost')) return true;
  if (nom.startsWith('127.') || nom.startsWith('10.') || nom.startsWith('192.168.')) return true;
  const [a, b] = nom.split('.').map(Number);
  return a === 172 && b >= 16 && b <= 31;
}

// Origine complète d'un espace : sert à la fois au contrôle d'`Origin`
// anti-CSRF (proxy.ts) et à la construction des rares liens inter-espaces,
// qui doivent désormais être absolus puisqu'ils changent de domaine.
function protocolePour(host: string): 'http' | 'https' {
  return process.env.NODE_ENV === 'production' || !estHoteEnClair(host) ? 'https' : 'http';
}

// Origine CANONIQUE d'un espace : réservée aux liens INTER-espaces (retour
// back-office depuis le portail marchand, transfert de session, redirection
// d'un compte saisi sur le mauvais domaine). Pour rester sur l'hôte que le
// visiteur a réellement tapé, utiliser originForHost ci-dessous.
export function spaceOrigin(space: SessionSpace): string {
  const host = SPACE_HOSTS[space];
  return `${protocolePour(host)}://${host}`;
}

// Origine de l'hôte effectivement servi. Toute redirection INTERNE à un espace
// doit être bâtie dessus : depuis que plusieurs hôtes mènent au même espace en
// développement, viser l'hôte canonique enverrait le téléphone connecté par le
// tunnel vers un `.localhost` qu'il ne sait pas résoudre. À n'appeler qu'avec
// un hôte déjà validé par spaceForHost.
export function originForHost(host: string): string {
  const nom = host.trim().toLowerCase();
  return `${protocolePour(nom)}://${nom}`;
}

// Préfixe `__Host-` en production : le navigateur REFUSE un cookie ainsi
// nommé s'il porte un attribut `Domain` ou un `Path` autre que `/`, et exige
// `Secure`. Le cookie est donc strictement lié à l'hôte exact qui l'a posé —
// un sous-domaine du domaine métier compromis (ou pris par un tiers) ne peut
// ni le lire ni l'écraser ("cookie tossing"). Désactivé hors production, où
// `Secure` n'est pas garanti selon la façon dont on sert l'app en local.
const COOKIE_PREFIX = process.env.NODE_ENV === 'production' ? '__Host-' : '';

export const SESSION_COOKIE_NAMES: Record<SessionSpace, string> = {
  admin: `${COOKIE_PREFIX}pd_session_admin`,
  planner: `${COOKIE_PREFIX}pd_session_planner`,
  marchand: `${COOKIE_PREFIX}pd_session_marchand`,
  terrain: `${COOKIE_PREFIX}pd_session_terrain`,
};

// Noms utilisés avant la séparation par domaines (cookie unique `pd_session`,
// puis un cookie par espace sans préfixe `__Host-`) : conservés uniquement
// pour les supprimer proprement chez les clients qui les ont encore. Filtrés
// des noms courants, car hors production le préfixe est vide et les deux
// listes se recouvrent.
const LEGACY_NAMES = ['pd_session', 'pd_session_admin', 'pd_session_marchand', 'pd_session_terrain'];

export const LEGACY_SESSION_COOKIE_NAMES = LEGACY_NAMES.filter(
  (nom) => !SESSION_SPACES.some((s) => SESSION_COOKIE_NAMES[s] === nom)
);
