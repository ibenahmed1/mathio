# Isolation des rôles — implémentation et mesures complémentaires

Ce document décrit ce qui a été implémenté suite à la demande d'isolation des
droits par espace applicatif (cookies + middleware), ce qui a été vérifié en
conditions réelles (serveur de dev), et les gaps restants à traiter
séparément.

## 1. Constat de départ

- **Un seul cookie de session (`pd_session`) pour tous les rôles.** Un admin
  connecté dans un onglet et un test de connexion marchand dans un autre
  onglet du même navigateur se marchaient dessus : le second `login` écrasait
  le cookie du premier (même nom, même `path`), déconnectant silencieusement
  la première session.
- **`proxy.ts` (le middleware) ne protégeait que `/api/**`.** Les pages
  (`/admin/**`, `/marchand/**`, `/ramasseur/**`) n'étaient protégées que si le
  `layout.tsx` de la section le faisait lui-même.
- **`app/marchand/layout.tsx` était un composant 100% client, sans aucune
  vérification serveur.** N'importe quel visiteur (même non connecté) pouvait
  voir l'interface marchand se charger.
- **`app/ramasseur/page.tsx` n'avait ni layout ni vérification de session du
  tout.** Aucune protection serveur.
- Les routes `/api/**`, elles, étaient déjà protégées finement route par route
  via `requireUser(['role', ...])` — ce point-là était déjà solide.

## 2. Ce qui a été implémenté

### a) Isolation des cookies par espace applicatif

Trois cookies distincts remplacent l'unique `pd_session`, regroupés par
espace fonctionnel plutôt que par rôle technique brut :

| Cookie | Espace | Rôles |
|---|---|---|
| `pd_session_admin` | back-office | `admin`, `finance`, `sav`, `agent_confirmation` |
| `pd_session_marchand` | portail marchand | `marchand` |
| `pd_session_terrain` | terrain / mobile | `ramasseur`, `livreur` |

Fichier central : `lib/auth.ts`. `getSessionCookieName(role)` détermine le bon
cookie à l'écriture (login) ; `getPageSession(space)` et
`resolveApiSession(...)` déterminent le bon cookie à la lecture.

Le cookie back-office (`pd_session_admin`) est en plus posé en
`sameSite: 'strict'` (les autres restent en `lax`, nécessaire car un marchand
peut arriver via un lien externe SMS/email) : il n'a jamais besoin d'être
envoyé sur une navigation cross-site, donc autant fermer cette surface CSRF
résiduelle pour l'espace le plus sensible.

**Vérifié en conditions réelles** (contre le serveur de dev, comptes du seed) :
connexion admin puis connexion marchand *dans le même cookie jar* → les deux
cookies coexistent, `/admin` et `/marchand` restent tous les deux accessibles
avec leur propre session. Avant le correctif, la seconde connexion aurait
effacé la première.

### b) Contrôle d'accès strict dans `proxy.ts` (le middleware Next.js)

Cette version de Next.js a renommé `middleware.ts` en `proxy.ts` (vérifié dans
`node_modules/next/dist/docs/.../proxy.md` avant toute modification, comme
demandé par `AGENTS.md`).

`proxy.ts` couvre maintenant, via son `matcher` :
`/api/:path*`, `/admin/:path*`, `/marchand/:path*`, `/ramasseur/:path*`, `/login`.

Pour chaque page protégée, le proxy :
1. lit le cookie de l'espace correspondant (jamais un autre),
2. vérifie la signature du JWT,
3. vérifie que le **rôle contenu dans le token** correspond exactement au rôle
   autorisé pour cette section (`admin` → rôle `admin` uniquement, `marchand`
   → rôle `marchand`, `ramasseur` → rôle `ramasseur`),
4. sinon → redirection vers `/login`.

Bonus : visiter `/login` alors qu'une session valide existe déjà pour un
espace redirige directement vers cet espace (évite qu'une reconnexion
« accidentelle » ne vienne semer la confusion).

**Vérifié** :
- `/admin` sans cookie → 307 vers `/login`
- avec le cookie admin → 200 sur `/admin`
- avec le cookie admin sur `/marchand` → 307 vers `/login` (mauvais rôle)
- avec le cookie admin sur `/login` → 307 vers `/admin`

Pour `/api/**`, comme plusieurs sessions peuvent désormais coexister dans le
même navigateur, `lib/api-client.ts` (le client fetch partagé par tout le
front) ajoute automatiquement un header `x-pd-space` déduit de l'URL de la
page courante (`/admin` → `admin`, `/marchand` → `marchand`, `/ramasseur` →
`terrain`). Le proxy s'en sert comme *indice de routage* pour choisir quel
cookie vérifier en priorité — jamais comme preuve d'autorité : seule la
signature du JWT du cookie réellement présent fait foi. L'autorisation fine
par rôle continue d'être faite route par route via `requireUser(['role'])`
(`lib/api-utils.ts`), inchangé.

**Vérifié** : `GET /api/auth/me` avec `x-pd-space: admin` renvoie le compte
admin, avec `x-pd-space: marchand` renvoie le compte marchand, dans le même
cookie jar contenant les deux sessions.

### c) Déconnexion ciblée par espace

`POST /api/auth/logout` lit désormais `x-pd-space` : il ne supprime que le
cookie de l'espace d'où vient la requête. Se déconnecter depuis l'onglet
marchand ne coupe plus une session admin active dans un autre onglet. Si le
header est absent/inconnu, les trois cookies sont effacés par prudence
(repli sûr).

