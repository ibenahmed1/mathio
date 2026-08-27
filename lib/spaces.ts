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
// TROIS espaces, sur TROIS domaines RACINES totalement distincts — pas un
// domaine unique découpé en sous-domaines :
//   - domaine "ops"      → espace `admin` : tout le personnel interne, du
//                          back-office au planificateur de hub. Jamais exposé
//                          aux marchands ni au terrain, filtrable par IP/VPN.
//   - domaine "marchand" → les boutiques clientes.
//   - domaine "terrain"  → livreurs et ramasseurs.
//
// Le découpage suit l'AUDIENCE, pas le module : personnel interne / clients /
// terrain. C'est ce qui rend la frontière tenable dans le temps — un nouveau
// module interne (le Planner en a été le cas d'école) n'ouvre pas un espace de
// plus, il rejoint l'espace admin et n'y coûte qu'une entrée de navigation.
//
// Ce que TROIS RACINES distinctes changent, par rapport à un domaine commun
// découpé en sous-domaines — ce sont des propriétés du navigateur, pas des
// conventions internes :
//
//   1. Toute paire d'espaces est *cross-site*, et plus seulement la paire
//      ops/reste. `sameSite` devient donc une barrière effective ENTRE TOUS
//      les espaces : une page marchand compromise ne peut plus émettre de
//      requête authentifiée vers l'app terrain, ce qu'un simple sous-domaine
//      frère ne permettait pas d'empêcher (proxy.ts §2 fermait ce résidu, et
//      continue de le faire en défense indépendante).
//   2. Aucun espace n'a de domaine parent commun avec un autre : le "cookie
//      tossing" par un frère compromis (poser un cookie sur le parent pour
//      qu'il remonte chez le voisin) n'a plus de support. Le préfixe
//      `__Host-` ci-dessous reste, mais comme seconde ligne — il couvre
//      désormais un sous-domaine qui serait ajouté SOUS l'une des racines.
//   3. Aucune corrélation d'enregistrement : connaître le domaine marchand
//      n'apprend rien du domaine ops, qu'on ne veut pas voir deviner.
//
// En contrepartie, tout lien inter-espaces doit être ABSOLU (cf. spaceOrigin),
// et chaque racine a besoin de son propre certificat.
export type SessionSpace = 'admin' | 'marchand' | 'terrain';

export const SESSION_SPACES: SessionSpace[] = ['admin', 'marchand', 'terrain'];

// Hôtes de développement : les noms en `.localhost` résolvent vers la boucle
// locale et sont traités comme "potentially trustworthy" par les navigateurs,
// donc compatibles avec les cookies `Secure` sans certificat local.
//
// SEULE entorse au modèle : ces trois-là sont frères sous `.localhost`, là où
// la production a trois racines sans parent commun. L'isolation y tient donc
// au contrôle d'`Origin` (proxy.ts §2) et au fait qu'aucun cookie ne porte
// d'attribut `Domain`, pas à la frontière *cross-site*. Un test qui vise
// spécifiquement cette frontière n'a de valeur qu'en pré-production, sur les
// vrais domaines.
const SPACE_HOSTS_DEV: Record<SessionSpace, string> = {
  admin: 'admin.localhost:3000',
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
  marchand: process.env.NEXT_PUBLIC_HOST_MARCHAND,
  terrain: process.env.NEXT_PUBLIC_HOST_TERRAIN,
};

export const SPACE_HOSTS: Record<SessionSpace, string> = {
  admin: SPACE_HOSTS_ENV.admin ?? SPACE_HOSTS_DEV.admin,
  marchand: SPACE_HOSTS_ENV.marchand ?? SPACE_HOSTS_DEV.marchand,
  terrain: SPACE_HOSTS_ENV.terrain ?? SPACE_HOSTS_DEV.terrain,
};

