# API Partenaires — sous-traitance sortante — spécification technique

Ce document spécifie l'**API Partenaires** de Mathio Delivery : l'interface
machine-à-machine qui permet de **sous-traiter** la livraison d'un colis à un
autre transporteur, et de recevoir en retour les statuts de ce colis.

**Le flux est à sens unique : nous sous-traitons, nous ne recevons pas.**
Aucun transporteur tiers ne crée de colis chez nous. Ce n'est pas une
simplification de rédaction mais une décision de périmètre — et elle retire du
modèle de données tout ce que le flux entrant exigeait (marchand-miroir,
colonnes supplémentaires sur `commandes`, endpoints de création). §1.4 note ce
qu'il faudrait rouvrir si la décision changeait.

Il s'appuie exclusivement sur le code réel du dépôt
(`prisma/schema.prisma`, `lib/auth.ts`, `lib/spaces.ts`, `proxy.ts`,
`lib/api-utils.ts`, `lib/rate-limit.ts`, `lib/codes.ts`, `lib/statuts.ts`,
`lib/parcel-serial.ts`, `lib/parcel-label.ts`, `lib/hub-envoi.ts`,
`app/api/commandes/**`) et n'introduit **aucune** modification de ce code :
ce qui suit est une spécification, pas une implémentation.

---

## Table des matières

