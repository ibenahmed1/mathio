# Gestion des utilisateurs, rôles, statuts et permissions — Mathio Delivery

Ce document explique en détail comment le système gère la création des comptes, l'attribution des rôles, les statuts de profils et le contrôle des permissions. Il s'appuie sur le code réel du projet (`prisma/schema.prisma`, `lib/auth.ts`, `proxy.ts`, routes `app/api/...`).

---

## 1. Vue d'ensemble de l'architecture

Il n'y a **pas** de système RBAC dynamique (pas de tables `Role` / `Permission` en base de données). Les rôles sont un **enum Prisma figé dans le schéma**, et les permissions sont codées « en dur » dans chaque route API sous forme de listes de rôles autorisés. C'est un choix simple et explicite, adapté à un nombre de rôles limité et stable.

L'authentification est **custom** (pas de NextAuth/Clerk) : elle repose sur des **JWT signés** (librairie `jose`) stockés dans des cookies `httpOnly`, avec un mot de passe hashé via `bcryptjs`.

---

## 2. Modèle de données

### 2.1 Enum `Role` (`prisma/schema.prisma:26-41`)

```
admin, superviseur, moderateur, equipe_suivi, responsable,
marchand, livreur, ramasseur, design, gestionnaire_hub
```

Ce jeu de rôles a remplacé un ancien jeu (`finance`, `sav`, `agent_confirmation`) via la migration `20260804125756_refonte_roles_equipe_et_tarifs_ville`.

Les rôles `design` et `gestionnaire_hub` sont réservés à l'outil interne de gestion de tâches (Kanban, `/admin/tasks`) et n'ont accès à rien d'autre côté admin.

### 2.2 Modèle `Utilisateur` (table `utilisateurs`, `prisma/schema.prisma:188-247`)

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `nomComplet` | String | colonne `nom_complet` |
| `telephone` | String, nullable, **unique** | identifiant de connexion principal |
| `email` | String, nullable, **unique** | identifiant alternatif |
| `motDePasseHash` | String | hash bcrypt |
| `role` | `Role` | voir §2.1 |
| `actif` | Boolean, défaut `true` | active/désactive le compte (login refusé si `false`) |
| `dateCreation` | DateTime, défaut `now()` | |
| `derniereConnexion` | DateTime, nullable | mise à jour à chaque login réussi |
| `resetTokenHash` | String, nullable, unique | hash SHA-256 du token de réinitialisation |
| `resetTokenExpire` | DateTime, nullable | expiration du token (30 min) |
| `cin`, `photoUrl`, `zonePrincipale`, `zoneSecondaire`, `adresse` | nullable | champs terrain (livreur/ramasseur) |
| `nomBanque`, `numeroCompte`, `ribPhotoUrl` | nullable | coordonnées bancaires terrain |
| `fraisLivraison`, `fraisRefus` | Decimal(10,2), nullable | frais par défaut du livreur/ramasseur |
| `cinRectoUrl`, `cinVersoUrl` | nullable | pièces justificatives |

Il n'existe **pas** de table `Session` ou `Account` séparée : la session vit uniquement dans le JWT côté cookie (rien n'est persisté côté serveur pour la session elle-même).

### 2.3 Modèle `Marchand` (table `marchands`, `prisma/schema.prisma:249-290`)

Relation 1-1 avec `Utilisateur` (`utilisateurId` unique).

- `typeCompte` — enum `TypeCompteMarchand` : `marchand | entreprise | dropshipping` (défaut `marchand`)
- `statut` — enum `StatutMarchand` : `en_attente_validation | actif | suspendu` (défaut `en_attente_validation`)
- Champs d'inscription : `nomBoutique`, `raisonSociale`, `iceRc`, `ville`, `rib`, `cin`, `siteWeb`, `adresse`, `nomBanque`, `ribPhotoUrl`, `villeRamassage`, `registreCommerce`
- Champs ramassage récurrent : `ramassageRecurrentActif`, `ramassageJours`, `ramassageCreneauHoraire`

### 2.4 Modèle `MarchandMembre` (table `marchand_membres`, `prisma/schema.prisma:298-308`)

Permet à un marchand titulaire d'inviter des employés. Ces membres sont créés comme `Utilisateur` avec `role = 'marchand'` et ont un accès **total** à la boutique du titulaire (pas de permissions fines par membre — voir `lib/marchand-scope.ts`).

### 2.5 Autres enums liés

- `EquipeTache` / `EquipeTacheMembre` (`prisma/schema.prisma:695-725`) : pôles internes (dev, admin, gestionnaire hub) pour le Kanban, un utilisateur peut être rattaché à plusieurs équipes.
- `TarifLivreurVille` (`prisma/schema.prisma:674-686`) : surcharge des frais de livraison/refus par ville pour un livreur donné.