**Vérifié** : logout avec `x-pd-space: marchand` dans un jar contenant les
deux sessions → seule la session marchand est coupée, la session admin reste
valide.

### d) Comblement de deux trous de sécurité réels trouvés en auditant

Ces deux points ne sont pas liés à l'isolation des cookies en soi, mais sont
apparus pendant l'audit et relèvent du même objectif (« ne jamais se fier au
front-end pour bloquer une page ») :

- **`app/marchand/layout.tsx`** était un composant client sans aucune
  vérification serveur. Scindé en `app/marchand/MarchandShell.tsx` (le rendu,
  toujours client) + `app/marchand/layout.tsx` (Server Component qui vérifie
  `getPageSession('marchand')` + `role === 'marchand'` avant tout rendu, même
  modèle que `app/admin/layout.tsx`).
- **`app/ramasseur/layout.tsx`** n'existait pas du tout : la page se rendait
  sans aucun contrôle serveur. Créé avec la même vérification stricte.

Redondant avec la protection ajoutée dans `proxy.ts` (défense en profondeur),
et surtout indispensable pour les **Server Actions**, qui ne passent pas par
le proxy (confirmé par un commentaire déjà présent dans
`app/marchand/bons-livraison/actions.ts`, et par la documentation Next.js :
*« Always verify authentication and authorization inside each Server Function
rather than relying on Proxy alone »*).

## 3. Vérifications effectuées

`npx tsc --noEmit` → aucune erreur. `npx next build` → build complet réussi,
`Proxy (Middleware)` bien enregistré. Puis tests fonctionnels via `curl`
contre le serveur de dev réel (comptes du seed `prisma/seed.ts`) :

- accès non authentifié à `/admin` et `/ramasseur` → redirigés vers `/login`
- login admin → cookie `pd_session_admin` uniquement (plus de `pd_session`)
- login marchand *dans le même cookie jar* que l'admin → les deux cookies
  coexistent, les deux espaces restent accessibles
- cookie admin sur `/marchand` → redirigé (mauvais rôle)
- cookie admin sur `/login` → redirigé vers `/admin`
- `x-pd-space` sélectionne la bonne session pour `/api/auth/me`
- logout scopé par `x-pd-space` ne coupe que la session ciblée
- login ramasseur → cookie `pd_session_terrain`, `/ramasseur` accessible,
  refusé pour le cookie admin

## 4. Fichiers modifiés / créés

| Fichier | Changement |
|---|---|
| `lib/auth.ts` | cookies par espace, `getSessionCookieName`, `getSessionSpace`, `getPageSession(space)`, `resolveApiSession` |
| `proxy.ts` | garde stricte par page (rôle + cookie), résolution de session par indice d'espace pour `/api/**` |
| `app/api/auth/login/route.ts` | pose le cookie du bon espace, `sameSite: strict` pour l'admin, nettoie l'ancien cookie |
| `app/api/auth/logout/route.ts` | déconnexion ciblée par `x-pd-space` |
| `lib/api-client.ts` | ajoute automatiquement `x-pd-space` à chaque appel `/api/**` |
| `app/admin/layout.tsx` | lit explicitement l'espace `admin` |
| `app/marchand/layout.tsx` (+ nouveau `MarchandShell.tsx`) | ajoute la vérification serveur manquante |
| `app/ramasseur/layout.tsx` | nouveau — protection serveur manquante |
| `app/marchand/bons-livraison/nouveau/page.tsx`, `actions.ts` | lisent explicitement l'espace `marchand` |

## 5. Mesures complémentaires ajoutées

- Suppression automatique de l'ancien cookie `pd_session` à chaque login et
  logout, pour une migration propre des sessions déjà ouvertes sans exiger de
  déconnexion manuelle de tous les utilisateurs.
- `sameSite: 'strict'` sur le cookie back-office — durcissement CSRF ciblé
  sur l'espace le plus sensible, sans casser les cas d'usage marchand (liens
  externes).

## 6. Recommandations non implémentées (hors périmètre "cookies + proxy")

À évaluer séparément :

1. **Séparation par sous-domaines** (`admin.`, `seller.`/`marchand.`, domaine
   racine pour le client) — qualifiée d'« optionnelle » dans la demande
   initiale. Apporte une isolation supplémentaire au niveau du navigateur
   (storage, cookies scoping natif) mais demande une infra DNS/hébergement
   dédiée ; non traitée ici car hors du code applicatif.
2. **Rate limiting sur `/api/auth/login`** : rien n'empêche aujourd'hui le
   brute-force du téléphone/PIN (les PIN à 4 chiffres des rôles terrain sont
   particulièrement faibles). À ajouter (compteur par IP/téléphone, verrou
   temporaire après N échecs).
3. **Écart pré-existant, indépendant de ce travail** : la page de connexion
   redirige les rôles `finance`, `sav` et `agent_confirmation` vers
   `/admin/commandes`, mais `app/admin/layout.tsx` n'autorise strictement que
   `role === 'admin'` — ces rôles se retrouvent donc renvoyés vers `/login`
   sans jamais accéder à une page. Semble être une fonctionnalité non
   terminée plutôt qu'un choix délibéré ; à clarifier avant d'élargir l'accès
   à `/admin` pour ces rôles (non modifié pour ne pas changer une règle
   métier sans validation).
4. **En-têtes de sécurité génériques** (`X-Frame-Options`,
   `X-Content-Type-Options`, CSP) — utiles mais orthogonaux à l'objectif
   « confusion de droits » ; à traiter dans une passe dédiée si souhaité.