1. [Objet, périmètre et vocabulaire](#1-objet-périmètre-et-vocabulaire)
2. [Points d'ancrage déjà présents dans le code](#2-points-dancrage-déjà-présents-dans-le-code)
3. [Architecture d'authentification machine — le point critique](#3-architecture-dauthentification-machine--le-point-critique)
4. [Modèle de données](#4-modèle-de-données)
5. [Le contrat de statuts publics](#5-le-contrat-de-statuts-publics)
6. [Le cycle de sous-traitance](#6-le-cycle-de-sous-traitance)
7. [Référence des endpoints](#7-référence-des-endpoints)
8. [Webhooks](#8-webhooks)
9. [Robustesse : idempotence, pagination, versionnement, quotas](#9-robustesse--idempotence-pagination-versionnement-quotas)
10. [Sécurité et cloisonnement](#10-sécurité-et-cloisonnement)
11. [Migrations impliquées](#11-migrations-impliquées)
12. [Variables d'environnement](#12-variables-denvironnement)
13. [Plan de mise en œuvre par lots](#13-plan-de-mise-en-œuvre-par-lots)
14. [Décisions à trancher](#14-décisions-à-trancher)

---

## 1. Objet, périmètre et vocabulaire

### 1.1 Le flux, en une table

| | |
|---|---|
| Qui crée le colis ? | **Mathio** (marchand réel, cf. `app/api/commandes/route.ts`) |
| Qui fait le dernier kilomètre ? | **Le partenaire** |
| Qui appelle qui **à la remise** ? | **Nous appelons** l'API du partenaire (adaptateur, §6.3) |
| Qui appelle qui **pour les statuts** ? | **Le partenaire nous pousse** ses statuts sur `api.<domaine>/v1` |
| Sens du COD | Le partenaire encaisse, **il nous doit** l'argent |
| Objet pivot | `LivraisonSousTraitee` (§4.5) |

Il y a donc **deux canaux HTTP de sens opposés**, à ne jamais confondre :

- **Sortant (nous → eux)** : la remise du colis. Code applicatif classique, un
  adaptateur par transporteur, aucune surface d'attaque nouvelle.
- **Entrant (eux → nous)** : le retour de statuts, la réconciliation COD, la
  déclaration de couverture. C'est **cette** surface qui justifie tout le §3
  (hôte dédié, clés d'API, quotas) — et elle est volontairement minuscule :
  quatre familles d'endpoints, une seule en écriture de statut.

### 1.2 Ce que le périmètre « sortant uniquement » retire

Par rapport à une API bidirectionnelle, disparaissent entièrement :

| Retiré | Pourquoi ce n'est plus nécessaire |
|---|---|
| Le **marchand-miroir** (un `Marchand` + `Utilisateur` technique par partenaire) | Il n'existait que pour rattacher les colis créés par un tiers |
| `Commande.partenaireOrigineId`, `Commande.estTest` | Aucun colis ne vient d'un partenaire ; **la table `commandes` n'est pas modifiée du tout** |
| L'enum `SensPartenariat` | Tous les partenaires ont le même sens |
| `POST /v1/colis`, `POST /v1/colis/lot`, `POST /v1/colis/{ref}/annulation` | Un tiers ne crée ni n'annule rien chez nous |
| `GET /v1/reseau/villes` exposant **notre** réseau | La couverture qui compte est la **leur** ; elle est déclarée par `PUT /v1/reseau/couverture` (§7.6) |
| `GET /v1/colis/{ref}/suivi` (historique projeté) | Après la remise, l'historique du colis est **le leur**. Avant la remise, il ne les regarde pas |

Le dernier point ferme une fuite **par construction** plutôt que par règle :
une API bidirectionnelle devait imposer une « compression des événements
consécutifs » pour ne pas révéler notre cadence d'appels
(`deuxieme_appel_pas_reponse`, `troisieme_appel_pas_reponse`…). En n'exposant
aucun historique, il n'y a plus rien à compresser — ni à oublier de
compresser.

**Le gain le plus important est que `commandes` n'est pas touchée.** C'est la
table la plus chaude et la plus référencée du schéma ; toute la
sous-traitance vit dans une table satellite (`livraisons_sous_traitees`), ce
qui rend le chantier réversible : abandonner l'API Partenaires reviendrait à
supprimer des tables, jamais à défaire des colonnes.

### 1.3 Vocabulaire

- **Partenaire** : une entreprise de transport tierce, identifiée par
  `PartenaireTransport`. AMANA (La Poste marocaine) en est le cas fondateur,
  cf. §2.1.
- **Remise** : l'acte de confier un colis à un partenaire. Crée une ligne
  `LivraisonSousTraitee` et déclenche l'appel sortant.
- **Référence externe** : le numéro de suivi attribué par le partenaire au
  colis qu'on lui confie. Stocké dans `LivraisonSousTraitee.referenceExterne`,
  c'est **la clé par laquelle le partenaire nous parle de ce colis** (§2.4).
- **Statut plateforme** (`platform_status`) : notre vision du colis, projetée
  depuis `Commande.statut` (§5.3).
- **Statut transporteur** (`carrier_status`) : ce que le partenaire nous a dit
  en dernier (§5.4). Les deux avancent en parallèle et ne se recouvrent pas —
  c'est délibéré (§5.6).
- **Espace applicatif** : au sens de `lib/spaces.ts` — un hôte, un cookie, une
  frontière d'autorisation. L'API Partenaires n'en est **pas** un (§3.3).

### 1.4 La porte laissée ouverte

Si le flux entrant devait être ouvert plus tard, rien de ce qui est spécifié
ici n'aurait à être défait. Il faudrait **ajouter** :

1. l'enum `SensPartenariat` et une colonne `sens` sur `partenaires_transport` ;
2. le marchand-miroir (`marchandMiroirId`) et son couple `Marchand` /
   `Utilisateur` inactif ;
3. `Commande.partenaireOrigineId` (nullable, sans backfill) ;
4. les scopes `colis_creation` / `colis_annulation` et leurs endpoints ;
5. la projection INTERNE → PUBLIC en sortie de webhook, qui existe déjà ici
   (§5.3) et servirait telle quelle.

Le point 3 est le seul qui touche `commandes`, et il reste une colonne
nullable à défaut — donc sans verrou long. **Le choix « sortant uniquement »
ne crée aucune dette envers un éventuel flux entrant.**

### 1.5 Hors périmètre

- Facturation / émission de factures : seule la **réconciliation COD** est
  couverte (§7.7). La facturation des frais de transport est une décision
  ouverte (D-6, §14).
- Tarification dynamique (quotation).
- Portail web self-service pour le partenaire : la gestion des clés se fait
  depuis `/admin/partenaires`, en back-office.

---

## 2. Points d'ancrage déjà présents dans le code

Cette spécification est volontairement **greffée** sur des mécanismes
existants plutôt que parallèle à eux.

### 2.1 `expedier_par_amana` / `en_retour_par_amana` : la sous-traitance est déjà anticipée

L'enum `StatutCommande` contient déjà deux valeurs qui décrivent exactement ce
flux, mais figées sur un transporteur unique :

```
expedier_par_amana      → "Expédier par AMANA"      (lib/statuts.ts)
en_retour_par_amana     → "En retour par AMANA"
```

**Décision de spécification : on ne crée PAS de nouvelles valeurs d'enum.** On
**généralise** les deux existantes :

- `expedier_par_amana` devient *« Remis à un transporteur partenaire »* ;
- `en_retour_par_amana` devient *« En retour par un transporteur partenaire »*.

Le nom du transporteur n'est plus porté par l'enum mais par la ligne
`LivraisonSousTraitee` du colis (`partenaire.nom`), et
`LABELS_STATUT_COMMANDE` (`lib/statuts.ts`) devient une **base** que l'UI
surcharge quand un partenaire est résolu (« Remis à AMANA », « Remis à
CTM Messagerie »…).

Justification du choix contre l'ajout de `expedie_par_partenaire` /
`en_retour_par_partenaire` :

1. Un `ALTER TYPE … ADD VALUE` est trivial, mais la **migration de données**
   ne l'est pas : il faudrait réécrire les lignes `commandes` **et**
   `historique_statuts_commande` (colonnes `ancien_statut` **et**
   `nouveau_statut`), et retrouver rétroactivement que ces colis-là étaient
   chez AMANA. Un `AuditLog` de reprise serait nécessaire.
2. Toutes les listes de `lib/statuts.ts` (`STATUTS_COMMANDE`,
   `STATUTS_NON_LIVRAISON`, `STATUTS_A_RELANCER`…) et tous les filtres UI
   devraient être audités pour ne pas oublier la nouvelle valeur — c'est
   précisément le genre de divergence que le commentaire d'en-tête de
   `lib/statuts.ts` cherche à éviter.
3. La sémantique **ne change pas** : « le colis n'est plus dans notre réseau,
   il est chez un transporteur tiers ». Seule l'identité du tiers change, et
   elle n'a jamais eu sa place dans un enum de statut.

En contrepartie, AMANA devient simplement **la première ligne** de la table
`partenaires_transport`, seedée par la migration (§11).

C'est l'ancrage le plus fort de toute la spécification : **aucune migration ne
touche `StatutCommande`.**

### 2.2 Rate limiting et audit sont déjà persistés

- `RateLimitEntry` + `checkRateLimit()` (`lib/rate-limit.ts`) : fenêtre fixe
  atomique en PostgreSQL, avec `retryAfterSeconds` **calculé côté Postgres**
  (le commentaire du fichier explique pourquoi : décalage de fuseau observé en
  recalculant côté Node). Le quota par clé d'API (§9.4) réutilise cette
  fonction **telle quelle**, avec une clé `api:<prefixe_cle>:<fenêtre>`.
- `AuditLog` : le commentaire du schéma annonce déjà qu'il est *« pensé pour
  être réutilisé par d'autres actions sensibles futures […] sans nouvelle
  table à chaque fois »*. Il porte les actes sensibles de l'API
  (création/rotation/révocation de clé, remise d'un colis, validation d'un
  relevé COD), moyennant une adaptation : `adminId` est aujourd'hui
  **non-nullable** et pointe sur `Utilisateur`, alors qu'un appel machine n'a
  pas d'utilisateur (§4.8).

### 2.3 L'étiquette est déjà générable sans colonne supplémentaire

`lib/parcel-label.ts` recalcule à la volée le numéro de série et le QR signé à
partir de `codeSuivi` + `ville` + `dateCreation`, via `lib/parcel-serial.ts`
(Feistel + checksum HMAC). `parcelIdFromCodeSuivi()` exige le format `PD-\d+`,
produit par `nextCodeSuivi()` (`lib/codes.ts`).

**Conséquence** : un colis remis à un partenaire garde son `codeSuivi` normal
(`PD-000123`) et son étiquette reste générable, QR anti-falsification compris,
**sans aucun code nouveau**. L'endpoint
`GET /v1/sous-traitance/{ref}/etiquette` (§7.5) n'est qu'une façade sur
`buildParcelLabel()`, ce qui permet au partenaire de **réimprimer notre
étiquette** sans jamais pouvoir en forger une (§10.4).

### 2.4 Ce qui n'est PLUS un ancrage — et où l'anti-doublon a migré

Une spécification bidirectionnelle s'appuierait sur deux mécanismes qui, ici,
**ne servent pas** :

- **`Commande.codeSuiviPartenaire`** et sa contrainte
  `@@unique([marchandId, codeSuiviPartenaire])` restent utilisés par l'import
  Excel marchand (`app/api/commandes/import/route.ts`, étape 2.5) et ne sont
  **pas touchés** par cette spécification. Ils servaient d'anti-doublon pour
  les colis créés par un tiers ; il n'y en a plus.
- **`SourceCommande.api`** (valeur d'enum déclarée mais jamais posée dans
  `app/api/**`) reste inutilisée. Elle était réservée aux colis créés par
  l'API ; il n'y en a plus. Aucune migration d'enum ici non plus.

L'anti-doublon dont l'API a réellement besoin est **l'inverse** : empêcher que
le partenaire nous attribue deux fois la même référence de suivi pour deux
colis différents. Il migre donc sur la table satellite :

```prisma
@@unique([partenaireId, referenceExterne], map: "livraisons_sous_traitees_partenaire_ref_key")
```

Le raisonnement du schéma existant se transpose **tel quel** : le
`NULL`-non-comparable de PostgreSQL fait qu'une ligne encore `a_transmettre`
(donc `referenceExterne = NULL`) ne bloque jamais une autre. La contrainte ne
mord qu'à partir du moment où une référence existe réellement, ce qui est
exactement le comportement voulu.

---

## 3. Architecture d'authentification machine — le point critique

Ce chapitre ne concerne que le **canal entrant** (le partenaire nous appelle).
L'appel sortant vers son API, lui, est du code applicatif ordinaire (§6.3).

### 3.1 Le problème

`proxy.ts` (§4, *API*) impose aujourd'hui, pour **toute** route `/api/**` :

```ts
const espacesPublics = PUBLIC_API_PATHS[pathname];
if (espacesPublics) { /* … */ }

const session = await verifySpaceCookie(request.cookies, space);
if (!session) {
  return NextResponse.json({ error: 'Authentification requise' }, { status: 401 });
}
```

Une requête machine porteuse d'un `Authorization: Bearer` mais **sans cookie**
reçoit donc un `401` avant d'atteindre le moindre handler. Et avant cela, deux
contrôles plus amont la bloquent déjà :

- **§1 — l'hôte détermine l'espace** : `spaceForHost()` renvoie `null` pour tout
  hôte non listé → `404` sans même lire les cookies ;
- **§2 — contrôle d'origine (CSRF)** : tout `POST`/`PATCH`/`DELETE` dont
  l'en-tête `Origin` ne vaut pas exactement l'origine de l'hôte servi reçoit un
  `403`. Un client machine (cURL, SDK serveur) **n'envoie pas d'`Origin`** :
  `origin === null !== origine` → `403` systématique.

Il y a donc **trois** blocages, pas un.

### 3.2 Les deux options

**Option A — branche d'authentification machine dans le proxy.** Ajouter un
préfixe (`/api/v1/partenaires/**`) traité avant la lecture du cookie, exempté
du contrôle d'`Origin`, sur les hôtes existants.

**Option B — un hôte dédié `api.<domaine-métier>`**, qui ne sert aucune page,
ne pose aucun cookie, et n'accepte que l'authentification par clé d'API.

### 3.3 Choix retenu : **Option B**, mais *un cinquième hôte, pas un cinquième espace*

**L'option A est rejetée** pour une raison précise, qui tient au raisonnement
déjà écrit dans `lib/spaces.ts` et `proxy.ts` :

> *« l'espace d'une requête n'est plus déduit d'un indice envoyé par le client
> […] mais du `Host` […] : c'est devenu une frontière d'autorisation, plus un
> simple aiguillage. »*

Sur un hôte qui pose des cookies de session, exempter un sous-arbre d'URL du
contrôle d'`Origin` **rouvre exactement le trou que ce contrôle a fermé**. Le
commentaire de `proxy.ts` §2 est explicite : *« les handlers font
`await request.json()` sans exiger un Content-Type JSON, donc une requête
"simple" (sans préflight CORS) passerait autrement »*. Sur `marchand.example.ma`,
un `/api/v1/partenaires/**` sans contrôle d'`Origin` devient une cible CSRF
atteignable depuis n'importe quelle page tierce — d'autant que le navigateur y
joindrait **automatiquement** le cookie `__Host-pd_session_marchand`. Il
faudrait alors un garde-fou négatif (« si un cookie de session est présent sur
cette route, refuser »), c'est-à-dire une règle de sécurité par exception :
fragile, invisible, et contradictoire avec le modèle actuel.

L'hôte dédié résout le problème **structurellement** :

1. **Aucun cookie n'est jamais posé sur `api.…`** → il n'y a pas
   d'authentification ambiante → la CSRF est sans objet → l'exemption d'`Origin`
   devient *correcte par construction*, pas par exception. Un `Bearer` n'est
   jamais joint automatiquement par un navigateur.
2. **CORS est une politique distincte.** Si un partenaire branche un jour un
   tableau de bord côté navigateur, il lui faut un `Access-Control-Allow-Origin`
   ouvert ou liste-blanché ; les quatre hôtes actuels doivent au contraire
   rester en `Origin` strict. Deux politiques opposées ne peuvent pas cohabiter
   sur le même hôte sans logique par chemin.
3. **Séparation opérationnelle** : le back-office est *« filtrable par IP/VPN »*
   (`lib/spaces.ts`). L'API Partenaires, elle, doit être joignable depuis
   Internet, avec son propre WAF, sa propre courbe de quotas, ses propres
   journaux. Un hôte distinct rend ça configurable au reverse proxy, sans
   toucher au code.
4. **Le `404` de `spaceForHost()` reste la défense de premier rang** pour tout
   le reste : ajouter `api.…` n'ouvre rien d'autre.

**Nuance essentielle : ce n'est PAS un cinquième `SessionSpace`.** Ajouter
`'api'` à `SESSION_SPACES` polluerait mécaniquement six tables qui n'ont aucun
sens pour une machine : `SESSION_COOKIE_NAMES`, `SPACE_HOSTS`, `SPACE_ROLES`,
`SPACE_LOGIN_ROLES`, `HOME_SPACES`, `LEGACY_SESSION_COOKIE_NAMES`, et
introduirait une valeur d'`aud` JWT qui ne doit jamais être signée. La
résolution d'hôte doit donc être **élargie**, pas l'énumération d'espaces :

```ts
// lib/spaces.ts — ajout proposé, module toujours PUR (aucun import runtime)
export type HostKind =
  | { kind: 'espace'; space: SessionSpace }
  | { kind: 'api_partenaires' };

export function resolveHost(host: string | null | undefined): HostKind | null;
```

`spaceForHost()` reste inchangé et continue de renvoyer `null` pour l'hôte
API — ce qui garantit qu'aucun code existant (dont `getSessionUser()`,
`getPageSession()`, `verifySpaceCookie()`) ne peut accidentellement traiter une
requête API comme une session.

### 3.4 Flux de traitement dans `proxy.ts`

La branche s'insère **avant** le §1 actuel :

```
requête
  │
  ├─ resolveHost(Host) == null ──────────────────────────► 404
  │
  ├─ kind == 'api_partenaires'
  │     ├─ pathname ne commence pas par /v1/ ────────────► 404
  │     ├─ méthode OPTIONS ───────────────────────────────► préflight CORS
  │     ├─ PAS de contrôle d'Origin  (aucun cookie ici)
  │     ├─ PAS de lecture de cookie  (jamais posé ici)
  │     └─ NextResponse.next()  ── l'authentification par clé
  │           est faite dans le handler, pas dans le proxy (voir ci-dessous)
  │
  └─ kind == 'espace' ──────────────────────────► comportement actuel inchangé
```

**Pourquoi l'authentification n'est pas faite dans le proxy** — contrairement
aux sessions cookie : le proxy Next.js tourne sur le runtime Edge, alors que la
vérification d'une clé exige une lecture Prisma (`CleApiPartenaire` + statut du
partenaire + quota) que le reste du code fait déjà côté handler. Le pendant
exact de `requireUser()` (`lib/api-utils.ts`) est un nouvel helper :

```ts
// lib/partner-auth.ts (à créer) — même contrat que requireUser()
export async function requirePartenaire(
  scopes: ScopeApiPartenaire[]
): Promise<PartenaireContext>;   // lève ApiError(401 | 403 | 429)
```

`PartenaireContext` porte `{ partenaireId, cleId, scopes, environnement, versionEpinglee }`.
Comme `requireUser()`, il est appelé **dans chaque handler** — le commentaire de
`lib/api-utils.ts` dit déjà pourquoi : *« on revérifie ici pour que chaque
handler reste sûr indépendamment de la config de routage du middleware »*.

Les routes vivent donc sous `app/api/v1/**`, et le proxy garantit que ce
préfixe **n'est atteignable que depuis l'hôte API** (et réciproquement, que
l'hôte API n'atteint **que** ce préfixe). Une requête `/api/commandes` arrivant
sur `api.example.ma` reçoit `404`, comme une page `/marchand/colis` arrivant sur
le domaine ops aujourd'hui.

### 3.5 Format des clés d'API

```
mtk_live_a7f3c19e_9kQ2xR4pLm8vNc0dW1sZ6tYbH3jF5gA7uE2iO4rT8yK
└┬─┘ └┬─┘ └───┬──┘ └──────────────────┬──────────────────────┘
 │    │       │                       └─ secret : 32 octets aléatoires, base62 (43 car.)
 │    │       └─ préfixe public : 4 octets hex, INDEXÉ et UNIQUE → sert au lookup
 │    └─ environnement : live | test
 └─ marqueur produit, pour les scanners de secrets (GitHub, gitleaks)
```

**Stockage** : seul `SHA-256(secret)` est écrit en base, exactement comme les
tokens de réinitialisation et de handoff (`hashResetToken()` /
`hashHandoffToken()`, `lib/auth.ts`). Le secret complet n'est affiché **qu'une
fois**, à la création, dans `/admin/partenaires`.

**Pourquoi SHA-256 et pas bcrypt**, alors que `hashSecret()` (bcrypt coût 10)
existe déjà dans `lib/auth.ts` : bcrypt coût 10 ≈ 60–100 ms de CPU **par
requête**, ce qui est acceptable pour un login (quelques par jour et par
utilisateur) et rédhibitoire pour une API appelée en boucle. Le facteur de
travail de bcrypt sert à compenser la **faible entropie d'un mot de passe
humain** ; un secret de 256 bits tiré de `randomBytes` n'a pas ce défaut, et
SHA-256 sur une entrée à haute entropie n'est pas attaquable par dictionnaire.
C'est le raisonnement déjà appliqué aux tokens de reset (`randomBytes(32)` +
SHA-256), et cette spécification s'y aligne.

**Vérification** : lookup par `prefixe` (indexé, unique) puis comparaison du
hash en **temps constant** (`crypto.timingSafeEqual`, comme
`validateQrPayload()` dans `lib/parcel-serial.ts`). Sans le préfixe, il faudrait
scanner toute la table à chaque appel.

**En-tête accepté** : `Authorization: Bearer mtk_live_…` — standard, supporté
nativement par tous les SDK HTTP et par les proxys d'entreprise. Un en-tête
dédié (`X-Mathio-Api-Key`) serait accepté en **repli toléré** mais non
documenté, uniquement pour les clients qui réécrivent `Authorization`.

### 3.6 Rotation et révocation

Un partenaire peut avoir **au plus deux clés actives simultanément** — c'est ce
qui rend la rotation sans coupure possible :

```
J     : POST /admin/partenaires/{id}/cles  → clé B créée, clé A reste active
J→J+n : le partenaire déploie la clé B ; les deux fonctionnent
J+n   : clé A → expireLe = now()+7j (grâce), puis revoqueeLe
```

- `expireLe` : refus **doux** après échéance, avec en-tête
  `Mathio-Key-Deprecation: <ISO8601>` renvoyé sur chaque appel des 7 jours
  précédant l'expiration (visible dans les logs du partenaire).
- `revoqueeLe` : refus **dur**, immédiat, `401 invalid_api_key`. La ligne
  n'est jamais supprimée — `derniereUtilisationLe` et `nbAppels` restent
  exploitables pour l'analyse post-incident.
- Toute création / expiration / révocation écrit un `AuditLog`
  (`action = 'cle_api.creation' | 'cle_api.rotation' | 'cle_api.revocation'`).

---

## 4. Modèle de données

Blocs Prisma à ajouter à `prisma/schema.prisma`, dans le style du schéma
existant (`@map` en snake_case, commentaires en français, références `§ /chemin`).

**Aucun bloc existant n'est modifié**, à deux exceptions près, toutes deux non
destructives : `AuditLog` (§4.8) et l'ajout de relations inverses sur
`Commande`, `Ville` et `Transaction` (§4.9).

### 4.1 Enums

```prisma
// ============================================================
// API Partenaires (§ /admin/partenaires, § api.<domaine>/v1/**)
// ============================================================

// Cycle de vie du partenariat lui-même — distinct de l'état de ses clés
// (CleApiPartenaire.revoqueeLe). `suspendu` coupe l'API en 403 sans détruire
// les clés (litige COD en cours, incident qualité) et interdit toute nouvelle
// remise, sans toucher aux colis déjà chez le partenaire ; `archive` est
// l'état terminal, conservé pour l'historique.
enum StatutPartenaire {
  actif
  suspendu
  archive
}

// Capacités accordées à une clé d'API, une par verbe métier plutôt qu'un
// niveau global "lecture/écriture" : une clé de simple supervision côté
// partenaire n'a aucune raison de pouvoir déclarer un encaissement COD.
// Vérifiés par requirePartenaire() (lib/partner-auth.ts), pendant exact de
// requireUser() pour les sessions humaines (lib/api-utils.ts).
//
// Il n'existe AUCUN scope de création de colis : dans le périmètre "sortant
// uniquement", un partenaire ne crée rien chez nous (cf.
// API_PARTENAIRES.md §1.2).
enum ScopeApiPartenaire {
  soustraitance_lecture        // lire les colis qu'on lui a confiés
  soustraitance_statut_ecriture // pousser SES statuts sur ces colis
  etiquettes_lecture           // réimprimer notre étiquette
  reseau_ecriture              // déclarer SA couverture (villes, délais)
  cod_lecture
  cod_reconciliation
  webhooks_gestion
}

// État d'un colis confié à un transporteur tiers, du point de vue de la
// RELATION avec ce transporteur — à ne pas confondre avec Commande.statut,
// qui reste la vérité métier du colis côté Mathio. Les deux avancent en
// parallèle : un colis peut être `livre` chez nous et encore en attente de
// reversement ici tant que le partenaire ne nous a pas rendu l'encaissement.
enum StatutSousTraitance {
  a_transmettre   // décidé, pas encore poussé chez le partenaire
  transmis        // accepté par le partenaire, referenceExterne obtenue
  en_livraison    // le partenaire a confirmé la prise en charge terrain
  livre           // livré par le partenaire
  echec           // tentatives épuisées côté partenaire
  retour_en_cours // le partenaire nous le renvoie
  retourne        // physiquement récupéré par nous (après scan, cf. §5.4)
  annule          // annulé par NOUS avant ou pendant la prise en charge
  rejete          // le partenaire a REFUSÉ la remise (hors zone, poids, COD max)
}

// Cycle de vie d'un relevé de réconciliation COD (§ /admin/partenaires/cod).
// `conteste` n'est pas un état terminal : il retourne à `emis` après
// correction des lignes litigieuses, ce qui laisse une trace dans l'historique.
enum StatutReconciliationCod {
  brouillon
  emis
  conteste
  valide
  regle
}

// État d'un endpoint webhook, indépendant du partenaire lui-même : un
// endpoint peut être coupé automatiquement (voir EndpointWebhook.suspenduLe)
// après une série d'échecs, sans que le partenariat soit remis en cause.
enum StatutEndpointWebhook {
  actif
  suspendu
}
```

### 4.2 `PartenaireTransport`

```prisma
// Entreprise de transport tierce à qui nous confions des colis pour le
// dernier kilomètre (§ /admin/partenaires). AMANA (La Poste marocaine) en est
// la première ligne, seedée par la migration : les statuts
// `expedier_par_amana` et `en_retour_par_amana` (enum StatutCommande)
// préexistaient à cette table et sont désormais GÉNÉRALISÉS — ils signifient
// "remis à / en retour par un transporteur partenaire", l'identité du
// transporteur étant portée ici et non plus dans l'enum (cf.
// API_PARTENAIRES.md §2.1). Les libellés affichés vivent dans lib/statuts.ts,
// surchargés à l'exécution par `nom` quand une LivraisonSousTraitee est
// résolue.
model PartenaireTransport {
  id     String           @id @default(uuid())
  // Identifiant stable exposé dans l'API et les webhooks (ex. "amana",
  // "ctm-messagerie") — jamais l'uuid, qui reste interne. Sert aussi de
  // préfixe de clé de rate limiting (lib/rate-limit.ts).
  code   String           @unique
  nom    String
  statut StatutPartenaire @default(actif)

  // --- Identité légale (facturation, litiges) ---------------------------
  raisonSociale String? @map("raison_sociale")
  iceRc         String? @map("ice_rc")
  adresse       String?
  contactNom    String? @map("contact_nom")
  contactEmail  String? @map("contact_email")
  contactTel    String? @map("contact_tel")

  // --- Comment NOUS l'appelons pour lui remettre un colis ---------------
  // `baseUrlApi` est la racine de LEUR API ; le secret d'appel est chiffré
  // (jamais haché) puisqu'il faut le rejouer — même distinction que pour
  // EndpointWebhook.secretChiffre ci-dessous.
  baseUrlApi           String? @map("base_url_api")
  secretSortantChiffre String? @map("secret_sortant_chiffre")
  // Adaptateur applicatif à utiliser pour parler à ce partenaire : chaque
  // transporteur a son propre dialecte (AMANA, un réseau régional, un
  // partenaire branché sur NOTRE propre API...). Résolu vers un module de
  // lib/partenaires/adaptateurs/<cle>.ts — table plutôt qu'enum pour
  // n'imposer aucune migration à l'ajout d'un transporteur.
  adaptateur           String? @map("adaptateur")

  // --- Règles commerciales figées au contrat ----------------------------
  // Le partenaire encaisse-t-il le COD lui-même ? Si false, le colis lui est
  // remis "sans valeur déclarée" et l'encaissement reste chez nous. Pilote la
  // génération des ReconciliationCod (cf. D-1, API_PARTENAIRES.md §14).
  encaisseCod           Boolean  @default(true) @map("encaisse_cod")
  // Plafond COD par colis accepté par ce partenaire, en MAD. Null = pas de
  // plafond contractuel. Vérifié AVANT transmission, pour éviter un rejet
  // tardif alors que le colis est déjà physiquement parti.
  plafondCod            Decimal? @map("plafond_cod") @db.Decimal(10, 2)
  poidsMaxKg            Decimal? @map("poids_max_kg") @db.Decimal(6, 2)
  // Délai contractuel de reversement du COD, en jours ouvrés — sert à dater
  // l'échéance d'un ReconciliationCod, pas à bloquer quoi que ce soit.
  delaiReversementJours Int?     @map("delai_reversement_jours")

  dateCreation DateTime  @default(now()) @map("date_creation")
  dateArchive  DateTime? @map("date_archive")

  cles                 CleApiPartenaire[]
  endpointsWebhook     EndpointWebhook[]
  livraisons           LivraisonSousTraitee[]
  reconciliations      ReconciliationCod[]
  couvertures          CouvertureVillePartenaire[]
  requetesIdempotentes RequeteIdempotente[]
  journal              JournalApiPartenaire[]
  auditLogs            AuditLog[]

  @@index([statut])
  @@map("partenaires_transport")
}
```

### 4.3 `CleApiPartenaire`

```prisma
// Clé d'API d'un partenaire. Le secret complet n'est JAMAIS stocké : comme
// pour les tokens de réinitialisation de mot de passe et de transfert de
// session (hashResetToken / hashHandoffToken, lib/auth.ts), seul son
// SHA-256 est écrit ici, et le secret n'est affiché qu'une fois, à la
// création, dans /admin/partenaires.
//
// SHA-256 et non bcrypt (hashSecret(), lib/auth.ts) : le facteur de travail
// de bcrypt compense la faible entropie d'un mot de passe humain, ce qu'un
// secret de 32 octets tirés de randomBytes n'a pas — et 60 à 100 ms de CPU
// par requête serait rédhibitoire sur une API appelée en boucle.
//
// `prefixe` est la partie PUBLIQUE de la clé (mtk_live_<prefixe>_<secret>) :
// il est indexé et unique, et sert au lookup — sans lui il faudrait comparer
// le hash contre toutes les lignes de la table à chaque appel. La comparaison
// finale se fait en temps constant (timingSafeEqual, cf. lib/parcel-serial.ts).
model CleApiPartenaire {
  id           String              @id @default(uuid())
  partenaireId String              @map("partenaire_id")
  partenaire   PartenaireTransport @relation(fields: [partenaireId], references: [id], onDelete: Cascade)

  libelle    String
  prefixe    String @unique
  secretHash String @unique @map("secret_hash")
  // 'live' | 'test' — une clé de test ne peut agir que sur les
  // LivraisonSousTraitee marquées estTest (créées depuis le back-office en
  // mode bac à sable). Elle n'entre dans aucun relevé COD et ne déclenche
  // aucun mouvement physique. Le drapeau vit sur la livraison, PAS sur la
  // commande : un bac à sable ne doit jamais pouvoir salir un vrai colis
  // (cf. D-8, API_PARTENAIRES.md §14).
  environnement String @default("live")

  scopes ScopeApiPartenaire[] @default([])

  // Quota propre à cette clé (appels par minute), null = quota par défaut du
  // palier global. Appliqué par checkRateLimit() (lib/rate-limit.ts), sur la
  // clé "api:<prefixe>:<fenêtre>" — même compteur PostgreSQL atomique que le
  // login, pour la même raison (plusieurs instances sans mémoire partagée).
  quotaParMinute Int? @map("quota_par_minute")

  // Version d'API épinglée à cette clé (format AAAA-MM-JJ, cf.
  // API_PARTENAIRES.md §9.3). Null = dernière version stable de la majeure
  // /v1. Épinglée automatiquement à la date de création de la clé pour toute
  // clé créée après la première évolution incompatible.
  versionEpinglee String? @map("version_epinglee")

  // Restriction d'origine réseau (CIDR, ex. "41.248.0.0/16"). Vide = aucune
  // restriction. Deuxième facteur pour les partenaires qui le supportent :
  // une clé qui fuit reste inutilisable hors du réseau du partenaire.
  ipAutorisees String[] @default([]) @map("ip_autorisees")

  creeeLe DateTime @default(now()) @map("creee_le")
  // Fenêtre de rotation sans coupure : deux clés actives au plus, l'ancienne
  // porte une date d'expiration (refus DOUX, avec en-tête de dépréciation)
  // avant sa révocation (refus DUR, immédiat).
  expireLe              DateTime? @map("expire_le")
  revoqueeLe            DateTime? @map("revoquee_le")
  derniereUtilisationLe DateTime? @map("derniere_utilisation_le")
  nbAppels              BigInt    @default(0) @map("nb_appels")

  @@index([partenaireId])
  @@map("cles_api_partenaire")
}
```

### 4.4 `CouvertureVillePartenaire`

```prisma
// Villes qu'un partenaire dessert, et à quelles conditions — c'est la table
// qui décide si un colis lui est ÉLIGIBLE (§ API_PARTENAIRES.md §6.2).
// Rattachée au référentiel Ville existant plutôt qu'à du texte libre, pour
// que l'éligibilité se calcule avec la même mécanique de normalisation que le
// routage inter-hubs (normaliserVille, lib/hub-stock.ts, utilisée par
// lib/hub-envoi.ts). Une ville ABSENTE de cette table n'est pas desservie par
// ce partenaire : l'absence vaut refus, jamais l'inverse.
//
// Alimentée depuis /admin/partenaires ET par le partenaire lui-même via
// PUT /v1/reseau/couverture (scope reseau_ecriture) — c'est LUI qui sait où
// il livre. `coutHt` reste en revanche à la main du back-office : un
// partenaire ne fixe pas seul le prix qu'on lui paie.
model CouvertureVillePartenaire {
  id           String              @id @default(uuid())
  partenaireId String              @map("partenaire_id")
  partenaire   PartenaireTransport @relation(fields: [partenaireId], references: [id], onDelete: Cascade)
  villeId      String              @map("ville_id")
  ville        Ville               @relation(fields: [villeId], references: [id])

  // Délai indicatif annoncé par le partenaire, en jours ouvrés.
  delaiJours Int? @map("delai_jours")
  // Coût de transport négocié pour cette ville, en MAD. INTERNE : n'est
  // jamais exposé dans l'API, même à son titulaire (§ API_PARTENAIRES.md
  // §10.2).
  coutHt     Decimal? @map("cout_ht") @db.Decimal(10, 2)
  actif      Boolean  @default(true)

  @@unique([partenaireId, villeId])
  @@index([villeId])
  @@map("couvertures_ville_partenaire")
}
```

### 4.5 `LivraisonSousTraitee` — l'objet pivot

```prisma
// Un colis à nous, confié à un transporteur tiers pour le dernier kilomètre.
// C'est l'objet PIVOT de la sous-traitance : il porte tout ce qui concerne la
// RELATION avec le transporteur (sa référence de suivi, ce qu'il a encaissé,
// ce qu'il nous facture), pendant que Commande.statut reste la vérité métier
// du colis, visible du marchand. Aucune colonne n'est ajoutée à `commandes` :
// toute la sous-traitance vit ici (cf. API_PARTENAIRES.md §1.2).
//
// Une Commande peut avoir PLUSIEURS lignes ici au fil du temps (un partenaire
// rejette, on repasse par un autre ; un retour puis une seconde tentative) —
// d'où l'absence de contrainte @@unique([commandeId]) et la présence de
// `actif`, dont une seule ligne par commande peut être vraie à la fois
// (index unique partiel posé en migration, cf. §11).
model LivraisonSousTraitee {
  id           String              @id @default(uuid())
  commandeId   String              @map("commande_id")
  commande     Commande            @relation(fields: [commandeId], references: [id])
  partenaireId String              @map("partenaire_id")
  partenaire   PartenaireTransport @relation(fields: [partenaireId], references: [id])

  statut StatutSousTraitance @default(a_transmettre)
  actif  Boolean             @default(true)
  // Remise de bac à sable : n'entre dans aucun relevé COD, ne déclenche aucun
  // mouvement physique, et n'est manipulable que par une clé d'environnement
  // `test`. Porté ici plutôt que sur Commande pour que le périmètre à filtrer
  // reste cette seule table (cf. D-8, §14).
  estTest Boolean @default(false) @map("est_test")

  // Numéro de suivi attribué PAR LE PARTENAIRE. C'est ce que le marchand voit
  // quand il demande "où en est mon colis chez AMANA", et c'est la clé par
  // laquelle le partenaire nous parle de ce colis (PATCH /v1/sous-traitance/
  // {referenceExterne}/statut). Null tant que statut = a_transmettre ; unique
  // par partenaire dès qu'elle existe — le NULL non comparable de PostgreSQL
  // fait que les lignes non encore transmises ne se bloquent jamais entre
  // elles (cf. API_PARTENAIRES.md §2.4).
  referenceExterne String? @map("reference_externe")
  // URL de suivi publique du partenaire, si elle existe — affichée telle
  // quelle au marchand, jamais reconstruite par concaténation.
  urlSuiviExterne  String? @map("url_suivi_externe")

  // Clé d'idempotence que NOUS avons envoyée au partenaire pour cette remise,
  // conservée pour pouvoir rejouer l'appel sans risquer un doublon chez lui
  // après un timeout réseau (§ API_PARTENAIRES.md §9.1).
  cleIdempotenceSortante String? @unique @map("cle_idempotence_sortante")

  // --- Volet COD --------------------------------------------------------
  // montantCodConfie est FIGÉ à la remise (copie de Commande.montantCod à cet
  // instant) : si le montant du colis est corrigé ensuite côté marchand, ce
  // qui a été demandé au partenaire ne change pas rétroactivement.
  montantCodConfie   Decimal  @map("montant_cod_confie") @db.Decimal(10, 2)
  montantCodEncaisse Decimal? @map("montant_cod_encaisse") @db.Decimal(10, 2)
  // Coût de transport facturé par le partenaire pour ce colis. INTERNE.
  coutTransport      Decimal? @map("cout_transport") @db.Decimal(10, 2)

  // --- Horodatage du cycle ---------------------------------------------
  dateTransmission  DateTime? @map("date_transmission")
  datePriseEnCharge DateTime? @map("date_prise_en_charge")
  dateLivraison     DateTime? @map("date_livraison")
  dateRetour        DateTime? @map("date_retour")

  // Dernier statut PUBLIC reçu du partenaire, tel quel, avant projection sur
  // StatutCommande — conservé pour le support : quand un marchand conteste,
  // il faut pouvoir montrer ce que le transporteur a réellement dit, pas
  // seulement notre interprétation.
  dernierStatutPartenaire String?   @map("dernier_statut_partenaire")
  dernierMotifPartenaire  String?   @map("dernier_motif_partenaire")
  dernierEvenementLe      DateTime? @map("dernier_evenement_le")

  ligneReconciliation LigneReconciliationCod?

  creeLe DateTime @default(now()) @map("cree_le")

  @@unique([partenaireId, referenceExterne], map: "livraisons_sous_traitees_partenaire_ref_key")
  @@index([commandeId])
  @@index([partenaireId, statut])
  // Index de pagination par curseur de GET /v1/sous-traitance
  // (§ API_PARTENAIRES.md §9.2) : le tri est (creeLe DESC, id DESC), stable
  // parce que `id` est unique.
  @@index([partenaireId, creeLe, id])
  @@map("livraisons_sous_traitees")
}
```

### 4.6 `EndpointWebhook` et `LivraisonWebhook`

Le catalogue d'événements poussés vers le partenaire est **court** (§8.1) :
dans un flux sortant, c'est lui qui nous informe, pas l'inverse. Les webhooks
ne servent qu'aux trois cas où **nous** avons quelque chose à lui apprendre :
nous lui confions un colis, nous annulons un colis qu'il détient, un relevé
COD est disponible.

```prisma
// Point de terminaison HTTPS d'un partenaire à qui nous poussons des
// événements. Un partenaire peut en déclarer plusieurs, avec des abonnements
// distincts (ex. un endpoint "opérations" et un endpoint "finance").
model EndpointWebhook {
  id           String              @id @default(uuid())
  partenaireId String              @map("partenaire_id")
  partenaire   PartenaireTransport @relation(fields: [partenaireId], references: [id], onDelete: Cascade)

  url    String
  statut StatutEndpointWebhook @default(actif)

  // Événements auxquels cet endpoint est abonné (ex. "soustraitance.annulee").
  // Liste de chaînes plutôt qu'un enum : le catalogue d'événements évolue plus
  // vite que le schéma, et un événement inconnu doit être ignoré côté
  // receveur, pas faire échouer une migration (cf. API_PARTENAIRES.md §8.1).
  evenements String[] @default([])

  // Secret de signature HMAC-SHA256 des enveloppes envoyées, CHIFFRÉ et non
  // haché — contrairement aux clés d'API ci-dessus : nous devons pouvoir le
  // REJOUER pour signer chaque envoi, un hash serait à sens unique et donc
  // inutilisable. Chiffrement AES-256-GCM avec PARTNER_SECRET_ENC_KEY
  // (cf. .env.example). Deux colonnes pour la rotation : l'ancien secret
  // reste valide le temps que le partenaire bascule.
  secretChiffre          String    @map("secret_chiffre")
  secretPrecedentChiffre String?   @map("secret_precedent_chiffre")
  secretRotationLe       DateTime? @map("secret_rotation_le")

  // Coupe-circuit : après N échecs consécutifs (cf. §8.4), l'endpoint passe
  // `suspendu` et les livraisons sont mises en file sans être tentées, plutôt
  // que de marteler un serveur mort et de saturer la file pour les autres.
  echecsConsecutifs Int       @default(0) @map("echecs_consecutifs")
  suspenduLe        DateTime? @map("suspendu_le")

  creeLe DateTime @default(now()) @map("cree_le")

  livraisons LivraisonWebhook[]

  @@index([partenaireId])
  @@map("endpoints_webhook")
}

// Journal d'une tentative de livraison d'un webhook — une ligne PAR
// ÉVÉNEMENT (pas par tentative), les tentatives successives incrémentant la
// même ligne. C'est cette table qui porte la garantie "au moins une fois" :
// tant que `livreLe` est null et que `prochaineTentativeLe` est dépassée, un
// worker la reprend. Sans elle, une annulation perdue pendant une coupure du
// partenaire le serait définitivement — et il livrerait un colis annulé.
model LivraisonWebhook {
  id         String          @id @default(uuid())
  endpointId String          @map("endpoint_id")
  endpoint   EndpointWebhook @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  // Identifiant de l'ÉVÉNEMENT, repris tel quel dans l'enveloppe (champ `id`)
  // et stable à travers toutes les tentatives : c'est la clé d'idempotence
  // que le partenaire doit utiliser pour dédupliquer de son côté (§8.5).
  evenementId   String @unique @map("evenement_id")
  typeEvenement String @map("type_evenement")
  // Enveloppe complète sérialisée, figée à l'émission : un rejeu doit
  // renvoyer OCTET POUR OCTET le même corps, sinon la signature calculée à
  // la première tentative ne correspondrait plus.
  charge        Json   @map("charge")

  // Objet concerné, pour retrouver les webhooks d'une livraison depuis le
  // back-office sans désérialiser `charge`.
  cibleType String? @map("cible_type")
  cibleId   String? @map("cible_id")

  nbTentatives         Int       @default(0) @map("nb_tentatives")
  dernierStatutHttp    Int?      @map("dernier_statut_http")
  derniereErreur       String?   @map("derniere_erreur")
  prochaineTentativeLe DateTime? @map("prochaine_tentative_le")
  livreLe              DateTime? @map("livre_le")
  abandonneLe          DateTime? @map("abandonne_le")
  creeLe               DateTime  @default(now()) @map("cree_le")

  // Index de file d'attente : les lignes non livrées, non abandonnées, dont
  // l'heure est venue. Partiel côté SQL dans la migration (WHERE livre_le IS
  // NULL AND abandonne_le IS NULL) pour rester petit quand le journal grossit.
  @@index([prochaineTentativeLe])
  @@index([endpointId])
  @@index([cibleType, cibleId])
  @@map("livraisons_webhook")
}
```

### 4.7 Réconciliation COD

Le sens de la dette est **toujours le même** : le partenaire a encaissé, il
nous doit l'argent. C'est la conséquence directe du périmètre sortant — il n'y
a pas de solde net à calculer, pas de relevé en sens inverse, donc pas de
colonne `sens`.

```prisma
// Relevé de réconciliation COD entre Mathio et un partenaire, sur une période
// donnée (§ /admin/partenaires/[id]/cod). Le partenaire a encaissé pour notre
// compte ; ce relevé établit ce qu'il nous doit.
//
// Le relevé est IMMUABLE une fois `valide` : une correction postérieure passe
// par une ligne d'ajustement dans le relevé SUIVANT, jamais par une
// modification rétroactive (règle comptable, cf. § /admin/comptabilite).
model ReconciliationCod {
  id           String              @id @default(uuid())
  numero       String              @unique
  partenaireId String              @map("partenaire_id")
  partenaire   PartenaireTransport @relation(fields: [partenaireId], references: [id])

  statut StatutReconciliationCod @default(brouillon)

  periodeDebut DateTime @map("periode_debut") @db.Date
  periodeFin   DateTime @map("periode_fin") @db.Date

  nbColis           Int      @map("nb_colis")
  montantCodAttendu Decimal  @map("montant_cod_attendu") @db.Decimal(12, 2)
  montantCodDeclare Decimal? @map("montant_cod_declare") @db.Decimal(12, 2)
  // Frais de transport de la période, déduits du reversement si le contrat le
  // prévoit. INTERNE tant que la décision "compensation ou flux séparés"
  // n'est pas tranchée (cf. D-2, API_PARTENAIRES.md §14).
  montantFrais      Decimal? @map("montant_frais") @db.Decimal(12, 2)
  ecart             Decimal? @db.Decimal(12, 2)

  dateEmission   DateTime? @map("date_emission")
  dateEcheance   DateTime? @map("date_echeance") @db.Date
  dateValidation DateTime? @map("date_validation")
  dateReglement  DateTime? @map("date_reglement")
  reference      String? // référence du virement / avis de crédit

  // Écriture comptable générée au règlement (§ /admin/comptabilite), 1-1,
  // jamais recréée — même pattern que BonDistribution.transactionId.
  transactionId String?      @unique @map("transaction_id")
  transaction   Transaction? @relation("TransactionReconciliationCod", fields: [transactionId], references: [id])

  lignes LigneReconciliationCod[]

  @@index([partenaireId, statut])
  @@map("reconciliations_cod")
}

// Une ligne = un colis dans un relevé. `montantAttendu` est figé à
// l'émission ; `montantDeclare` est ce que le partenaire affirme avoir
// encaissé. Toute ligne où les deux diffèrent (ou dont le statut de livraison
// diverge) est litigieuse et bloque la validation du relevé.
model LigneReconciliationCod {
  id               String            @id @default(uuid())
  reconciliationId String            @map("reconciliation_id")
  reconciliation   ReconciliationCod @relation(fields: [reconciliationId], references: [id], onDelete: Cascade)

  // 1-1 avec la livraison sous-traitée : un colis ne peut figurer que dans un
  // seul relevé (l'unicité est la garantie qu'on ne réclame pas deux fois le
  // même encaissement).
  livraisonId String               @unique @map("livraison_id")
  livraison   LivraisonSousTraitee @relation(fields: [livraisonId], references: [id])

  montantAttendu Decimal  @map("montant_attendu") @db.Decimal(10, 2)
  montantDeclare Decimal? @map("montant_declare") @db.Decimal(10, 2)
  ecart          Decimal? @db.Decimal(10, 2)
  litige         Boolean  @default(false)
  motifLitige    String?  @map("motif_litige")

  @@index([reconciliationId])
  @@map("lignes_reconciliation_cod")
}
```

### 4.8 Idempotence, journalisation et audit

```prisma
// Clé d'idempotence d'une requête d'écriture entrante (§ en-tête
// Idempotency-Key, API_PARTENAIRES.md §9.1). Protège du rejeu réseau les
// seules écritures qui ne sont pas naturellement idempotentes : la
// déclaration COD (rejouée, elle compterait deux fois) et la création d'un
// endpoint webhook. Le PATCH de statut, lui, est idempotent par construction
// grâce au contrôle d'antériorité sur `occurred_at` (§7.4).
//
// `empreinteCorps` est le SHA-256 du corps JSON canonicalisé : réutiliser la
// même clé avec un corps DIFFÉRENT est une erreur du client, pas un rejeu, et
// doit répondre 409 plutôt que renvoyer silencieusement l'ancienne réponse.
model RequeteIdempotente {
  id           String              @id @default(uuid())
  partenaireId String              @map("partenaire_id")
  partenaire   PartenaireTransport @relation(fields: [partenaireId], references: [id], onDelete: Cascade)

  cle            String @map("cle")
  methode        String
  chemin         String
  empreinteCorps String @map("empreinte_corps")

  // 'en_cours' pendant le traitement (verrou : un second appel concurrent
  // reçoit 409 `request_in_progress` plutôt que de dupliquer l'écriture),
  // 'terminee' ensuite.
  etat String @default("en_cours")

  statutHttp Int?      @map("statut_http")
  reponse    Json?
  termineeLe DateTime? @map("terminee_le")
  creeLe     DateTime  @default(now()) @map("cree_le")
  // Purge après 24 h (tâche planifiée) : au-delà, un rejeu n'est plus un
  // incident réseau mais un bug applicatif, et doit se voir comme tel.
  expireLe   DateTime  @map("expire_le")

  @@unique([partenaireId, cle])
  @@index([expireLe])
  @@map("requetes_idempotentes")
}

// Journal d'appel de l'API Partenaires — VOLUMÉTRIE ÉLEVÉE, purgeable
// (rétention 30 jours). Volontairement séparé d'AuditLog, qui reste réservé
// aux actes SENSIBLES et rares (remise d'un colis, création/rotation/
// révocation de clé, validation d'un relevé COD) et n'a pas vocation à
// recevoir une ligne par requête HTTP.
//
// Le corps des requêtes n'est PAS journalisé (il peut porter le nom du
// destinataire dans une preuve de livraison) — seulement l'empreinte,
// suffisante pour rapprocher deux appels identiques lors d'un incident.
model JournalApiPartenaire {
  id           String              @id @default(uuid())
  partenaireId String              @map("partenaire_id")
  partenaire   PartenaireTransport @relation(fields: [partenaireId], references: [id], onDelete: Cascade)
  // Préfixe de la clé utilisée (partie publique), pas son id : permet de lire
  // le journal d'une clé révoquée puis supprimée.
  clePrefixe   String? @map("cle_prefixe")

  requeteId      String  @unique @map("requete_id") // renvoyé au client (X-Request-Id)
  methode        String
  chemin         String
  statutHttp     Int     @map("statut_http")
  dureeMs        Int     @map("duree_ms")
  adresseIp      String? @map("adresse_ip")
  codeErreur     String? @map("code_erreur")
  empreinteCorps String? @map("empreinte_corps")

  horodatage DateTime @default(now())

  @@index([partenaireId, horodatage])
  @@index([horodatage])
  @@map("journal_api_partenaire")
}
```

**Adaptation d'`AuditLog`.** Le modèle actuel exige un auteur humain :

```prisma
adminId String      @map("admin_id")
admin   Utilisateur @relation("AuditLogAuteur", fields: [adminId], references: [id])
```

Un acte déclenché par une clé d'API n'a pas d'`Utilisateur`. Deux ajouts
minimaux, non destructifs :

```prisma
// AuditLog — modifications proposées
adminId      String?              @map("admin_id")   // devient nullable
admin        Utilisateur?         @relation("AuditLogAuteur", fields: [adminId], references: [id])
// Acteur machine : renseigné quand l'acte vient de l'API Partenaires
// (§ api.<domaine>/v1/**) plutôt que d'un humain du back-office. Exactement
// un des deux est renseigné — contrainte CHECK posée en migration.
partenaireId String?              @map("partenaire_id")
partenaire   PartenaireTransport? @relation(fields: [partenaireId], references: [id])

@@index([partenaireId])
```

Passer une colonne obligatoire en nullable est un élargissement : aucune ligne
existante n'est invalidée, aucun backfill n'est nécessaire.

### 4.9 Relations inverses sur les modèles existants

**Ce sont les seules modifications apportées aux modèles existants, et aucune
n'ajoute de colonne** — une relation inverse Prisma ne produit aucune colonne
SQL du côté où elle est déclarée.

```prisma
// Commande — § Sous-traitance : historique des remises à un transporteur tiers.
livraisonsSousTraitees LivraisonSousTraitee[]
```

```prisma
// Ville — § API Partenaires : partenaires desservant cette ville.
couverturesPartenaires CouvertureVillePartenaire[]
```

```prisma
// Transaction — § API Partenaires : règlement d'un relevé de réconciliation COD.
reconciliationCod ReconciliationCod? @relation("TransactionReconciliationCod")
```

```prisma
// Utilisateur — inchangé, hormis le passage d'AuditLog.adminId en nullable.
```

---

## 5. Le contrat de statuts publics

C'est le cœur de la spécification. **Les 31 valeurs de `StatutCommande` ne
doivent jamais sortir telles quelles, ni entrer telles quelles.**

Dans un flux sortant, le contrat sert dans les deux sens, mais pas avec le
même poids :

- **PUBLIC → INTERNE (§5.4)** — le sens *principal*. Le partenaire nous pousse
  ses statuts ; il faut les traduire en `StatutCommande` sans lui laisser
  écrire n'importe quoi.
- **INTERNE → PUBLIC (§5.3)** — le sens *secondaire*. Nous exposons notre
  vision du colis dans `GET /v1/sous-traitance/{ref}`, essentiellement pour
  qu'il sache si nous l'avons annulé ou si nous avons bien reçu son retour.

### 5.1 Pourquoi les statuts internes ne sortent pas

1. **Ils décrivent notre organisation, pas l'état du colis.**
   `deuxieme_appel_pas_reponse`, `troisieme_appel_pas_reponse`,
   `relance_nouveau_client`, `attente_de_relancer`, `client_interesse` racontent
   le fonctionnement de notre centre d'appel. Les exposer, c'est vendre notre
   process opérationnel à un partenaire qui est aussi un concurrent.
2. **Ils ne sont pas stables.** Le commentaire de `StatutCommande` documente
   déjà une refonte complète (`migration 20260725_refonte_statuts_colis`), et
   quatre valeurs ont été ajoutées depuis (`pret_pour_preparation`,
   `recu_au_hub`, `en_transit`, `retourne_au_hub`). Un enum qui bouge tous les
   trimestres ne peut pas être un contrat d'API.
3. **Ils ne sont pas ordonnés.** `app/api/commandes/[id]/statut/route.ts`
   l'écrit noir sur blanc : *« le cycle "call-center" n'a pas d'ordre strict —
   un agent peut passer de "Boîte vocale" à "Programmé" puis "Injoignable" sans
   séquence imposée »*. Un partenaire, lui, a besoin d'une machine à états
   lisible.
4. **Le vocabulaire est franco-marocain et le nommage est irrégulier**
   (`numero_errone`, `expedier_par_amana` à l'infinitif au milieu de participes
   passés). Une API destinée à des intégrateurs tiers a besoin d'un vocabulaire
   anglais normalisé, proche de ce que font les autres transporteurs.

Le sens entrant a une raison supplémentaire, plus forte : **un partenaire ne
doit pas pouvoir écrire n'importe quelle valeur de notre enum.** S'il pouvait
poser `pret_pour_preparation` ou `recu_au_hub`, il piloterait notre pipeline
logistique depuis l'extérieur. Le jeu public de 11 valeurs est aussi une
**liste blanche d'écriture** (§5.4).

### 5.2 Le jeu public : 11 statuts + un code de motif

Le statut public répond à *« où est ce colis ? »*. La granularité fine passe
par un **`reason_code`** séparé, facultatif, extensible **sans rupture de
contrat** — un client qui ne connaît pas un nouveau `reason_code` continue de
comprendre le statut.

| # | `status` | Signification | Terminal |
|---|---|---|---|
| 1 | `created` | Enregistré, pas encore pris en charge par le partenaire | non |
| 2 | `picked_up` | Physiquement pris en charge par le partenaire | non |
| 3 | `at_facility` | Dans une installation (la sienne, ou la nôtre au retour) | non |
| 4 | `in_transit` | En mouvement entre deux installations | non |
| 5 | `out_for_delivery` | Confié à un livreur pour la tournée du jour | non |
| 6 | `attempt_failed` | Tentative de livraison ou de contact infructueuse | non |
| 7 | `on_hold` | En attente d'une action (client, expéditeur, planification) | non |
| 8 | `delivered` | Livré, COD encaissé | **oui** |
| 9 | `returning` | En cours de retour vers nous | non |
| 10 | `returned` | Retour terminé, colis physiquement récupéré par nous | **oui** |
| 11 | `cancelled` | Annulé | **oui** |

**Volontairement absents** — et pourquoi :

- `lost` / `damaged` : la perte n'a **aucun statut interne** aujourd'hui
  (`STATUTS_TERMINAUX` = `livre, retourne, annule, annule_par_vendeur`).
  L'ajouter au contrat public sans contrepartie interne créerait un statut
  qu'on ne saurait pas projeter. À reprendre avec la décision D-4 (§14).
- `exception` : trop vague, se recoupe avec `attempt_failed` + `reason_code`.
- Un statut « en douane » : sans objet, réseau national.

### 5.3 INTERNE → PUBLIC : notre vision du colis (`platform_status`)

Cette table est exhaustive sur les 31 valeurs de `StatutCommande`. **La
plupart de ses lignes ne seront jamais émises** dans un périmètre sortant : un
colis n'est remis à un partenaire qu'à partir d'un petit sous-ensemble d'états
(§6.2), et ce qu'il devient ensuite est décrit par le partenaire, pas par
nous. L'exhaustivité n'est pas de la complétude gratuite — c'est ce qui rend
le `Record<StatutCommande, …>` de §5.7 un **garde-fou de compilation** : ajouter
une valeur à l'enum sans décider de sa projection ne compilera pas.

| `StatutCommande` (interne) | `status` (public) | `reason_code` | Note |
|---|---|---|---|
| `nouveau_colis` | `created` | `registered` | |
| `attente_de_ramassage` | `created` | `awaiting_pickup` | |
| `ramasse` | `picked_up` | — | `Commande.dateCollecte` renseignée |
| `recu` | `at_facility` | — | Éligible à la remise (§6.2) |
| `pret_pour_preparation` | `at_facility` | `awaiting_preparation` | Pipeline stock (§ `/admin/stock`) |
| `recu_au_hub` | `at_facility` | — | Éligible à la remise ; `facility` exposé (§5.6) |
| `en_transit` | `in_transit` | — | Transit inter-hubs (§ `/admin/bon-envoi`) |
| `expedie` | `in_transit` | — | |
| `expedier_par_amana` | `in_transit` | `handed_to_carrier` | **L'état nominal après remise** ; `carrier` renseigné |
| `en_voyage` | `in_transit` | — | |
| `mise_en_distribution` | `out_for_delivery` | — | Tournée créée (§ `/admin/bon-distribution`) |
| `livre` | `delivered` | — | **Terminal.** `dateLivraison` renseignée |
| `en_cours` | `on_hold` | `processing` | Dossier en cours de traitement centre d'appel |
| `boite_vocale` | `attempt_failed` | `voicemail` | |
| `deuxieme_appel_pas_reponse` | `attempt_failed` | `no_answer` | Le **rang** de l'appel n'est pas exposé |
| `troisieme_appel_pas_reponse` | `attempt_failed` | `no_answer` | idem |
| `pas_de_reponse_sms` | `attempt_failed` | `no_answer` | idem |
| `injoignable` | `attempt_failed` | `unreachable` | |
| `numero_errone` | `attempt_failed` | `wrong_number` | |
| `client_interesse` | `on_hold` | `awaiting_customer` | |
| `relance_nouveau_client` | `on_hold` | `awaiting_customer` | |
| `attente_de_relancer` | `on_hold` | `awaiting_customer` | |
| `programme` | `on_hold` | `scheduled` | `scheduled_for` = `dateNouvelleLivraison` |
| `reporte` | `attempt_failed` | `rescheduled` | `scheduled_for` = `dateNouvelleLivraison` |
| `hors_zone` | `attempt_failed` | `out_of_area` | |
| `refuse` | `attempt_failed` | `refused_by_recipient` | `motifRetour` → `reason_detail` |
| `retourne_au_hub` | `at_facility` | `back_at_facility` | **Accusé de retour** : le colis nous est revenu (§6.5) |
| `retourne` | `returned` | — | **Terminal.** |
| `en_retour_par_amana` | `returning` | `carrier_return` | `carrier` renseigné |
| `annule` | `cancelled` | `cancelled_by_carrier` | **Terminal.** |
| `annule_par_vendeur` | `cancelled` | `cancelled_by_shipper` | **Terminal.** |

> **Note sur `returning`.** Aucun *statut* interne ne signifie « retour en
> cours dans **notre** réseau » : `returning` n'est atteignable que via
> `en_retour_par_amana`, donc uniquement quand un tiers est impliqué — ce qui,
> dans ce périmètre, est précisément le cas nominal. Le trou n'a donc pas
> d'incidence pratique ici : un colis qui rentre par nos propres moyens n'est
> plus chez le partenaire, et son parcours ne le regarde plus. Le modèle
> `BonRetour` (`Commande.bonRetourId`) porterait l'information si le besoin
> apparaissait ; voir **D-5** (§14).

### 5.4 PUBLIC → INTERNE : ce que le partenaire nous pousse

C'est **le** contrat critique. Utilisé par
`PATCH /v1/sous-traitance/{ref}/statut` (§7.4), qui écrit à la fois
`LivraisonSousTraitee.statut` et, quand c'est justifié, `Commande.statut`.

| `status` reçu | `reason_code` reçu | → `LivraisonSousTraitee.statut` | → `Commande.statut` |
|---|---|---|---|
| `picked_up` | — | `transmis` | `expedier_par_amana` |
| `at_facility` | — | `transmis` | *(inchangé)* — leur réseau interne ne nous regarde pas |
| `in_transit` | — | `transmis` | *(inchangé)* |
| `out_for_delivery` | — | `en_livraison` | `mise_en_distribution` |
| `attempt_failed` | `refused_by_recipient` | `en_livraison` | `refuse` (**exige** `reason_detail`) |
| `attempt_failed` | `out_of_area` | `en_livraison` | `hors_zone` |
| `attempt_failed` | `wrong_number` | `en_livraison` | `numero_errone` |
| `attempt_failed` | `unreachable` \| `voicemail` \| `no_answer` | `en_livraison` | `injoignable` |
| `attempt_failed` | `rescheduled` | `en_livraison` | `reporte` (+ `dateNouvelleLivraison`) |
| `on_hold` | *(tout)* | `en_livraison` | `en_cours` |
| `delivered` | — | `livre` | `livre` (**exige** `proof`, cf. RG-02) |
| `returning` | — | `retour_en_cours` | `en_retour_par_amana` |
| `returned` | — | `retour_en_cours` | *(inchangé)* — voir règle 2 ci-dessous |
| `cancelled` | `cancelled_by_carrier` | `rejete` | *(inchangé)* — à nous de rebasculer (§6.4) |

**Trois règles de projection non négociables :**

1. **La granularité perdue à l'aller ne se réinvente pas au retour.**
   `no_answer` retombe sur `injoignable`, jamais sur
   `deuxieme_appel_pas_reponse` : le compteur d'appels est le nôtre, un tiers
   ne peut pas l'incrémenter.
2. **`returned` ne clôt jamais un colis.** Le passage à `LivraisonSousTraitee.
   retourne` puis à `Commande.retourne_au_hub` exige un **scan physique** de
   notre côté (`POST /api/commandes/scan-reception`). Un `returned` poussé par
   le partenaire ne fait donc *rien* de plus que `returning` : il note son
   intention, pas notre réception. Sans cette règle, un partenaire pourrait
   clore un dossier sans jamais nous rendre le colis, et le litige serait
   indémêlable. C'est la raison pour laquelle la table ci-dessus mappe
   `returned` sur `retour_en_cours` et non sur `retourne`.
3. **`delivered` exige une preuve.** `app/api/commandes/[id]/statut/route.ts`
   applique déjà RG-02 (`STATUTS_REQUIS_PREUVE = ['livre']` → photo **ou**
   signature obligatoire). L'API ne l'affaiblit pas : un `delivered` sans
   `proof` est refusé en `422 proof_required`. C'est aussi ce qui protège la
   réconciliation COD (§7.7) : pas de preuve, pas d'encaissement opposable.

**Ce qui n'est pas dans la table est refusé.** `cancelled` +
`cancelled_by_shipper` n'y figure pas : c'est *nous* l'expéditeur, un
partenaire ne peut pas annuler en notre nom. `created` non plus : il n'a rien
créé. Toute combinaison absente répond `400 invalid_request` avec la liste des
valeurs acceptées, plutôt que d'être ignorée silencieusement.

### 5.5 Les deux statuts d'un colis sous-traité

Un colis remis porte **deux statuts qui n'ont pas le même auteur** et qui ne
doivent jamais être fusionnés :

| | `carrier_status` | `platform_status` |
|---|---|---|
| Source | `LivraisonSousTraitee.statut` + dernier push du partenaire | Projection de `Commande.statut` (§5.3) |
| Auteur | Le partenaire | Nous |
| Fait foi pour | Où est physiquement le colis | Ce que le marchand voit, ce qui est facturé |
| Exposé dans | `GET /v1/sous-traitance/{ref}` | idem, champ distinct |

Ils divergent légitimement et durablement. Deux exemples :

- Le partenaire pousse `at_facility` (colis dans **son** entrepôt) : le
  `carrier_status` bouge, le `platform_status` reste `in_transit`
  (`expedier_par_amana`). Son réseau interne ne nous regarde pas.
- Le partenaire pousse `returned` : le `carrier_status` passe
  `retour_en_cours`, le `platform_status` ne bouge **pas** tant que le scan
  physique n'a pas eu lieu (règle 2 de §5.4).

Les fusionner en un statut unique reviendrait à laisser un tiers écrire dans
la colonne que voit le marchand.

### 5.6 Champs d'accompagnement du statut

```jsonc
{
  "status": "attempt_failed",
  "reason_code": "refused_by_recipient",
  "reason_detail": "Client ne reconnaît pas la commande",  // = Commande.motifRetour
  "scheduled_for": null,                                    // = dateNouvelleLivraison
  "facility": { "code": "HUB-CASA", "city": "Casablanca" }, // JAMAIS l'adresse ni le téléphone du hub
  "carrier": { "code": "amana", "name": "AMANA" },
  "occurred_at": "2026-08-21T14:32:05Z",
  "is_final": false
}
```

`facility` n'est renseigné que dans le sens INTERNE → PUBLIC, et dérivé de
`Commande.hubActuelId` → `Hub.nom` / `Hub.ville`, sans jamais exposer
`Hub.adresse`, `Hub.telephone` ni `Hub.isCentral` (topologie interne, §10.2).
Dans le sens entrant, un `facility` envoyé par le partenaire est **ignoré** :
nous ne stockons pas la géographie de son réseau.

### 5.7 Où vit la table de correspondance

Un nouveau module **pur**, `lib/api-partenaires/statuts.ts`, sur le modèle de
`lib/spaces.ts` (*« module volontairement PUR — aucun import de `next/*`, de
Prisma ni de crypto »*), pour qu'il reste testable en isolation et importable
depuis un script :

```ts
export type StatutPublic =
  | 'created' | 'picked_up' | 'at_facility' | 'in_transit' | 'out_for_delivery'
  | 'attempt_failed' | 'on_hold' | 'delivered' | 'returning' | 'returned' | 'cancelled';

export const STATUT_INTERNE_VERS_PUBLIC: Record<StatutCommande, {
  status: StatutPublic; reasonCode: string | null;
}>;

export function projeterStatutPublic(c: Commande, l?: LivraisonSousTraitee): StatutPublicComplet;
export function projeterStatutInterne(p: StatutPublic, r?: string): ResultatProjection | null;
```

**Point de vigilance** : `STATUT_INTERNE_VERS_PUBLIC` étant un
`Record<StatutCommande, …>`, TypeScript **refuse de compiler** si une valeur
d'enum est ajoutée sans être mappée. C'est exactement le garde-fou qui manque
aujourd'hui aux listes de `lib/statuts.ts` (qui sont des tableaux, pas des
`Record`) : le contrat public ne peut pas dériver en silence.

`projeterStatutInterne()` renvoie `null` — et non une valeur par défaut — pour
toute combinaison absente de §5.4. Un défaut silencieux serait la porte
ouverte à une écriture non prévue dans `Commande.statut`.

### 5.8 Objet `proof`

```jsonc
{
  "proof": {
    "type": "signature",              // "signature" | "photo"
    "captured_at": "2026-08-21T14:30:00Z",
    "recipient_name": "A. B.",        // initiales seulement (§10.2)
    "data": "data:image/png;base64,iVBORw0…"   // à l'ENTRÉE seulement
  }
}
```

À l'**entrée** (le partenaire nous pousse un `delivered`), `data` porte la
preuve brute : c'est elle qui alimente `Commande.signatureUrl` /
`photoPreuveUrl` et qui rend l'encaissement opposable.

À la **sortie** (nous exposons un colis), `data` est remplacé par une **URL
signée à durée limitée** (15 min), jamais la data-URL brute : ces colonnes
contiennent aujourd'hui des data-URL (cf. commentaire sur `Commande.cinUrl`),
qui gonfleraient chaque réponse de plusieurs centaines de kilo-octets.

---

## 6. Le cycle de sous-traitance

### 6.1 Cycle complet

```
  Colis Mathio (recu_au_hub / recu / ramasse, ville hors de notre couverture)
        │
        │ ① Éligibilité — CouvertureVillePartenaire + plafondCod + poidsMaxKg
        ▼
  ② POST /admin/partenaires/{id}/remise          (back-office, session admin)
        │   crée LivraisonSousTraitee (a_transmettre, montantCodConfie figé)
        │   écrit un AuditLog (action = 'soustraitance.remise')
        ▼
  ③ Transmission au partenaire  ── deux modes, §6.3
        │   mode PUSH : nous appelons SON API (lib/partenaires/adaptateurs/*)
        │   mode PULL : webhook soustraitance.demande, il rappelle pour accepter
        │   ← referenceExterne, urlSuiviExterne
        ▼
  ④ LivraisonSousTraitee.statut = transmis
     Commande.statut            = expedier_par_amana
     HistoriqueStatutCommande   ← "Remis à AMANA (réf. AM123456789)"
        │
        │ ⑤ Le partenaire pousse ses statuts :
        │    PATCH /v1/sous-traitance/{referenceExterne}/statut
        │    → projection PUBLIC → INTERNE (§5.4)
        ▼
  ⑥a delivered  → Commande.livre + LigneReconciliationCod (montantAttendu)
  ⑥b returning  → Commande.en_retour_par_amana, puis retourne_au_hub
                   APRÈS scan physique de notre côté  (§6.5)
  ⑥c rejete     → LivraisonSousTraitee.actif = false, colis rebasculé (§6.4)
        │
        ▼
  ⑦ Réconciliation COD périodique (§7.7)
```

### 6.2 Éligibilité à la remise

Réutilise la mécanique de `lib/hub-envoi.ts`, qui construit déjà un index
`ville normalisée → hub` (`getVilleHubIndex()`) avec `normaliserVille()`. La
règle proposée, dans un nouveau `lib/partenaires/eligibilite.ts` :

```
éligible(colis, partenaire) ⟺
     partenaire.statut === 'actif'
  ∧  ∃ CouvertureVillePartenaire(partenaire, villeDe(colis)) avec actif = true
  ∧  (partenaire.plafondCod === null ∨ colis.montantCod ≤ partenaire.plafondCod)
  ∧  (partenaire.poidsMaxKg === null ∨ colis.poidsKg ≤ partenaire.poidsMaxKg)
  ∧  colis.statut ∈ { recu_au_hub, recu, ramasse, retourne_au_hub }
  ∧  colis.bonDistributionId === null      // pas déjà en tournée chez nous
  ∧  ¬ ∃ LivraisonSousTraitee(colis, actif = true)
```

La dernière condition est portée par un **index unique partiel** en base
(§11), pas seulement par le code : c'est la seule garantie qu'une double
soumission concurrente ne remette pas le même colis à deux transporteurs.

Les deux plafonds sont vérifiés **avant** transmission, et non laissés au
refus du partenaire : un rejet arrivant après que le colis est physiquement
parti est une opération de rattrapage manuelle, alors qu'un refus à
l'éligibilité est un simple message à l'écran.

### 6.3 Transmission : deux modes d'intégration

Le corps est **produit par l'adaptateur** (chaque transporteur a son dialecte),
mais le modèle canonique interne est symétrique de ce que nous acceptons en
entrée — ce qui rend un partenaire branché sur *notre* propre API intégrable
sans adaptateur spécifique (`adaptateur = "mathio"`).

**Mode PUSH (nominal)** — le partenaire a une API. Nous l'appelons :

```
POST {partenaire.baseUrlApi}/…
Idempotency-Key: {livraison.cleIdempotenceSortante}
→ 2xx { reference, tracking_url }
```

L'`Idempotency-Key` sortante est **indispensable** : sans elle, un timeout
réseau nous laisse dans l'ignorance de savoir si le colis a été créé chez eux,
et un rejeu crée un doublon physique. Elle est générée une fois, stockée
(`cleIdempotenceSortante`, unique) et rejouée à l'identique à chaque tentative.

**Mode PULL** — le partenaire n'a pas d'API appelable (cas fréquent des
réseaux régionaux). Nous émettons un webhook `soustraitance.demande` (§8.1),
et il vient chercher le travail :

```
GET  /v1/sous-traitance?status=pending          → les colis qui l'attendent
POST /v1/sous-traitance/{codeSuivi}/acceptation → il nous donne SA référence
```

C'est le seul cas où `{ref}` est notre `codeSuivi` : il n'a pas encore de
référence à lui. Après acceptation, tous les appels suivants utilisent
`referenceExterne` (§7.2).

**Minimisation** : on n'envoie **jamais** le nom du marchand ni son identité.
L'expéditeur déclaré est **Mathio Delivery** ; notre `codeSuivi` sert de
référence expéditeur. Le partenaire livre pour Mathio, pas pour le client de
Mathio (§10.2, et **D-3** en §14).

### 6.4 Rejet par le partenaire

Un partenaire peut refuser une remise (hors zone réelle, poids constaté, COD
au-dessus de son plafond) — soit en réponse directe au mode push, soit par un
`PATCH … {"status": "cancelled", "reason_code": "cancelled_by_carrier"}`.

Effet : `LivraisonSousTraitee.statut = rejete`, `actif = false`.
**`Commande.statut` ne bouge pas.** Le colis redevient immédiatement éligible
(§6.2) : autre partenaire, tournée interne, ou Bon de Retour marchand. Un
rejet n'est pas un incident métier, c'est une information de routage.

### 6.5 Retour physique

1. Partenaire → `PATCH … {"status": "returning"}` → `Commande.en_retour_par_amana`,
   `LivraisonSousTraitee.retour_en_cours`.
2. Le colis arrive au quai → **scan de réception existant**
   (`POST /api/commandes/scan-reception`, statut `recu_au_hub`,
   `hubActuelId` renseigné). Aucun code nouveau ; il faut seulement autoriser
   la transition `en_retour_par_amana → recu_au_hub`, aujourd'hui non prévue.
3. Le scan écrit `LivraisonSousTraitee.statut = retourne`, `actif = false`,
   `dateRetour`. C'est **le scan** qui clôt la ligne, pas le message du
   partenaire (§5.4, règle 2).
4. Le colis redevient éligible : nouvelle tentative chez nous, autre
   partenaire, ou Bon de Retour marchand.

**Point d'attention** : `app/api/commandes/[id]/statut/route.ts` verrouille
déjà quatre transitions au profit des modules dédiés (scan de ramassage, scan
de réception, Bon d'Envoi ×2). Les transitions de sous-traitance doivent
recevoir le même traitement — c'est-à-dire être **refusées** sur l'endpoint
générique pour tout rôle sauf `admin`, avec un message renvoyant vers
`/admin/partenaires`.

### 6.6 Annulation de notre côté

Un colis peut être annulé alors qu'il est déjà chez le partenaire (le marchand
annule, le client se rétracte). C'est le seul cas où **nous** devons prévenir
**lui**, et il est urgent : chaque heure de retard est une livraison qui part.

1. Back-office → `LivraisonSousTraitee.statut = annule`, `actif = false`.
2. Appel sortant d'annulation via l'adaptateur (mode push).
3. **Et** webhook `soustraitance.annulee` (§8.1), systématiquement — y compris
   en mode push, où il sert de filet si l'appel direct a échoué.
4. `Commande.statut = annule_par_vendeur`, `motifRetour` obligatoire (RG-04 :
   `STATUTS_REQUIS_MOTIF` inclut déjà `annule_par_vendeur`).

Si le partenaire a déjà livré au moment où l'annulation lui parvient, son
`delivered` fait foi : `occurred_at` tranche (§7.4). Le colis est livré, la
ligne de réconciliation est créée, et l'annulation est caduque — c'est la
seule lecture cohérente d'un événement physique déjà survenu.

---

## 7. Référence des endpoints

**Racine** : `https://api.<domaine-métier>/v1`

Toute l'API entrante tient en **quatre familles** et une seule écriture de
statut. C'est la mesure directe du périmètre sortant : un partenaire ne crée
rien, ne supprime rien, et ne pilote rien de notre logistique.

| Capacité | Scope requis | Endpoint |
|---|---|---|
| Lister les colis qu'on lui a confiés | `soustraitance_lecture` | `GET /v1/sous-traitance` |
| Consulter une remise | `soustraitance_lecture` | `GET /v1/sous-traitance/{ref}` |
| Accepter une remise (mode pull) | `soustraitance_statut_ecriture` | `POST /v1/sous-traitance/{ref}/acceptation` |
| **Pousser un statut** | `soustraitance_statut_ecriture` | `PATCH /v1/sous-traitance/{ref}/statut` |
| Réimprimer l'étiquette | `etiquettes_lecture` | `GET /v1/sous-traitance/{ref}/etiquette` |
| Déclarer sa couverture | `reseau_ecriture` | `GET\|PUT /v1/reseau/couverture` |
| Relevés COD | `cod_lecture` | `GET /v1/cod/releves`, `…/lignes` |
| Déclarer / valider un relevé | `cod_reconciliation` | `POST /v1/cod/releves/{id}/…` |
| Gérer ses webhooks | `webhooks_gestion` | `GET\|POST\|DELETE /v1/webhooks` |

**En-têtes communs (requête)** :

| En-tête | Obligatoire | Rôle |
|---|---|---|
| `Authorization: Bearer mtk_live_…` | oui | Clé d'API (§3.5) |
| `Content-Type: application/json` | sur écriture | Rejeté sinon (`415`) |
| `Idempotency-Key` | sur `POST` | UUID v4, cf. §9.1 |
| `Mathio-Version` | non | Épinglage de version (§9.3) |
| `Accept-Language` | non | `fr` (défaut) \| `ar` \| `en` — affecte les libellés |

**En-têtes communs (réponse)** : `X-Request-Id`, `Mathio-Version`,
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`,
`Retry-After` (sur `429`).

### 7.0 Enveloppe d'erreur

L'application interne répond `{ "error": "message" }` (`jsonError()`,
`lib/api-utils.ts`). L'API Partenaires utilise une enveloppe **structurée**,
car un intégrateur doit pouvoir brancher sa logique sur un code stable, pas sur
une chaîne française susceptible d'être reformulée :

```jsonc
{
  "error": {
    "code": "invalid_transition",
    "message": "La combinaison status=cancelled / reason_code=cancelled_by_shipper n'est pas acceptée.",
    "field": "reason_code",
    "details": { "accepted": ["cancelled_by_carrier"] },
    "request_id": "req_01J8XQ2M5K7N9P"
  }
}
```

| HTTP | `code` | Quand |
|---|---|---|
| 400 | `invalid_request` | JSON malformé, champ de type incorrect |
| 401 | `missing_api_key` | En-tête `Authorization` absent |
| 401 | `invalid_api_key` | Clé inconnue, expirée ou révoquée |
| 403 | `insufficient_scope` | Clé valide, scope manquant |
| 403 | `partner_suspended` | `PartenaireTransport.statut = suspendu` |
| 403 | `ip_not_allowed` | IP hors `ipAutorisees` |
| 404 | `delivery_not_found` | Inconnu **ou** hors périmètre du partenaire (§10.1) |
| 409 | `duplicate_reference` | `referenceExterne` déjà attribuée à un autre colis (§2.4) |
| 409 | `delivery_locked` | Remise déjà close (`actif = false`) |
| 409 | `idempotency_key_reuse` | Même clé, corps différent (§9.1) |
| 409 | `request_in_progress` | Même clé, traitement en cours |
| 415 | `unsupported_media_type` | `Content-Type` ≠ `application/json` |
| 422 | `invalid_transition` | Couple `status`/`reason_code` absent de §5.4 |
| 422 | `proof_required` | `delivered` sans `proof` (§5.4, règle 3) |
| 422 | `unknown_city` | Ville hors référentiel `Ville` (déclaration de couverture) |
| 429 | `rate_limited` | Quota dépassé (§9.4) |
| 500 | `internal_error` | Toujours accompagné d'un `request_id` |

### 7.1 `GET /v1/sous-traitance` — les colis qu'on lui a confiés

Scope `soustraitance_lecture`. Liste paginée par curseur (§9.2).

Filtres : `status` (valeur publique ou `pending` pour les remises en attente
d'acceptation), `city`, `handed_over_after`, `handed_over_before`,
`reference` (sa référence).

```jsonc
{
  "data": [{
    "id": "PD-000123",                     // notre codeSuivi
    "reference": "AM123456789",            // SA référence, null si pas encore acceptée
    "carrier_status": "in_transit",
    "platform_status": "in_transit",       // cf. §5.5
    "recipient": {
      "name": "Youssef El Amrani",
      "phone": "0612345678",
      "city": "Casablanca",
      "address": "12 rue Ibn Batouta, Maârif",
      "postal_code": "20250"
    },
    "parcel": { "description": "Casque audio sans fil", "quantity": 1,
                "weight_kg": "0.80", "allow_open": true },
    "cod": { "amount": "349.00", "currency": "MAD", "collect": true },
    "shipper": { "name": "Mathio Delivery" },   // JAMAIS le marchand (§10.2)
    "label_url": "https://api.example.ma/v1/sous-traitance/PD-000123/etiquette",
    "handed_over_at": "2026-08-21T09:12:44Z",
    "livemode": true
  }],
  "page": { "has_more": false, "next_cursor": null }
}
```

C'est le **seul** endroit où les coordonnées du destinataire sortent, et c'est
inévitable : sans elles, le partenaire ne peut pas livrer. Tout le reste de la
minimisation (§10.2) tient à ce que rien d'autre ne les accompagne — ni le
marchand, ni les autres colis du même destinataire, ni notre coût.

### 7.2 `GET /v1/sous-traitance/{ref}` — détail d'une remise

Scope `soustraitance_lecture`. `{ref}` accepte **sa** `referenceExterne` ou
notre `codeSuivi`, résolus dans son seul périmètre (§10.3) → `404` sinon.

Même objet qu'en §7.1, plus :

```jsonc
{
  "carrier_status_detail": {
    "status": "attempt_failed", "reason_code": "no_answer",
    "occurred_at": "2026-08-22T11:15:30Z"       // son dernier push, tel quel
  },
  "cancelled_by_platform": false,               // §6.6 — à surveiller
  "return_acknowledged_at": null                // rempli au scan physique (§6.5)
}
```

Les deux derniers champs sont la raison d'être de cet endpoint pour un
partenaire : savoir si nous avons annulé, et si nous avons accusé réception de
son retour. Il n'y a **pas** d'historique d'événements — après la remise,
l'historique du colis est le sien (§1.2).

### 7.3 `POST /v1/sous-traitance/{ref}/acceptation` — mode pull

Scope `soustraitance_statut_ecriture`. `Idempotency-Key` obligatoire.
`{ref}` est ici notre `codeSuivi` : le partenaire n'a pas encore de référence.

```jsonc
{ "reference": "AM123456789",
  "tracking_url": "https://suivi.partenaire.ma/AM123456789",
  "accepted_at": "2026-08-21T09:20:00Z" }
```

- Accepté seulement si `LivraisonSousTraitee.statut = a_transmettre` →
  `409 delivery_locked` sinon.
- `reference` déjà utilisée par une autre remise du même partenaire →
  `409 duplicate_reference` (contrainte `@@unique([partenaireId, referenceExterne])`,
  §2.4). C'est la base qui tranche, pas une pré-vérification applicative.
- Effet : `referenceExterne`, `urlSuiviExterne`, `dateTransmission`,
  `statut = transmis`, `Commande.statut = expedier_par_amana`, ligne
  d'`HistoriqueStatutCommande`.

Un refus se fait par `PATCH …/statut` avec `cancelled` /
`cancelled_by_carrier` (§6.4) — il n'y a pas d'endpoint de rejet séparé, pour
que tous les refus passent par la même projection.

### 7.4 `PATCH /v1/sous-traitance/{ref}/statut` — **le** endpoint

Scope `soustraitance_statut_ecriture`. C'est la seule écriture de statut de
toute l'API, et la seule surface par laquelle un tiers touche `Commande`.

```jsonc
{
  "status": "delivered",
  "reason_code": null,
  "reason_detail": null,
  "occurred_at": "2026-08-23T14:05:00Z",
  "cod": { "collected": true, "amount": "349.00", "currency": "MAD" },
  "proof": { "type": "signature", "recipient_name": "Y. E.",
             "captured_at": "2026-08-23T14:04:12Z",
             "data": "data:image/png;base64,iVBORw0…" }
}
```

Règles :

- `{ref}` est résolu **dans le périmètre du partenaire seul**
  (`LivraisonSousTraitee.partenaireId = ctx.partenaireId AND actif`) → `404`
  sinon. Une remise close (`actif = false`, après rejet, retour ou annulation)
  répond `409 delivery_locked` : elle a existé, elle n'accepte plus rien.
- `occurred_at` **antérieur** à `dernierEvenementLe` → `200` sans effet, avec
  `"applied": false, "reason": "stale_event"`. Les envois arrivent dans le
  désordre ; un statut ne doit jamais reculer. **C'est ce contrôle qui rend
  l'endpoint naturellement idempotent** et qui dispense d'exiger un
  `Idempotency-Key` sur ce `PATCH` (§9.1).
- Couple `status`/`reason_code` absent de §5.4 → `422 invalid_transition` avec
  la liste des valeurs acceptées. Jamais de défaut silencieux (§5.7).
- Projection selon §5.4, dans **une seule transaction** : mise à jour de
  `LivraisonSousTraitee`, éventuellement de `Commande.statut`, et création de
  la ligne `HistoriqueStatutCommande` correspondante (RG-10 ne souffre aucune
  exception, y compris pour un changement d'origine machine ; l'auteur est
  l'`Utilisateur` système du back-office, l'acte étant tracé par ailleurs dans
  `JournalApiPartenaire`).
- `delivered` sans `proof` → `422 proof_required` (§5.4, règle 3).
- `delivered` + `cod.collected = true` → `montantCodEncaisse` renseigné et
  ligne de réconciliation créée ou mise à jour (§7.7). Un écart entre
  `cod.amount` et `montantCodConfie` n'est **pas** une erreur ici : il est
  enregistré et deviendra une ligne litigieuse au relevé, où il pourra être
  discuté avec les pièces.

### 7.5 `GET /v1/sous-traitance/{ref}/etiquette`

Scope `etiquettes_lecture`. `?format=pdf|png|zpl|json` (défaut `pdf`).

Façade directe sur `buildParcelLabel()` (`lib/parcel-label.ts`) : `serial`,
`qrPayload`, `qrSvg`, `barcodeSvg` sont déjà produits (§2.3). Le format `json`
renvoie ces éléments bruts, pour un partenaire qui compose sa propre planche :

```jsonc
{
  "id": "PD-000123",
  "serial": "CAS-RBIEC9-210826",
  "qr_payload": "CAS-RBIEC9-210826.7G",
  "barcode_value": "PD-000123",
  "formats": { "pdf": "…/etiquette?format=pdf", "zpl": "…/etiquette?format=zpl" }
}
```

Le format `zpl` (Zebra) est le seul ajout réel à produire : les partenaires
impriment sur des imprimantes thermiques industrielles, pas depuis un
navigateur. `PARCEL_SERIAL_SALT_KEY` reste strictement serveur — le QR est
**vérifiable** par nos scanners (`validateQrPayload()`) et **non forgeable** par
le partenaire, ce qui est exactement la garantie recherchée quand un tiers
imprime nos étiquettes.

### 7.6 `GET | PUT /v1/reseau/couverture` — sa couverture, pas la nôtre

Scope `reseau_ecriture`. **L'inversion par rapport à une API bidirectionnelle
est le point important** : nous n'exposons rien de notre réseau (§10.2), c'est
le partenaire qui déclare où il livre. Ce qu'il déclare alimente
`CouvertureVillePartenaire` et donc l'éligibilité (§6.2).

```jsonc
// PUT — remplacement complet de la couverture déclarée
{
  "cities": [
    { "name": "Tiznit",  "delivery_days": 2, "cod_supported": true,  "max_cod": "3000.00" },
    { "name": "Tafraout", "delivery_days": 3, "cod_supported": false }
  ]
}
```

- Chaque `name` est résolu par `normaliserVille()` (`lib/hub-stock.ts`) contre
  le référentiel `Ville` → `422 unknown_city` avec `details.unresolved` listant
  les entrées rejetées. Le `PUT` est **atomique** : une seule ville non résolue
  et rien n'est appliqué. Une couverture à moitié appliquée enverrait des colis
  dans des villes que le partenaire croit avoir retirées.
- `PUT` est un **remplacement**, pas une fusion : les villes absentes du corps
  passent `actif = false` plutôt que d'être supprimées, pour conserver
  l'historique des remises déjà faites vers elles.
- `coutHt` n'est ni lu ni renvoyé : un partenaire ne fixe pas seul le prix
  qu'on lui paie (§4.4), et ne doit pas connaître ce qu'on paie aux autres
  (§10.2).
- `GET` renvoie ce qui est **effectivement en vigueur** côté back-office, qui
  peut différer de sa dernière déclaration si un administrateur a désactivé une
  ville. C'est délibéré : la vérité de l'éligibilité est chez nous.

### 7.7 Réconciliation COD

Le sens est toujours le même : il a encaissé, il nous doit (§4.7).

**`GET /v1/cod/releves`** — scope `cod_lecture`.

```jsonc
{
  "data": [{
    "id": "REC-2026-08-001",
    "status": "issued",
    "period": { "from": "2026-08-01", "to": "2026-08-15" },
    "parcel_count": 412,
    "expected_amount": "148320.00",
    "declared_amount": null,
    "currency": "MAD",
    "due_date": "2026-08-22",
    "lines_url": "…/v1/cod/releves/REC-2026-08-001/lignes"
  }],
  "page": { "has_more": false, "next_cursor": null }
}
```

**`GET /v1/cod/releves/{id}/lignes`** — une ligne par colis :
`{ parcel_id, reference, delivered_at, expected_amount, declared_amount, variance, disputed }`.

**`POST /v1/cod/releves/{id}/declaration`** — scope `cod_reconciliation`,
`Idempotency-Key` **obligatoire** : rejouée, une déclaration compterait deux
fois (§9.1). Le partenaire déclare ce qu'il a réellement encaissé, colis par
colis :

```jsonc
{
  "declared_total": "147890.00",
  "lines": [
    { "parcel_id": "PD-000123", "declared_amount": "349.00" },
    { "parcel_id": "PD-000456", "declared_amount": "0.00",
      "dispute_reason": "Colis retourné le 14/08, jamais livré" }
  ],
  "payment_reference": "VIR-2026-08-19-778"
}
```

Réponse : `ecart` par ligne, `litige = true` sur chaque divergence, statut du
relevé `conteste` s'il en reste au moins une, `valide` sinon.

**`POST /v1/cod/releves/{id}/validation`** — accord formel des deux parties.
Écrit un `AuditLog` (`action = 'reconciliation_cod.validation'`,
`partenaireId` renseigné, §4.8) et génère la `Transaction` comptable
(§ `/admin/comptabilite`, `categorie = paiement_client`, `type = revenu`).
Une fois validé, le relevé est **immuable** : toute correction ultérieure passe
par une ligne d'ajustement dans le relevé suivant.

**Génération des relevés** : tâche planifiée, jamais à la demande du
partenaire. Un relevé agrège les `LigneReconciliationCod` dont la
`LivraisonSousTraitee` est passée `livre` dans la période, en excluant les
remises `estTest`.

### 7.8 Gestion des webhooks

| Méthode | Chemin | Effet |
|---|---|---|
| `GET` | `/v1/webhooks` | Liste des endpoints (jamais le secret) |
| `POST` | `/v1/webhooks` | Crée un endpoint ; **le secret n'est renvoyé qu'ici, une fois** |
| `POST` | `/v1/webhooks/{id}/rotation` | Nouveau secret ; l'ancien reste valide 48 h |
| `DELETE` | `/v1/webhooks/{id}` | Désactive (`suspendu`), ne supprime jamais la ligne |
| `GET` | `/v1/webhooks/{id}/livraisons` | Journal des envois (`LivraisonWebhook`), 7 jours |
| `POST` | `/v1/webhooks/{id}/rejeu` | Rejoue un ou plusieurs événements par `event_id` |

Scope `webhooks_gestion`. `POST` exige un `Idempotency-Key` (§9.1).

---

## 8. Webhooks

Dans un flux sortant, **c'est le partenaire qui nous informe**, pas l'inverse.
Le catalogue est donc court, et chaque entrée répond à une question précise :
qu'est-ce que *nous* savons qu'il ignore et qui change ce qu'il doit faire ?

### 8.1 Catalogue d'événements

| Type | Déclencheur | Pourquoi il existe |
|---|---|---|
| `soustraitance.demande` | Une remise passe `a_transmettre` | Mode **pull** (§6.3) : sans lui, il devrait interroger `GET /v1/sous-traitance?status=pending` en boucle |
| `soustraitance.annulee` | Nous annulons un colis qu'il détient (§6.6) | **Le plus important** : chaque heure de retard est une livraison qui part pour rien |
| `cod.releve_emis` | Nouveau relevé disponible | Évite un polling quotidien sur `GET /v1/cod/releves` |
| `cod.releve_valide` | Relevé validé, règlement attendu | Déclenche son virement |

Il n'y a **pas** d'événement de changement de statut : après la remise, le
statut du colis, c'est lui qui nous l'apprend. Un `colis.statut_modifie` dans
ce sens n'aurait rien à dire — et c'est ce qui rend la machinerie de webhooks
beaucoup plus légère que dans une API bidirectionnelle.

Un événement inconnu du receveur **doit être ignoré silencieusement avec un
`2xx`**, jamais rejeté : c'est ce qui nous permet d'ajouter un type sans casser
l'existant. C'est aussi pourquoi `EndpointWebhook.evenements` est un
`String[]` et non un enum (§4.6).

### 8.2 Enveloppe

```jsonc
{
  "id": "evt_01J8XQ2M5K7N9PQRSTUVWX",       // = LivraisonWebhook.evenementId
  "type": "soustraitance.annulee",
  "api_version": "2026-08-21",
  "created_at": "2026-08-23T14:05:02Z",
  "livemode": true,
  "data": {
    "object": "subcontracted_delivery",
    "id": "PD-000123",
    "reference": "AM123456789",
    "carrier_status": "annule",
    "reason": "Commande annulée par le vendeur",
    "occurred_at": "2026-08-23T14:05:00Z"
  }
}
```

`livemode: false` sur les remises `estTest` (§4.5) — c'est le seul marqueur qui
distingue un événement de bac à sable, et il doit être présent dès la première
version pour ne pas devenir une rupture plus tard.

### 8.3 Signature HMAC

```
X-Mathio-Signature: t=1755958502,v1=5f2b8c1d…,v1=9a3e7f04…
X-Mathio-Event-Id: evt_01J8XQ2M5K7N9PQRSTUVWX
X-Mathio-Delivery: 3
```

- Charge signée : `"{t}.{corps_brut}"`, HMAC-SHA256 avec le secret de
  l'endpoint, en hexadécimal minuscule.
- **`t` fait partie de la charge signée** : sans lui, une signature valide
  capturée reste rejouable indéfiniment. Le receveur doit rejeter tout
  `|now − t| > 300 s`.
- **Plusieurs `v1` possibles** pendant une rotation de secret : l'ancien et le
  nouveau sont envoyés conjointement pendant 48 h
  (`EndpointWebhook.secretPrecedentChiffre`), ce qui permet au partenaire de
  basculer sans coupure. Le receveur accepte si **au moins une** correspond.
- Comparaison en **temps constant** obligatoire côté receveur — c'est le même
  raisonnement que `validateQrPayload()` (`lib/parcel-serial.ts`), et il doit
  figurer dans la documentation d'intégration.
- Le corps doit être vérifié **avant** désérialisation, sur les octets bruts :
  un `JSON.parse` suivi d'un `JSON.stringify` ne reproduit pas nécessairement
  les mêmes octets (ordre des clés, échappement Unicode, précision décimale).

**Pourquoi le secret est chiffré et non haché** (§4.6) : nous devons le
**rejouer** à chaque envoi. C'est la différence de nature avec les clés d'API,
qu'on ne fait que *vérifier*. Un secret de webhook haché serait inutilisable.
D'où `PARTNER_SECRET_ENC_KEY` (§12) — clé de chiffrement AES-256-GCM, distincte
d'`AUTH_SECRET` : les deux ont des cycles de rotation et des surfaces
d'exposition différents.

### 8.4 Retry et backoff

Succès = **`2xx` en moins de 10 s**. Tout le reste (`4xx`, `5xx`, timeout,
erreur TLS, DNS) est un échec et déclenche une nouvelle tentative.

| Tentative | Délai après l'échec précédent | Cumul |
|---|---|---|
| 1 | immédiat | 0 |
| 2 | 30 s | 30 s |
| 3 | 2 min | ~2,5 min |
| 4 | 10 min | ~13 min |
| 5 | 1 h | ~1 h 13 |
| 6 | 6 h | ~7 h |
| 7 | 24 h | ~31 h |
| 8 | 24 h | ~55 h |

Après la 8ᵉ tentative : `LivraisonWebhook.abandonneLe` renseigné. L'événement
reste rejouable manuellement (`POST /v1/webhooks/{id}/rejeu`) et reste visible
dans le journal 7 jours.

**Jitter** : ±20 % aléatoire sur chaque délai. Sans lui, une panne côté
partenaire fait revenir tous les webhooks en attente exactement en même temps
au rétablissement, et le remet à terre (effet *thundering herd*).

**Coupe-circuit** : 20 échecs consécutifs → `statut = suspendu`, `suspenduLe`
renseigné, alerte au back-office. Les événements continuent d'être **enfilés**
(lignes `LivraisonWebhook` créées) mais plus tentés. La réactivation est
manuelle et rejoue la file dans l'ordre chronologique.

**Cas particulier de `soustraitance.annulee`.** C'est le seul événement dont
l'échec a une conséquence physique : le partenaire livre un colis annulé. Un
endpoint suspendu **doit donc lever une alerte back-office immédiate** dès
qu'une annulation entre en file, et non attendre la 8ᵉ tentative. La coupure du
canal automatique impose un appel téléphonique, pas une ligne de journal.

**Ordre** : les envois d'un même endpoint sont sérialisés **par colis**, pas
globalement — sérialiser tout un endpoint ferait qu'un seul colis lent bloque
les autres. L'ordre global n'est donc **pas** garanti, ce que `occurred_at`
permet au receveur de rattraper.

### 8.5 Idempotence côté receveur

À écrire tel quel dans la documentation d'intégration :

1. Vérifier la signature sur le **corps brut** (§8.3).
2. Vérifier `|now − t| ≤ 300 s`.
3. Si `id` (`evt_…`) a déjà été traité → répondre `200` **sans retraiter**.
   `evenementId` est stable à travers toutes les tentatives : c'est *la* clé de
   déduplication.
4. Répondre `2xx` **avant** tout traitement long (mettre en file). Un traitement
   qui dépasse 10 s provoque un timeout de notre côté, donc un renvoi, donc un
   doublon.
5. Si `occurred_at` est antérieur au dernier événement connu pour ce colis →
   ignorer. Même règle que celle que **nous** appliquons en §7.4.

La garantie est **au moins une fois**, jamais exactement une fois. Un receveur
qui n'implémente pas le point 3 aura des doublons — c'est une propriété du
transport HTTP, pas un défaut de l'émetteur.

---

## 9. Robustesse : idempotence, pagination, versionnement, quotas

### 9.1 Trois clés, trois rôles distincts

C'est la confusion la plus fréquente sur ce type d'API. Le périmètre sortant en
fait intervenir **trois**, dont une dans l'autre sens :

| | `Idempotency-Key` (entrante) | `reference` → `referenceExterne` | `cleIdempotenceSortante` |
|---|---|---|---|
| Nature | Technique | **Métier** | Technique |
| Sens | Eux → nous | Eux → nous | **Nous → eux** |
| Portée | Une requête HTTP | Un colis, pour toujours | Une remise |
| Durée | 24 h (`RequeteIdempotente.expireLe`) | Permanente | Permanente |
| Protège de | Leur rejeu réseau | Deux colis portant la même référence | **Notre** rejeu après timeout |
| Support | `RequeteIdempotente` (§4.8) | `@@unique([partenaireId, referenceExterne])` (§2.4) | `@unique` sur la colonne (§4.5) |
| En cas de collision | Renvoie **la même réponse** (`200`, en-tête `Idempotent-Replay: true`) | **`409 duplicate_reference`** | Le partenaire renvoie sa réponse initiale |
| Obligatoire ? | Sur `POST` uniquement | Oui, à l'acceptation | Toujours |

La troisième est celle qu'on oublie, et c'est la plus coûteuse : sans elle, un
timeout réseau pendant la remise nous laisse ignorer si le colis a été créé
chez eux. Rejouer crée un doublon **physique** — deux étiquettes, deux
livreurs, un colis introuvable. Elle est générée une fois, stockée, et rejouée
à l'identique.

**Ce qui n'a PAS besoin d'`Idempotency-Key`** : le `PATCH …/statut` (§7.4). Le
contrôle d'antériorité sur `occurred_at` le rend idempotent par construction —
rejouer le même événement ne fait rien, et un événement plus ancien est
explicitement ignoré. Exiger la clé là aurait été du cérémonial sans gain, et
aurait alourdi le seul endpoint appelé en volume.

**Protocole précis** sur les `POST` :

```
POST + Idempotency-Key: 7c9e6679-…
  │
  ├─ pas de ligne → INSERT RequeteIdempotente(etat='en_cours', empreinteCorps=H)
  │                 traiter → UPDATE(etat='terminee', statutHttp, reponse)
  │
  ├─ ligne etat='en_cours'                       → 409 request_in_progress
  ├─ ligne etat='terminee' ∧ empreinteCorps = H  → rejouer la réponse stockée
  │                                                 + Idempotent-Replay: true
  └─ ligne etat='terminee' ∧ empreinteCorps ≠ H  → 409 idempotency_key_reuse
```

L'`INSERT` initial s'appuie sur `@@unique([partenaireId, cle])` : c'est la
contrainte PostgreSQL qui sérialise deux appels concurrents, pas un verrou
applicatif. Même raisonnement que le `ON CONFLICT` de `checkRateLimit()`
(`lib/rate-limit.ts`), dont le commentaire précise que *« le verrouillage de
ligne PostgreSQL sur ON CONFLICT évite qu'une rafale de requêtes concurrentes
ne contourne la limite »*.

`empreinteCorps` = SHA-256 du corps JSON **canonicalisé** (clés triées, espaces
normalisés) : sans canonicalisation, un client qui sérialise ses clés dans un
ordre non déterministe recevrait des `409` fantômes.

### 9.2 Pagination par curseur

Les routes internes paginent par **offset** (`app/api/commandes/route.ts` :
`page`, `pageSize`, `skip`, `take`) — parfaitement adapté à un tableau
d'interface qui affiche « page 3 sur 47 ».

`GET /v1/sous-traitance` utilise un **curseur opaque**, pour trois raisons :

1. **Dérive de fenêtre** : un partenaire qui parcourt ses remises pendant que
   nous en créons de nouvelles voit, avec un offset, certaines lignes deux fois
   et en manque d'autres. Un curseur ancré sur `(creeLe, id)` est insensible
   aux insertions.
2. **Coût** : `OFFSET 19000` fait scanner et jeter 19 000 lignes à PostgreSQL à
   chaque appel.
3. **Pas de `count`** : un `count()` sur le périmètre entier d'un partenaire à
   chaque page est un coût pur perte — un intégrateur veut *itérer*, pas
   afficher un numéro de page.

```
GET /v1/sous-traitance?limit=100&cursor=eyJkIjoiMjAyNi0wOC0yMVQwOToxMjo0NFoiLCJpIjoiUEQtMDAwMTIzIn0
```

```jsonc
{
  "data": [ /* … */ ],
  "page": { "has_more": true,
            "next_cursor": "eyJkIjoiMjAyNi0wOC0yMlQxMToxNTozMFoi…" }
}
```

`limit` : 1–200, défaut 50. Le curseur encode `{ d: creeLe, i: id }` en
base64url ; il est **opaque par contrat** — sa structure peut changer sans
préavis. Tri par `(creeLe DESC, id DESC)`, stable car `id` est unique.
Index requis : `@@index([partenaireId, creeLe, id])` sur
`livraisons_sous_traitees`, posé par la migration 2 (§11).

### 9.3 Versionnement

**Deux niveaux**, empruntés à la pratique établie :

1. **Majeure dans le chemin** : `/v1/…`. Change uniquement pour une rupture
   structurelle (renommage de ressource, changement de modèle
   d'authentification). Deux majeures cohabitent au moins 12 mois.
2. **Mineure par date** : en-tête `Mathio-Version: 2026-08-21`. Couvre les
   ruptures locales : ajout d'une valeur de `reason_code`, suppression d'un
   champ, changement de format d'un champ.

**Épinglage automatique** : `CleApiPartenaire.versionEpinglee` est fixée à la
date de création de la clé. Un partenaire intégré en 2026 continue de recevoir
le format de 2026 tant qu'il ne bouge pas — y compris dans ses **webhooks**
(`api_version` dans l'enveloppe, §8.2). L'en-tête `Mathio-Version` permet de
tester une version plus récente sans changer de clé.

**Ce qui n'est PAS une rupture** : ajout d'un champ optionnel en réponse, ajout
d'un type de webhook, ajout d'un endpoint, ajout d'une valeur de `reason_code`
**sur un `status` existant**.

**Ce qui EST une rupture** : ajout ou retrait d'une valeur de `status`,
changement de projection d'un statut, retrait d'un champ, resserrement d'une
validation. C'est précisément pour absorber le premier cas sans rupture que
`reason_code` est séparé de `status` (§5.2).

**Asymétrie importante** : dans le sens **entrant** (§5.4), ajouter une valeur
de `status` acceptée n'est pas une rupture (personne ne l'envoyait), mais en
**retirer** une l'est immédiatement — le partenaire qui l'envoyait se met à
recevoir des `422`. Le tableau §5.4 est donc plus figé que le tableau §5.3.

### 9.4 Quotas

Réutilisation directe de `checkRateLimit()` (`lib/rate-limit.ts`), sans
modification :

| Portée | Clé | Défaut |
|---|---|---|
| Global par clé | `api:<prefixe>:min` | 600 req/min |
| Écritures de statut | `api:<prefixe>:statut:min` | 300 req/min |
| Étiquettes | `api:<prefixe>:label:min` | 60 req/min |
| Déclaration de couverture | `api:<prefixe>:reseau:h` | 10/h |
| Auth en échec par IP | `api:auth-fail:<ip>` | 20/min |

Le dernier compteur est le plus important pour la sécurité : sans lui, une clé
peut être devinée par force brute sur le préfixe. Il est indexé sur l'**IP**,
pas sur la clé — une clé invalide n'a pas de titulaire à qui imputer le quota.

`CleApiPartenaire.quotaParMinute` surcharge le défaut global. Réponse `429` avec
`Retry-After` (déjà produit par `rateLimitedResponse()`), plus les trois
en-têtes `RateLimit-*` sur **toutes** les réponses — un intégrateur doit
pouvoir ralentir *avant* d'être bloqué.

**Purge.** Le commentaire de `RateLimitEntry` note qu'il n'y a *« pas de purge
automatique des entrées expirées pour l'instant (volumétrie faible attendue) —
à revoir si la table grossit significativement »*. L'API Partenaires **fait
franchir ce seuil** : quelques clés × plusieurs compteurs × fenêtres glissantes
génèrent des milliers de lignes par jour. Une tâche de purge
(`DELETE FROM rate_limit_entries WHERE fenetre_debut < now() - interval '1 day'`)
devient un prérequis, pas une option.

### 9.5 Journalisation

Une ligne `JournalApiPartenaire` par requête (§4.8), rétention 30 jours,
**sans le corps** (il peut porter le nom du destinataire dans une preuve).
`X-Request-Id` est renvoyé sur **toutes** les réponses, erreurs comprises, et
repris dans `error.request_id` : c'est la seule référence qu'un partenaire doit
nous communiquer pour un incident.

`AuditLog` (§4.8) reçoit uniquement les actes sensibles :
`soustraitance.remise`, `soustraitance.annulation`, `cle_api.creation`,
`cle_api.rotation`, `cle_api.revocation`, `webhook.rotation_secret`,
`reconciliation_cod.validation`, `partenaire.suspension`.

---

## 10. Sécurité et cloisonnement

### 10.1 Principes

1. **Un partenaire ne voit que les colis qu'on lui a confiés.** Aucun endpoint
   ne permet de parcourir un périmètre plus large — et il n'existe aucun
   endpoint donnant accès à `Commande` autrement que par une
   `LivraisonSousTraitee` qui lui appartient.
2. **404 plutôt que 403** sur un objet hors périmètre. Un `403` confirme
   l'existence de l'objet — c'est exactement la logique déjà appliquée par
   `proxy.ts` §3 : *« 404 (et non 403) pour ne rien révéler de l'arborescence
   des autres espaces »*.
3. **Liste blanche de champs**, jamais liste noire. La projection publique
   énumère les champs autorisés ; ajouter une colonne à `Commande` ne peut donc
   pas la faire fuir par inadvertance. Une liste noire aurait exactement ce
   défaut.
4. **Aucune donnée personnelle dans les journaux.** `JournalApiPartenaire` ne
   stocke qu'une empreinte de corps.

### 10.2 Ce qui ne doit JAMAIS sortir

| Donnée | Où elle vit | Pourquoi |
|---|---|---|
| Identité du marchand | `Marchand.nomBoutique`, `raisonSociale`, `iceRc`, `rib` | Un partenaire est aussi un concurrent : lui donner notre portefeuille clients, c'est lui donner sa liste de prospection |
| Autres colis du même destinataire | `Commande` (même `clientTelephone`) | Recoupement commercial |
| Colis **non** confiés à ce partenaire | `Commande` | Volume, saisonnalité, zones fortes : tout notre plan de charge |
| Identité du livreur | `Utilisateur.nomComplet`, `telephone`, `cin`, `photoUrl` | Personnel identifiable ; risque de débauchage et de mise en cause directe |
| Rémunération terrain | `fraisLivraison`, `fraisRefus`, `TarifLivreurVille`, `BonDistribution.gainLivreur` | Structure de coûts |
| Caisse et écarts | `BonDistribution.montantRemis`, `ecartCaisse`, `montantCrbtAttendu` | Interne comptable |
| Topologie du réseau | `Hub.adresse`, `telephone`, `isCentral`, nombre de hubs | Renseignement concurrentiel. **Dans ce périmètre, nous n'exposons aucun endpoint de réseau** (§7.6) |
| Statuts internes bruts | les 31 valeurs de `StatutCommande` | §5.1 |
| Notes internes | `HistoriqueStatutCommande.note`, `CommentaireCommande.texte` | Texte libre d'agents, non revu |
| Historique de statuts | `HistoriqueStatutCommande` | **Aucun endpoint ne l'expose** (§1.2) : le rang des tentatives d'appel révélerait notre cadence opérationnelle |
| Liste noire | `ListeNoire`, `Commande.aRisque` | En révéler le contenu la rend contournable |
| Preuves brutes en sortie | `signatureUrl`, `photoPreuveUrl`, `cinUrl` (data-URL) | Volume + données biométriques/CIN. URL signée 15 min seulement (§5.8) |
| Coûts partenaires | `CouvertureVillePartenaire.coutHt`, `LivraisonSousTraitee.coutTransport` | Marges ; et surtout, ce qu'on paie **aux autres** partenaires |

### 10.3 Cloisonnement effectif

Le périmètre sortant simplifie radicalement le cloisonnement : il n'y a
**qu'une seule racine**, `LivraisonSousTraitee`.

```ts
// lib/partenaires/scope.ts
export function scopePartenaire(
  ctx: PartenaireContext
): Prisma.LivraisonSousTraiteeWhereInput {
  return {
    partenaireId: ctx.partenaireId,
    estTest: ctx.environnement === 'test',   // cloisonnement live/test
  };
}
```

**Règle de revue de code, sans exception : aucune requête de l'API Partenaires
ne doit interroger `prisma.commande` directement.** Toute donnée de colis est
atteinte par `include: { commande: … }` depuis une `LivraisonSousTraitee` déjà
filtrée par ce helper. C'est plus fort que la défense en profondeur d'une API
bidirectionnelle (qui devait croiser deux colonnes) : ici, il n'existe
simplement pas de chemin d'accès parallèle. Une revue peut vérifier la règle
par un `grep` sur `app/api/v1/**`.

Corollaire : la sélection de champs de `commande` doit être **explicite**
(`select`, jamais `include` nu), pour tenir la liste blanche de §10.1.

### 10.4 Surface d'attaque du nouvel hôte

| Vecteur | Défense |
|---|---|
| Force brute sur les clés | Préfixe 32 bits + secret 256 bits ; quota `api:auth-fail:<ip>` ; `timingSafeEqual` |
| Fuite de clé (dépôt Git) | Préfixe `mtk_live_` détectable par les scanners ; `ipAutorisees` ; rotation §3.6 |
| Fuite de la base | Clés hachées SHA-256 → non rejouables ; secrets webhook chiffrés AES-GCM avec une clé hors base |
| CSRF | Sans objet : aucun cookie sur `api.…` (§3.3) |
| SSRF via URL de webhook | Refuser à l'enregistrement : schéma ≠ `https`, hôte résolvant vers une IP privée/loopback/link-local, port non standard. Revérifier **à chaque envoi** (une IP peut changer après validation — *DNS rebinding*) |
| Énumération de colis | `codeSuivi` est séquentiel (`PD-000123`) → le filtre `partenaireId` de §10.3 s'applique **avant** toute réponse ; `404` uniforme |
| Écriture de statut non prévue | Liste blanche §5.4 ; `projeterStatutInterne()` renvoie `null` plutôt qu'un défaut (§5.7) |
| Étiquette forgée | `PARCEL_SERIAL_SALT_KEY` reste serveur : le partenaire imprime nos QR, il ne peut pas en fabriquer (§7.5) |
| Déni de service | Quotas §9.4 ; `limit` plafonné à 200 |
| Rejeu de webhook | `t` dans la charge signée + fenêtre 300 s (§8.3) |

---

## 11. Migrations impliquées

Cinq migrations, dans cet ordre, chacune indépendamment déployable.

**Aucune ne touche `StatutCommande`** (conséquence de §2.1) **et aucune ne
touche la table `commandes`** (conséquence du périmètre sortant, §1.2). C'est
le principal gain de robustesse de cette spécification : le chantier est
entièrement additif et se replie en `DROP TABLE`.

**1. `2026XXXX_ajout_partenaires_transport`**
`CREATE TYPE` : `StatutPartenaire`, `ScopeApiPartenaire`.
`CREATE TABLE partenaires_transport`, `cles_api_partenaire`,
`couvertures_ville_partenaire`.
Seed AMANA :
`INSERT INTO partenaires_transport (code, nom, encaisse_cod) VALUES ('amana', 'AMANA', true)`.
Aucun impact sur l'existant.

**2. `2026XXXX_ajout_livraisons_sous_traitees`**
`CREATE TYPE StatutSousTraitance`. `CREATE TABLE livraisons_sous_traitees`.
`CREATE INDEX livraisons_sous_traitees_partenaire_cursor_idx ON livraisons_sous_traitees (partenaire_id, cree_le DESC, id DESC)` — requis par la pagination par curseur (§9.2).
Index unique **partiel**, non exprimable en Prisma, à écrire en SQL brut :

```sql
CREATE UNIQUE INDEX livraisons_sous_traitees_commande_active_key
  ON livraisons_sous_traitees (commande_id) WHERE actif;
```

C'est **la** garantie qu'un colis n'est jamais chez deux transporteurs à la
fois (§6.2) ; le code applicatif seul ne protège pas de deux requêtes
concurrentes.

**3. `2026XXXX_ajout_webhooks_partenaires`**
`CREATE TYPE StatutEndpointWebhook`. `CREATE TABLE endpoints_webhook`,
`livraisons_webhook`. Index partiel de file d'attente :

```sql
CREATE INDEX livraisons_webhook_file_idx
  ON livraisons_webhook (prochaine_tentative_le)
  WHERE livre_le IS NULL AND abandonne_le IS NULL;
```

**4. `2026XXXX_ajout_reconciliation_cod`**
`CREATE TYPE StatutReconciliationCod`. `CREATE TABLE reconciliations_cod`,
`lignes_reconciliation_cod`.
`CREATE SEQUENCE reconciliation_cod_numero_seq` — à ajouter à `lib/codes.ts`
(`nextReconciliationCodNumero()` → `REC-AAAA-MM-NNN`), sur le modèle des
générateurs existants. Attention au commentaire de
`nextBonDistributionNumero()` (*« un trou dans la séquence […] ferait retomber
le compteur sur un numéro déjà pris »*) : utiliser une vraie séquence
PostgreSQL, pas un `count() + 1`.

**5. `2026XXXX_ajout_audit_et_journal_api_partenaire`**
`ALTER TABLE audit_logs ALTER COLUMN admin_id DROP NOT NULL` ;
`ADD COLUMN partenaire_id` + FK + index ;
`ADD CONSTRAINT audit_logs_acteur_check CHECK (num_nonnulls(admin_id, partenaire_id) = 1)`.
`CREATE TABLE requetes_idempotentes`, `journal_api_partenaire`.

**Tâches planifiées à prévoir** (hors migration) :
purge `requetes_idempotentes` (> 24 h), purge `journal_api_partenaire`
(> 30 j), purge `rate_limit_entries` (> 24 h, §9.4), worker de file
`livraisons_webhook`, générateur de relevés COD.

---

## 12. Variables d'environnement

À ajouter à `.env.example`, dans le style commenté du fichier existant :

```bash
# ---------------------------------------------------------------------------
# API Partenaires (§ API_PARTENAIRES.md)
# ---------------------------------------------------------------------------
# Hôte dédié à l'API machine-à-machine par laquelle les transporteurs
# partenaires nous poussent les statuts des colis qu'on leur a confiés.
# CINQUIÈME HÔTE, mais PAS un cinquième espace de session : aucun cookie n'y
# est jamais posé, ce qui rend l'exemption du contrôle d'Origin correcte par
# construction (cf. §3.3). Un hôte non renseigné désactive purement et
# simplement l'API (le proxy répond 404).
NEXT_PUBLIC_HOST_API=api.example.ma

# Chiffrement AES-256-GCM des secrets qu'il faut pouvoir REJOUER : secrets de
# signature des webhooks sortants, secrets d'appel des API partenaires. À ne
# pas confondre avec le hachage des clés d'API, qui est à sens unique.
#   openssl rand -base64 32
# ATTENTION : la changer rend illisibles tous les secrets déjà chiffrés — il
# faut alors faire tourner tous les webhooks des partenaires.
PARTNER_SECRET_ENC_KEY=

# Quota par défaut d'une clé d'API, en requêtes par minute (surchargeable par
# clé via CleApiPartenaire.quotaParMinute). Appliqué par checkRateLimit()
# (lib/rate-limit.ts), même compteur PostgreSQL atomique que le login.
PARTNER_API_RATE_LIMIT_PER_MIN=600

# Nombre maximum de tentatives de livraison d'un webhook avant abandon
# (cf. table de backoff, §8.4). Au-delà, l'événement reste rejouable
# manuellement depuis /admin/partenaires.
PARTNER_WEBHOOK_MAX_ATTEMPTS=8

# Origines autorisées à appeler l'API depuis un navigateur (CORS), séparées
# par des virgules. Vide = aucune : l'API est alors strictement
# serveur-à-serveur, ce qui est le mode recommandé et attendu ici (une clé
# d'API n'a rien à faire dans du JavaScript de page).
PARTNER_API_CORS_ORIGINS=
```

---

## 13. Plan de mise en œuvre par lots

| Lot | Contenu | Dépendances |
|---|---|---|
| **L1 — Contrat de statuts** | `lib/api-partenaires/statuts.ts` + tests unitaires exhaustifs sur les 31 valeurs et sur les deux projections | **aucune** |
| **L0 — Socle** | `resolveHost()` (`lib/spaces.ts`), branche API dans `proxy.ts`, `lib/partner-auth.ts`, migrations 1 et 5, écran `/admin/partenaires` (CRUD + clés) | — |
| **L2 — Remise** | Migration 2, `lib/partenaires/eligibilite.ts`, adaptateurs, `POST /admin/partenaires/{id}/remise`, généralisation des libellés AMANA (§2.1) | L0, L1 |
| **L3 — Retour de statuts** | `PATCH /v1/sous-traitance/{ref}/statut`, `GET /v1/sous-traitance*`, `POST …/acceptation`, transition `en_retour_par_amana → recu_au_hub` dans le scan de réception | L2 |
| **L4 — Étiquettes et réseau** | `GET …/etiquette` (+ ZPL), `GET\|PUT /v1/reseau/couverture` | L3 |
| **L5 — Webhooks** | Migration 3, worker de file, signature, rejeu, `/v1/webhooks*`, `soustraitance.annulee` | L3 |
| **L6 — COD** | Migration 4, générateur de relevés, `/v1/cod/*`, écritures comptables | L3 |

**L1 n'a aucune dépendance et se fait en premier.** C'est un module pur (§5.7) :
pas de migration, pas de proxy, pas de Prisma runtime, testable avec le runner
`node:test` déjà utilisé par `lib/__tests__/parcel-serial.test.ts`. C'est aussi
lui qui porte le garde-fou de compilation qui protège tous les lots suivants —
le placer après le socle reviendrait à écrire l'infrastructure avant le contrat
qu'elle transporte.

**L0 → L2 → L3** livre la sous-traitance de bout en bout : on remet un colis,
le partenaire nous dit ce qu'il en fait, le marchand le voit. L4, L5 et L6 sont
trois améliorations indépendantes qui peuvent être priorisées séparément — la
plus urgente en pratique étant **L5**, à cause de `soustraitance.annulee`
(§8.4) : tant qu'il n'existe pas, une annulation tardive se règle au téléphone.

---

## 14. Décisions à trancher

Ces points relèvent d'un arbitrage **produit / business / juridique**, pas
technique. La spécification propose une valeur par défaut, mais chacun peut
inverser une partie du modèle de données.

Deux seulement bloquent le démarrage : **D-1** et **D-9**, tous deux au lot L2.
Les autres peuvent être tranchés en cours de route.

**D-1 — Le partenaire encaisse-t-il le COD lui-même ?** *(bloque L2)*
Défaut proposé : **oui** (`PartenaireTransport.encaisseCod = true`).
Si non, le colis lui est remis « sans valeur déclarée » et il faut un mécanisme
d'encaissement séparé, ce qui vide `ReconciliationCod` de sa raison d'être et
change radicalement le risque de contrepartie. *Impacte : §4.2, §7.7, L6.*

**D-2 — Fréquence du reversement COD.**
Hebdomadaire ? Bimensuel (proposé) ? Mensuel ? Le sens, lui, n'est plus une
question : dans un périmètre sortant, c'est toujours le partenaire qui nous
doit — d'où l'absence de colonne `sens` sur `ReconciliationCod` (§4.7).
*Impacte : §4.7, §7.7.*

**D-3 — Le partenaire voit-il l'identité du marchand ?**
Défaut proposé : **non** — l'expéditeur déclaré est Mathio Delivery (§6.3).
Mais un partenaire peut légitimement avoir besoin du nom de l'expéditeur sur
l'étiquette pour un retour, et certains marchands *veulent* leur marque
visible. Option intermédiaire : un champ `shipper_display_name` paramétrable
par marchand, opt-in. *Impacte : §6.3, §7.1, §10.2.*

**D-4 — Faut-il un statut public `lost` / `damaged` ?**
Aujourd'hui, aucun statut interne ne dit « perdu » — `STATUTS_TERMINAUX` ne
contient que `livre, retourne, annule, annule_par_vendeur`. L'ajouter au
contrat public sans contrepartie interne créerait un statut qu'on ne saurait
pas projeter (§5.3) ; l'ajouter à l'enum interne est la seule migration de
`StatutCommande` que cette spécification a évitée. Lié à D-7. *Impacte : §5.2,
§5.3, §5.4.*

**D-5 — À partir de quel moment un colis est-il `returning` ?**
Dans ce périmètre, `returning` vient du partenaire et le trou signalé en §5.3
n'a pas d'incidence pratique. La question ne se rouvrirait qu'en exposant un
`platform_status` pendant le retour interne, via `BonRetour`
(`Commande.bonRetourId`). *Impacte : §5.3 — faible.*

**D-6 — Facturation : à l'acte, au forfait, ou au volume dégressif ?**
La spécification ne couvre **que** la réconciliation COD. La facturation des
frais de transport (par colis livré ? par colis remis, livré ou non ? avec des
frais de retour distincts, à l'image de `Utilisateur.fraisRefus` côté livreur ?)
reste ouverte, et détermine si `CouvertureVillePartenaire.coutHt` suffit ou
s'il faut une grille tarifaire versionnée avec paliers. *Impacte : §4.4, §4.5
(`coutTransport` sur une livraison en échec), et un éventuel modèle
`GrilleTarifairePartenaire`.*

**D-7 — Qui porte le risque en cas de colis perdu ou volé chez le partenaire ?**
Plafond d'indemnisation par colis ? Indexé sur le COD ou forfaitaire ?
Franchise ? Déclaration de valeur au moment de la remise ? La réponse détermine
s'il faut un modèle `LitigeColis` avec sa propre machine à états, ou si
`Reclamation` (existant) suffit. *Impacte : §4.5, D-4.*

**D-8 — Le bac à sable (`environnement = test`) est-il un engagement ?**
Cette spécification porte le drapeau sur `LivraisonSousTraitee.estTest` et non
sur `Commande`, ce qui limite le périmètre à filtrer à une seule table (§4.3,
§10.3) — l'oubli d'un filtre pollue les relevés COD, pas l'exploitation. Reste
à décider si on s'engage à maintenir un jeu de colis de test, et qui les crée.
*Impacte : §4.3, §4.5, §10.3.*

**D-9 — Arbitrage entre partenaires couvrant la même ville.** *(bloque L2)*
Si deux partenaires couvrent Tiznit, lequel reçoit le colis ? Le moins cher
(`coutHt`) ? Le plus rapide (`delaiJours`) ? Une répartition contractuelle en
volume ? Un ordre de préférence figé ? Tant que ce n'est pas tranché, la remise
reste une **décision humaine** dans le back-office, et
`POST /admin/partenaires/{id}/remise` n'est pas automatisable. *Impacte : §6.2.*

**D-10 — SLA et pénalités.**
Le partenaire s'engage-t-il sur un délai (`CouvertureVillePartenaire.delaiJours`
est aujourd'hui purement indicatif, et désormais **déclaré par lui**, §7.6) ?
Y a-t-il des pénalités de retard, et apparaissent-elles dans le relevé COD ou
dans une facture séparée ? Si oui, il faut horodater les franchissements de
seuil, donc conserver plus que le dernier événement. *Impacte : §4.4, §4.5,
§4.7.*

**D-11 — Rétention des données d'un partenariat archivé.**
Combien de temps conserve-t-on les remises, les preuves de livraison (photos,
signatures) et les journaux d'API d'un partenaire dont le contrat est terminé ?
La loi 09-08 sur la protection des données personnelles s'applique aux
destinataires, dont les coordonnées ont transité chez ce tiers. *Impacte :
§4.8, §11 (tâches de purge).*

---

*Document rédigé le 2026-08-21, révisé pour le périmètre « sous-traitance
sortante uniquement ». Aucune ligne de code applicatif n'a été modifiée : cette
spécification décrit un état cible, pas un état livré.*