// Hôtes ACCEPTÉS pour chaque espace — la table ci-dessus n'en donne que le
// représentant CANONIQUE. En production il n'y en a qu'un, celui configuré.
// Hors production, l'hôte `.localhost` reste accepté en plus de la surcharge
// d'environnement : sans ça, brancher un espace sur un tunnel pour le tester
// au téléphone le rendrait injoignable depuis le PC, et il faudrait rebasculer
// la configuration (donc rebuilder) à chaque aller-retour. Les trois espaces
// restent ainsi testables en local en permanence, tunnel branché ou non.
const SPACE_HOSTS_ACCEPTES: Record<SessionSpace, string[]> = Object.fromEntries(
  SESSION_SPACES.map((s) => [
    s,
    process.env.NODE_ENV === 'production'
      ? [SPACE_HOSTS[s]]
      : [...new Set([SPACE_HOSTS[s], SPACE_HOSTS_DEV[s]])],
  ])
) as Record<SessionSpace, string[]>;

// Nom de domaine ENREGISTRABLE d'un hôte — la partie qu'on achète, et celle
// qui décide si deux hôtes sont *same-site* pour le navigateur.
//
// Approximation assumée de la Public Suffix List : on prend les deux dernières
// étiquettes, trois quand l'avant-dernière est un suffixe de second niveau
// courant (`exemple.co.ma` et non `co.ma`). La vraie PSL est une liste de
// plusieurs milliers d'entrées mise à jour en continu ; l'embarquer pour un
// contrôle de démarrage serait disproportionné. Conséquence à connaître : sur
// un suffixe exotique absent de la liste ci-dessous, la fonction renvoie une
// racine trop courte, donc le contrôle est trop STRICT (faux positif possible,
// jamais de faux négatif) — il refuse de démarrer et affiche les deux hôtes,
// ce qui se diagnostique en un coup d'œil.
const SUFFIXES_SECOND_NIVEAU = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne']);

export function racineEnregistrable(host: string): string {
  const nom = host.split(':')[0].trim().toLowerCase();
  const etiquettes = nom.split('.').filter(Boolean);
  if (etiquettes.length <= 2) return etiquettes.join('.');
  const avantDernier = etiquettes[etiquettes.length - 2];
  const taille = SUFFIXES_SECOND_NIVEAU.has(avantDernier) ? 3 : 2;
  return etiquettes.slice(-taille).join('.');
}

// Les noms en `.localhost` sont exemptés du contrôle de racines distinctes
// ci-dessous : les trois hôtes de développement SONT frères sous `.localhost`
// (cf. SPACE_HOSTS_DEV), et un build de production lancé en local ne doit pas
// buter dessus.
//
// L'exemption est explicite bien qu'aujourd'hui redondante : `localhost` n'est
// pas un suffixe reconnu par racineEnregistrable, qui voit donc dans
// `admin.localhost` et `marchand.localhost` deux racines distinctes. Elle dit
// l'intention plutôt qu'elle ne fait le travail — et garantit que le jour où
// ce calcul évoluera, il ne fera pas échouer le démarrage en local.
function estHoteLocal(host: string): boolean {
  const nom = host.split(':')[0].toLowerCase();
  return nom === 'localhost' || nom.endsWith('.localhost');
}

// Vérifié une fois, pas à chaque requête : `assertSpaceHostsConfigured` est
// appelé en tête du proxy, donc sur tout le trafic.
let hotesVerifies = false;