---

## 3. Création des utilisateurs

Tous les mots de passe sont hashés avec **bcrypt** (coût 10) via `hashSecret()` (`lib/auth.ts:86-88`). Il existe trois parcours de création distincts.

### 3.1 Création par un admin — comptes « équipe »

`POST /api/utilisateurs` (`app/api/utilisateurs/route.ts:85-187`)

- Protégée par `requireUser(['admin'])` — seul un admin peut créer un compte équipe.
- Rôles créables (`ROLES_EQUIPE`) : `superviseur, moderateur, equipe_suivi, responsable, ramasseur, livreur, design, gestionnaire_hub`.
  - `admin` et `marchand` sont **exclus** de cette route (aucune route ne permet de créer un `admin` via l'API — probablement fait via `prisma/seed.ts`).
- Rôles « terrain » (`ROLES_TERRAIN = ['ramasseur', 'livreur']`) : email et CIN obligatoires.
- Rôles avec photo obligatoire (`ROLES_AVEC_PHOTO = ['ramasseur', 'livreur', 'moderateur']`).
- Mot de passe saisi manuellement par l'admin (champ `secret` + confirmation `confirmSecret`), minimum 4 caractères — **jamais généré automatiquement**.
- Vérification d'unicité du `telephone` (obligatoire) avant création ; `email` optionnel mais unique s'il est fourni.
- Le compte est créé directement avec `actif: true`.

### 3.2 Auto-inscription marchand

`POST /api/marchands/inscription` (`app/api/marchands/inscription/route.ts`) — route **publique**, listée dans `PUBLIC_API_PATHS` (`proxy.ts:17-22`), accessible sans session.

- Validations :
  - email par regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
  - mot de passe ≥ 4 caractères
  - RIB par regex `/^\d{24}$/` (24 chiffres exacts)
- Champs requis : `nomComplet`, `cin`, `nomBoutique`, `telephone`, `email`, `ville`, `adresse`, `rib`, `ribPhotoUrl`.
- Exécuté dans une **transaction Prisma** :
  1. crée `Utilisateur` avec `role: 'marchand'` et **`actif: false`**
  2. crée `Marchand` avec **`statut: 'en_attente_validation'`**
- Réponse : « Compte créé, en attente de validation par un administrateur. »
- Le compte ne peut pas se connecter tant qu'un admin ne l'a pas validé (voir §5).

### 3.3 Invitation d'un membre d'équipe marchand

`POST /api/marchands/membres` (`app/api/marchands/membres/route.ts:36-77`) — réservée au titulaire du compte marchand (`requireUser(['marchand'])` + résolution via `getOwnedMarchand`).

- Email + mot de passe ≥ 6 caractères.
- Créé avec `role: 'marchand'` et `actif: true` immédiatement (pas de validation admin, car rattaché à un marchand déjà validé).

---

## 4. Gestion des rôles

### 4.1 Espaces applicatifs (`ROLE_SPACES`, `lib/auth.ts:44-55`)

Les rôles sont regroupés en trois « espaces » qui déterminent quel cookie de session est utilisé et quelles pages sont accessibles :

| Espace | Rôles |
|---|---|
| `admin` | `admin, superviseur, moderateur, equipe_suivi, responsable, design, gestionnaire_hub` |
| `marchand` | `marchand` |
| `terrain` | `livreur, ramasseur` |

Sous-groupes utiles :
- `ROLES_BACKOFFICE` (`lib/auth.ts:36`) = `[admin, superviseur, moderateur, equipe_suivi, responsable]` — accès complet au back-office.
- `ROLES_KANBAN_UNIQUEMENT` (`lib/auth.ts:42`) = `[design, gestionnaire_hub]` — confinés à `/admin/tasks` uniquement.

### 4.2 Attribution et modification

- **À la création** : voir §3.1 (uniquement par un admin, rôles limités à `ROLES_EQUIPE`).
- **Modification** : `PATCH /api/utilisateurs/[id]` (`app/api/utilisateurs/[id]/route.ts:27-135`), réservé admin. Si le rôle change vers un rôle non-terrain, les champs terrain (`cin`, `zonePrincipale`, `fraisLivraison`, etc.) sont automatiquement réinitialisés à `null`.
- **Suppression** : `DELETE /api/utilisateurs/[id]` — interdiction de s'auto-supprimer, réservé aux `ROLES_EQUIPE`. Si le compte a des colis/ramassages liés, l'erreur Prisma `P2003` (contrainte de clé étrangère) est interceptée pour suggérer une désactivation (`actif: false`) plutôt qu'une suppression définitive.

### 4.3 Vérification fine par action métier

Chaque route API sensible définit sa propre liste de rôles autorisés selon le contexte métier. Exemple : le changement de statut d'un colis (`app/api/commandes/[id]/statut/route.ts:13`) est limité à `ROLES_AUTORISES = ['admin', 'superviseur', 'equipe_suivi', 'livreur', 'moderateur']`.

Il n'y a pas de table de permissions centralisée : chaque endpoint documente et applique lui-même sa règle d'accès via `requireUser([...])`.

---

## 5. Statuts des profils

Trois notions de statut coexistent, à ne pas confondre :

### 5.1 `Utilisateur.actif` (Boolean)

Statut générique de désactivation, applicable à **tout type de compte**. Changé via :
`PATCH /api/utilisateurs/[id]/actif` (`app/api/utilisateurs/[id]/actif/route.ts`), réservé admin.

### 5.2 `Marchand.statut` (enum `StatutMarchand`)

Cycle de vie propre au compte marchand :

```
en_attente_validation → actif → suspendu
```

Changé via `PATCH /api/marchands/[id]/statut` (`app/api/marchands/[id]/statut/route.ts`), réservé admin.

**Point important — synchronisation automatique** : cette route met à jour `Marchand.statut` **et** `Utilisateur.actif` dans une même transaction (`Utilisateur.actif = (statut === 'actif')`). Cela empêche un marchand non validé (ou suspendu) de se connecter, sans avoir à gérer deux champs séparément côté front.

### 5.3 Impact sur la connexion

`POST /api/auth/login` refuse tout compte avec `actif = false`, avec le **même message générique** que pour un mot de passe erroné (`INVALID_CREDENTIALS_MESSAGE`, `app/api/auth/login/route.ts:15,35-37`). C'est volontaire : cela évite de révéler à un attaquant si un compte existe mais est désactivé/suspendu (règle de sécurité RG-12 documentée dans le code).

### 5.4 Ce qui n'existe pas

Il n'y a pas de statut « banni » distinct, ni de statut « en attente » générique pour les comptes équipe — seul le booléen `actif` s'applique à eux. Le cycle `en_attente_validation / actif / suspendu` est **exclusif aux marchands**.

---

## 6. Authentification

Système **custom** basé sur JWT (bibliothèque `jose`), entièrement défini dans `lib/auth.ts`.

- **Hash mot de passe** : `bcryptjs`.
- **Secret JWT** : `process.env.AUTH_SECRET` (erreur levée au démarrage si absent).
- **Session** : JWT signé `HS256`, payload `{ sub: userId, role }`, durée de vie 7 jours (`SESSION_MAX_AGE_SECONDS`).
- **Isolation multi-espaces** : trois cookies distincts selon le rôle —
  - `pd_session_admin`
  - `pd_session_marchand`
  - `pd_session_terrain`

  Cela permet à un même navigateur d'avoir plusieurs sessions actives simultanément (ex. un admin ouvre un onglet marchand en impersonation sans perdre sa session admin). L'ancien cookie unique `pd_session` (`LEGACY_SESSION_COOKIE_NAME`) est supprimé au login suivant s'il traîne encore.

- **Attributs cookie** : `httpOnly: true`, `secure` en production. `sameSite: 'strict'` pour l'espace admin (jamais exposé par lien externe), `sameSite: 'lax'` pour les autres espaces.

### 6.1 Connexion

`POST /api/auth/login` — l'identifiant peut être `telephone` **ou** `email` (résolu par une clause `OR`). Le mot de passe est comparé via `verifySecret()` (bcrypt). En cas de succès : mise à jour de `derniereConnexion`, signature du JWT, pose du cookie correspondant à l'espace du rôle.

### 6.2 Déconnexion

`app/api/auth/logout/route.ts` — supprime le cookie de session.

### 6.3 Session courante

`GET /api/auth/me` (`app/api/auth/me/route.ts`) — `requireUser()` sans restriction de rôle, renvoie le profil de l'utilisateur connecté et son `Marchand` associé le cas échéant.

### 6.4 Réinitialisation de mot de passe (self-service)

Circuit complet :
1. `POST /api/auth/mot-de-passe-oublie` — génère un token aléatoire de 32 octets (`randomBytes`), stocké en base **uniquement sous forme de hash SHA-256** (`resetTokenHash`), avec une expiration de 30 minutes (`RESET_TOKEN_TTL_MS`). Le token en clair est envoyé par email via `lib/mailer.ts`.
2. `POST /api/auth/reinitialiser-mot-de-passe` — vérifie le token, applique le nouveau mot de passe.

Message de réponse générique dans tous les cas (compte existant ou non) pour ne pas divulguer l'existence d'un compte.

### 6.5 Réinitialisation par un admin

`POST /api/utilisateurs/[id]/reinitialiser-mot-de-passe` — l'admin fixe lui-même le nouveau mot de passe (≥ 4 caractères + confirmation), sans génération aléatoire ni envoi d'email.

---

## 7. Contrôle des permissions (protection des routes)

Le contrôle d'accès se fait à **deux niveaux** : un middleware global, puis une revérification dans chaque route/layout.

### 7.1 Middleware (`proxy.ts`)

Fait office de middleware Next.js (`export const config = { matcher: [...] }`), couvre `/api/:path*`, `/admin/:path*`, `/marchand/:path*`, `/ramasseur/:path*`.

- **Pages** : `PAGE_GUARDS` (`proxy.ts:34-42`) associe chaque préfixe d'URL à un `cookieSpace` (admin/marchand/terrain) et une liste `allowedRoles`. Le middleware vérifie la signature du JWT et le rôle avant de laisser passer ; sinon redirection vers `/login`. Restriction additionnelle : les rôles `ROLES_KANBAN_UNIQUEMENT` ne peuvent accéder qu'à `/admin/tasks` (`proxy.ts:84-90`), même s'ils passent la vérification d'espace `admin`.
- **API** : chemins publics whitelistés dans `PUBLIC_API_PATHS` (`proxy.ts:17-22`) : login, inscription marchand, mot de passe oublié/réinitialisation. Toute autre route API sans session valide reçoit un **401**.
- Le proxy pose ensuite deux headers internes lus par les route handlers : `x-pd-user-id` et `x-pd-user-role`.

### 7.2 Vérification dans chaque route API

`lib/api-utils.ts:25-34`, fonction `requireUser(allowedRoles?)` :
- relit les headers posés par le proxy via `getSessionUser()` (`lib/auth.ts:123-129`)
- lève une `ApiError(401)` si aucune session
- lève une `ApiError(403)` si le rôle de l'utilisateur n'est pas dans `allowedRoles`

Cette fonction est appelée en première ligne de quasiment toutes les routes API sensibles (`requireUser(['admin'])`, `requireUser(['marchand'])`, `requireUser(ROLES_AUTORISES)`, etc.) — c'est le point central de contrôle des permissions par action.

### 7.3 Garde côté layout (Server Component)

`app/admin/layout.tsx:9-13` revérifie **indépendamment** la session via `getPageSession('admin')`, car les Server Actions ne transitent pas par le middleware `proxy.ts`. Redirection vers `/login` si le rôle n'appartient pas à `[...ROLES_BACKOFFICE, ...ROLES_KANBAN_UNIQUEMENT]`.

### 7.4 Portée des données marchand (scoping)

`lib/marchand-scope.ts` — `resolveMarchandForUser(utilisateurId)` résout, pour un utilisateur donné, soit le marchand titulaire, soit le marchand parent via `MarchandMembre`. Cela garantit que chaque route marchand ne renvoie/modifie que les données de la boutique de l'utilisateur connecté (isolation multi-tenant).

### 7.5 Impersonation (accès support admin → marchand)

`POST /api/marchands/[id]/impersonation` (`app/api/marchands/[id]/impersonation/route.ts`) :
- réservée `admin`
- émet une véritable session marchand (même mécanisme JWT que le login, **sans** vérifier de mot de passe), posée sur le cookie `pd_session_marchand`, sans toucher au cookie admin (grâce à l'isolation multi-cookies du §6)
- refusée si le marchand ciblé n'est pas `actif`
- traçabilité minimale : un simple `console.info`, pas de table d'audit dédiée

---

## 8. Résumé — ce qu'il faut retenir

- **Pas de RBAC dynamique** : rôles en dur (enum Prisma), permissions codées route par route via `requireUser([...])`.
- **10 rôles** répartis en 3 espaces de session isolés (admin / marchand / terrain), chacun avec son propre cookie JWT.
- **3 parcours de création** : admin crée un compte équipe (actif immédiatement) ; marchand s'auto-inscrit (inactif jusqu'à validation) ; titulaire marchand invite des membres (actif immédiatement, permissions héritées à 100%).
- **Statut binaire `actif`** pour tous les comptes + **cycle de vie dédié** (`en_attente_validation / actif / suspendu`) uniquement pour les marchands, synchronisé automatiquement avec `actif`.
- **Double contrôle d'accès** : middleware global (`proxy.ts`) + vérification dans chaque route/layout (`requireUser`, `getPageSession`), car les Server Actions ne passent pas par le middleware.
- **Sécurité** : mots de passe bcrypt, tokens de reset hashés SHA-256 à durée de vie courte, messages d'erreur génériques pour ne pas divulguer l'existence/l'état d'un compte, cookies `httpOnly` + `secure` + `sameSite`.