// Deux garde-fous de démarrage, en production uniquement.
//
//   1. Un hôte non configuré ferait tomber tous les espaces sur les valeurs
//      `.localhost` : plus aucune requête réelle ne matcherait et l'app
//      répondrait 404 partout.
//   2. Deux espaces qui partagent un domaine ENREGISTRABLE seraient
//      *same-site* l'un pour l'autre, et toute la séparation documentée en
//      tête de ce fichier s'effondrerait en silence — le routage continuerait
//      de fonctionner, seules les propriétés de sécurité disparaîtraient.
//      C'est exactement le genre de régression qu'une relecture ne voit pas :
//      elle ne tient qu'à trois chaînes de caractères dans un fichier
//      d'environnement.
//
// On échoue explicitement au premier passage dans le proxy plutôt que de
// laisser diagnostiquer ça en aveugle.
export function assertSpaceHostsConfigured(): void {
  if (process.env.NODE_ENV !== 'production' || hotesVerifies) return;

  const manquants = SESSION_SPACES.filter((s) => !SPACE_HOSTS_ENV[s]);
  if (manquants.length > 0) {
    throw new Error(
      `Hôtes d'espace non configurés : ${manquants
        .map((s) => `NEXT_PUBLIC_HOST_${s.toUpperCase()}`)
        .join(', ')}`
    );
  }

  const parRacine = new Map<string, SessionSpace[]>();
  for (const s of SESSION_SPACES) {
    if (estHoteLocal(SPACE_HOSTS[s])) continue;
    const racine = racineEnregistrable(SPACE_HOSTS[s]);
    parRacine.set(racine, [...(parRacine.get(racine) ?? []), s]);
  }

  const partagees = [...parRacine].filter(([, espaces]) => espaces.length > 1);
  if (partagees.length > 0) {
    const detail = partagees
      .map(([racine, espaces]) => `${espaces.map((s) => SPACE_HOSTS[s]).join(' et ')} partagent « ${racine} »`)
      .join(' ; ');
    throw new Error(
      `Espaces sur un domaine racine commun : ${detail}. ` +
        'Chaque espace doit avoir son propre domaine enregistrable, sans quoi ils sont same-site ' +
        "et l'isolation décrite dans lib/spaces.ts ne tient plus."
    );
  }

  hotesVerifies = true;
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
// `Secure`. Le cookie est donc strictement lié à l'hôte exact qui l'a posé.
//
// Les trois espaces vivant sur trois racines distinctes, aucun n'a de frère à
// craindre : ce préfixe ne défend plus contre un sous-domaine voisin
// compromis, il défend contre un sous-domaine que l'on ajouterait plus tard
// SOUS l'une des racines (un `cdn.` ou un `status.` suffirait à rendre le
// "cookie tossing" possible s'il portait un `Domain`). C'est précisément le
// genre de garde-fou qu'on garde en place justement parce qu'il ne coûte rien
// tant qu'il ne sert pas. Désactivé hors production, où `Secure` n'est pas
// garanti selon la façon dont on sert l'app en local.
const COOKIE_PREFIX = process.env.NODE_ENV === 'production' ? '__Host-' : '';

export const SESSION_COOKIE_NAMES: Record<SessionSpace, string> = {
  admin: `${COOKIE_PREFIX}pd_session_admin`,
  marchand: `${COOKIE_PREFIX}pd_session_marchand`,
  terrain: `${COOKIE_PREFIX}pd_session_terrain`,
};

// Noms posés par les découpages PRÉCÉDENTS : cookie unique `pd_session`, puis
// un cookie par espace sans préfixe `__Host-`, puis le cookie propre à
// l'espace `planner` du temps où le planificateur avait son sous-domaine.
// Conservés uniquement pour les supprimer proprement chez les clients qui les
// ont encore — celui du Planner en particulier, sans quoi un planificateur
// déjà connecté garderait indéfiniment un cookie sur un domaine qui ne répond
// plus. Filtrés des noms courants, car hors production le préfixe est vide et
// les deux listes se recouvrent.
const LEGACY_NAMES = [
  'pd_session',
  'pd_session_admin',
  'pd_session_marchand',
  'pd_session_terrain',
  'pd_session_planner',
  '__Host-pd_session_planner',
];

export const LEGACY_SESSION_COOKIE_NAMES = LEGACY_NAMES.filter(
  (nom) => !SESSION_SPACES.some((s) => SESSION_COOKIE_NAMES[s] === nom)
);
