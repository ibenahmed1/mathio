# Intégration des plateformes partenaires — flux ENTRANT

Ce document décrit le module qui permet à une **plateforme partenaire** (canal de vente, cas
fondateur : **Shipeh**) de nous envoyer ses marchands et ses colis. Il liste les endpoints
réellement implémentés et fonctionnels, où lire le code, et **comment tester ce module pour le
valider définitivement**.

**Ne pas confondre avec `API_PARTENAIRES.md`**, qui spécifie le flux **sortant** (nous
sous-traitons un colis à un transporteur, AMANA). Les deux vont dans des sens opposés et ne
partagent que le mécanisme de clé d'API. Le §1.4 de ce document-là porte une note de mise à jour
qui explique ce qui a été construit ici, et en quoi cela diffère de ce qu'il prévoyait.

---

## Table des matières

1. [Ce que fait ce module](#1-ce-que-fait-ce-module)
2. [Carte des fichiers](#2-carte-des-fichiers)
3. [Modèle de données](#3-modèle-de-données)
4. [L'API machine — endpoints](#4-lapi-machine--endpoints)
5. [L'API back-office — endpoints](#5-lapi-back-office--endpoints)
6. [Codes d'erreur](#6-codes-derreur)
7. [Comment tester — les cinq niveaux](#7-comment-tester--les-cinq-niveaux)
8. [Checklist de validation définitive](#8-checklist-de-validation-définitive)
9. [Hors périmètre et points ouverts](#9-hors-périmètre-et-points-ouverts)

---

## 1. Ce que fait ce module

Deux automatisations, et rien d'autre :

| | |
|---|---|
| **Synchronisation des comptes** | Un marchand s'inscrit sur Shipeh → son compte est créé chez nous, il accède à son espace et suit ses colis |
| **Ingestion des colis** | Un colis est créé sur Shipeh → il entre chez nous, à l'unité ou par lot |

### Les trois propriétés à ne jamais casser

Elles ne se voient pas à l'usage — tout continue de « marcher » quand elles tombent, et c'est
précisément ce qui les rend dangereuses à laisser sans test.

1. **Cloisonnement d'hôte.** L'API machine vit sur un **hôte dédié** (`HOST_API`), qui ne sert
   aucune page et ne pose **jamais** de cookie. C'est ce qui rend l'absence de contrôle
   d'`Origin` correcte *par construction* : sans authentification ambiante, il n'y a pas de CSRF
   à empêcher. Le cloisonnement est **réciproque** — `/api/v1/**` répond 404 sur les trois hôtes
   d'espace, et l'hôte de l'API répond 404 sur tout ce qui n'est pas `/api/v1/**`.
2. **Idempotence.** Elle ne repose pas sur du code mais sur une contrainte de base qui existait
   avant ce chantier : `@@unique([marchandId, codeSuiviPartenaire])`. Elle tient donc même face
   à deux requêtes concurrentes, ce qu'un « chercher puis créer » applicatif ne garantirait pas.
3. **Cloisonnement bac à sable / production.** Porté par la **clé** et par le **lien marchand**,
   jamais par le colis. Une clé `test` ne trouve que des liens `test` : elle ne *peut pas*
   déposer un colis chez un marchand de production, même en connaissant son identifiant. Aucune
   colonne `estTest` sur `commandes`, donc aucune règle applicative « ne pas facturer les colis
   de test » à tenir plus tard.

   Et surtout, `environnement` fait partie des **deux contraintes d'unicité** de
   `CompteMarchandExterne`. Prisma en dérive les clés composées
   `plateformeId_environnement_idExterne` et `..._marchandId`, dont un `findUnique` **exige les
   trois champs** : chercher un lien en oubliant l'environnement ne compile plus. La garantie
   est passée du « il faut y penser » au « le compilateur refuse ».

   Ce n'est pas théorique : l'oubli s'était produit. La recherche « déjà synchronisé » ne
   filtrait pas sur l'environnement, si bien qu'une clé `live` retrouvait le lien de **test**
   d'un même `idExterne`, répondait « déjà synchronisé » — un succès — puis le dépôt de colis
   échouait en 404. **La mise en production était silencieusement cassée pour tout marchand
   ayant servi aux essais.** Depuis, test et production sont deux espaces de noms disjoints : un
   même `idExterne` peut vivre dans les deux, en deux liens indépendants.

### Ce que le module n'a PAS touché

`commandes`, `marchands` et `utilisateurs` n'ont reçu **aucune colonne**. Tout vit dans quatre
tables satellites. Abandonner une intégration revient donc à supprimer des lignes, jamais à
défaire des colonnes sur les tables les plus chaudes du schéma.

### Le prix assumé de l'isolation logique

L'isolation retenue est **logique, dans une base unique** — pas physique. Ce choix a deux
inconvénients connus ; le premier est réglé, le second ne peut être qu'atténué.

**La clause oubliée** est traitée à la racine, par les contraintes d'unicité ci-dessus : ce
n'est plus un `WHERE` qu'on peut omettre, c'est une clé de recherche que le compilateur exige.

**La pollution des tables chaudes**, en revanche, est irréductible : les marchands et les colis
d'une clé `test` sont de **vraies lignes** dans les vraies tables. Une clé de test ne peut pas
*atteindre* la production, mais ce qu'elle crée y réside. La contrepartie tient en trois
choses :

- un **compteur permanent** sur `/admin/integrations` — la pollution cesse d'être silencieuse ;
- une **purge** (`POST /api/plateformes/[id]/purge-test`) qui efface marchands, colis et
  historique de l'environnement `test`, et **rien d'autre** ;
- une **pastille « test »** dans `/admin/marchands` **et dans `/admin/colis`**, sans quoi rien ne
  distingue un marchand ou un colis de bac à sable d'un vrai, au moment de l'approuver, de le
  facturer, ou de le router vers un hub.

**La pastille des colis est DÉRIVÉE, pas stockée.** Un colis est « de test » quand son marchand
porte un lien `test` — aucune colonne n'a été ajoutée à `commandes`. Le critère est exact et non
heuristique : depuis les deux gardes de rattachement, un marchand lié en `test` a forcément été
créé par la synchronisation et ne peut pas être aussi un vrai client. Une colonne aurait donné le
même affichage, au prix d'une obligation permanente de l'exclure partout — facturation, routage,
statistiques — dont un seul oubli aurait suffi à la rendre trompeuse.

La purge ne supprime **jamais** un marchand qu'elle n'a pas créé. C'est la raison d'être de
`CompteMarchandExterne.creeParSynchro` : un marchand *rattaché* s'était inscrit en direct chez
nous et reste notre client, même si une plateforme l'a revendiqué pendant les essais. Sans cette
colonne, la purge reposerait sur une heuristique — et une heuristique qui se trompe efface un
vrai client.

### Les deux gardes qui interdisent de traverser la frontière

Un marchand est soit un **artefact de bac à sable** (créé par une clé `test`), soit un **vrai
client** (inscrit en direct, ou créé par une clé `live`). Le rattachement ne peut pas franchir
cette frontière, dans un sens comme dans l'autre — et les deux traversées font du dégât, chacune
à sa façon :

| Tentative | Réponse | Ce qu'elle évitait |
|---|---|---|
| Clé **live** → marchand de test | `409 marchand_de_test` | La plateforme croyait obtenir un marchand actif et héritait d'un compte resté en attente ; ce marchand devenait de surcroît **non purgeable** |
| Clé **test** → marchand réel | `409 marchand_de_production` | Les colis d'essai atterrissaient chez un **vrai** marchand, dans son tableau de bord — et la purge ne pouvait pas les en retirer |

C'est le second garde qui remplace l'ajout d'une colonne `environnement` sur `commandes`. Une
telle colonne rendrait la purge exacte, mais au prix d'une obligation permanente : facturation,
routage vers les hubs, statistiques, listes de colis devraient toutes penser à l'exclure, et une
seule oubliée suffirait à la rendre inutile. Le garde ferme le cas **à la source** : un marchand
lié en `test` a forcément été créé par la synchronisation, donc reste toujours purgeable, et
`colisConserves` vaut structurellement 0.

**À faire avant la mise en service** : purger les données de test, puis émettre la clé `live` —
dans cet ordre. Les coordonnées restant uniques globalement (`Utilisateur.telephone`, `email`),
un marchand de test qui aurait emprunté un vrai numéro bloque désormais la synchronisation en
production avec un `409 marchand_de_test` explicite, au lieu de s'y installer en silence.

---

## 2. Carte des fichiers

### Le cœur du module

| Fichier | Ce qui y vit |
|---|---|
| [`lib/plateforme-cles.ts`](lib/plateforme-cles.ts) | **Module PUR** (aucun Prisma, aucun `next/*`) : format des clés, génération, SHA-256, comparaison en temps constant, catalogue des scopes, en-tête de dépréciation |
| [`lib/plateforme-auth.ts`](lib/plateforme-auth.ts) | `requirePlateforme()` — le pendant machine de `requireUser()`. Clé, scopes, révocation, expiration, quota, journal, `ErreurPlateforme` |
| [`lib/plateforme-marchands.ts`](lib/plateforme-marchands.ts) | Validation et synchronisation d'un compte marchand (les trois issues) |
| [`lib/plateforme-colis.ts`](lib/plateforme-colis.ts) | Validation et ingestion des colis, unitaire et par lot |
| [`lib/plateformes.ts`](lib/plateformes.ts) | Administration back-office : plateformes, émission / rotation / révocation des clés |

### Les points d'insertion dans l'existant

Ce sont eux qu'il faut relire en priorité lors d'une revue : ils modifient du code partagé.

| Fichier | Ce qui a changé |
|---|---|
| [`lib/spaces.ts`](lib/spaces.ts) | `HOST_API`, `HostKind`, `resolveHost()`. `spaceForHost()` est **inchangé** et continue de renvoyer `null` pour l'hôte API — c'est ce qui garantit qu'aucun code existant ne peut prendre un appel machine pour une session |
| [`proxy.ts`](proxy.ts) | §1 bis : la branche `api_plateformes`, insérée **avant** tout le reste, et le cloisonnement réciproque |
| [`lib/auth.ts`](lib/auth.ts) | `getHomeSpace()` renvoie désormais `SessionSpace \| null` (le rôle `plateforme` n'atterrit nulle part) |
| [`lib/permissions.ts`](lib/permissions.ts) | Permission `integrations:manage` ; `ROLE_PERMISSIONS.plateforme = []` |
| [`lib/permission-routes.ts`](lib/permission-routes.ts) | `/admin/integrations/**` et `/api/plateformes/**` → `integrations:manage` ; `/api/v1/**` → entrée `null` explicite et commentée |
| [`app/api/auth/login/route.ts`](app/api/auth/login/route.ts) | Traite le cas `home === null` |
| [`app/api/utilisateurs/[id]/route.ts`](app/api/utilisateurs/[id]/route.ts) | Refuse un rôle sans espace d'atterrissage |
| [`scripts/audit-http.ts`](scripts/audit-http.ts) | `OptionsRequete.entetes` — sans quoi aucun script ne peut porter un `Authorization: Bearer` |

### Routes, écran, tests

| Fichier | |
|---|---|
| [`app/api/v1/marchands/route.ts`](app/api/v1/marchands/route.ts) | `POST /v1/marchands` |
| [`app/api/v1/colis/route.ts`](app/api/v1/colis/route.ts) | `POST /v1/colis` |
| [`app/api/v1/colis/lot/route.ts`](app/api/v1/colis/lot/route.ts) | `POST /v1/colis/lot` |
| [`app/api/plateformes/route.ts`](app/api/plateformes/route.ts) | Liste et création de plateformes |
| [`app/api/plateformes/[id]/route.ts`](app/api/plateformes/[id]/route.ts) | Détail et modification |
| [`app/api/plateformes/[id]/cles/route.ts`](app/api/plateformes/[id]/cles/route.ts) | Émission d'une clé |
| [`app/api/plateformes/[id]/cles/[cleId]/route.ts`](app/api/plateformes/[id]/cles/[cleId]/route.ts) | Révocation / expiration |
| [`app/admin/integrations/page.tsx`](app/admin/integrations/page.tsx) | L'écran d'administration |
| [`lib/__tests__/plateforme-cles.test.ts`](lib/__tests__/plateforme-cles.test.ts) | 18 tests — format et vérification des clés |
| [`lib/__tests__/plateforme-marchands.test.ts`](lib/__tests__/plateforme-marchands.test.ts) | 10 tests — validation des marchands |
| [`lib/__tests__/plateforme-colis.test.ts`](lib/__tests__/plateforme-colis.test.ts) | 10 tests — validation des colis |
| [`scripts/simuler-shipeh.ts`](scripts/simuler-shipeh.ts) | **Le simulateur** : 39 vérifications de bout en bout |
| [`scripts/console-shipeh.ts`](scripts/console-shipeh.ts) | **La console** (`npm run shipeh`) : tenir le rôle du partenaire à la main, et suivre ce qui arrive côté Mathio |
| [`requests.http`](requests.http) | Requêtes manuelles, section « API MACHINE » en fin de fichier |

### Migrations

| | |
|---|---|
| `prisma/migrations/20260902103000_plateformes_partenaires/` | 4 tables, l'enum `EnvironnementApi`, le rôle `plateforme` |
| `prisma/migrations/20260902103100_permission_integrations/` | Remplissage de `integrations:manage` |
| `prisma/migrations/20260904090000_environnement_dans_unicites/` | `environnement` entre dans les deux unicités de `comptes_marchands_externes` — l'isolation bac à sable devient structurelle |
| `prisma/migrations/20260904091000_provenance_lien_marchand/` | `cree_par_synchro` — la purge ne supprime que ce que la plateforme a créé |

> **Après ces deux dernières migrations, redémarrer `npm run dev`.** Turbopack fige le client
> Prisma généré dans son cache de build : régénérer sur disque n'invalide pas le chunk, et le
> serveur continue de proposer les *anciennes* clés composées — toutes les routes qui les
> utilisent répondent alors 500. Un `rm -rf .next` lève le doute.

---

## 3. Modèle de données

Voir [`prisma/schema.prisma`](prisma/schema.prisma), section « Plateformes partenaires » — les
commentaires y portent les règles.

```
PlateformePartenaire ──┬── CleApiPlateforme        (prefixe unique indexé, SHA-256 du secret)
   code "shipeh"       ├── CompteMarchandExterne   (plateformeId + idExterne ↔ marchandId)
   utilisateurTechnique└── JournalAppelApi         (les 100 derniers appels affichés)
        │
        └── Utilisateur (role = plateforme, actif = false)
```

### Deux points qui étonnent, et pourquoi

**Le rôle `Role.plateforme`.** `HistoriqueStatutCommande.utilisateurId` est **non nullable**, et
un colis ingéré par une machine n'a pas d'auteur humain. Rendre cette colonne nullable aurait
touché une table chaude et la vingtaine de lectures qui font `historique.utilisateur.nomComplet`.
Un compte de service coûte une ligne et rend l'historique honnête — « Shipeh » y apparaît comme
auteur.

Ce compte **ne peut ouvrir de session nulle part** : `plateforme` est le seul rôle absent de
`SPACE_ROLES` et de `SPACE_LOGIN_ROLES`. Le refus ne dépend pas de `actif`, ni d'un contrôle
dans un handler — il n'y a simplement aucun espace où ce rôle soit autorisé.

**Deux unicités sur `CompteMarchandExterne`**, et il faut les deux :
- `[plateformeId, idExterne]` rend la synchronisation idempotente ;
- `[plateformeId, marchandId]` interdit qu'un même marchand soit atteignable sous deux
  identifiants externes de la même plateforme — sans quoi ses colis se répartiraient entre deux
  liens selon celui que la plateforme envoie.

---

## 4. L'API machine — endpoints

### Authentification

```
Authorization: Bearer mtk_live_a7f3c19e_9kQ2xR4pLm8vNc0dW1sZ6tYbH3jF5gA7uE2iO4rT8yK
                      └┬─┘ └┬─┘ └───┬──┘ └────────────────┬──────────────────────┘
                       │    │       │                     └─ secret : 32 octets, base64url
                       │    │       └─ préfixe public : 4 octets hex, INDEXÉ et UNIQUE
                       │    └─ environnement (indice ; c'est la BASE qui fait foi)
                       └─ marqueur produit, pour les scanners de secrets
```

Repli toléré et **non documenté au partenaire** : `X-Mathio-Api-Key`, pour les clients dont le
proxy d'entreprise réécrit `Authorization`.

Seul `SHA-256(secret)` est stocké. Le secret complet n'existe que dans la réponse de création —
perdu, il ne se retrouve pas, il se réémet.

### Scopes

| Scope | Ce qu'il ouvre |
|---|---|
| `marchands:creation` | Créer un marchand, laissé **en attente de validation** (RF-22 respecté) |
| `marchands:creation_validee` | Créer un marchand **déjà actif**. Refusé à toute clé `test`, à l'émission |
| `colis:creation` | Déposer des colis, à l'unité ou par lot |

La scission des deux premiers est le pivot du bac à sable : une clé de test exerce le même
endpoint, le même code, le même parcours — elle n'obtient simplement pas un compte actif au bout.

### `POST /v1/marchands`

Scope : `marchands:creation` **ou** `marchands:creation_validee` (au moins l'un des deux).

**Requête**

| Champ | | |
|---|---|---|
| `idExterne` | **requis** | L'identifiant du marchand *chez eux*. Clé de la synchronisation |
| `nomComplet` | **requis** | |
| `nomBoutique` | **requis** | |
| `telephone` | **requis** | Format marocain. `0612345678`, `+212612345678`, `212612345678` et les espaces sont acceptés, et normalisés |
| `email` | **requis** | Seul champ de coordonnées obligatoire : c'est par lui que passe le lien « définir mon mot de passe », donc le seul chemin du marchand vers son espace |
| `ville` `adresse` `rib` `cin` `siteWeb` `nomBanque` `registreCommerce` `villeRamassage` `raisonSociale` `iceRc` | optionnels | `rib` = exactement 24 chiffres s'il est fourni |
| `typeCompte` | optionnel | `marchand` (défaut), `entreprise`, `dropshipping` |

Le jeu requis est volontairement **plus court** que celui de l'auto-inscription : une plateforme
ne détient ni photo du RIB ni mot de passe choisi par le marchand. On préfère une fiche
incomplète, complétable depuis le back-office, à une fiche fausse.

**Réponse**

```jsonc
// 201 — créé
{ "issue": "cree", "idExterne": "shipeh-12345", "marchandId": "…",
  "nomBoutique": "Atlas Store", "statut": "actif", "invitationEnvoyee": true }
```

| Code | `issue` | Signification |
|---|---|---|
| `201` | `cree` | Compte + profil + lien créés. Un email « définir mon mot de passe » est parti (7 jours de validité) |
| `200` | `rattache` | Ce marchand s'était **déjà inscrit chez nous en direct**. Seul le lien est créé — sa fiche n'est pas réécrite |
| `200` | `deja_synchronise` | Cet `idExterne` nous est déjà connu. **Aucune écriture** — c'est ce qui rend l'appel idempotent |

`invitationEnvoyee: false` signifie que le compte existe mais qu'aucun email n'est parti (SMTP non
configuré, envoi en échec, ou environnement `test` où l'envoi est court-circuité par
construction). Un admin peut alors relancer une réinitialisation depuis `/admin/utilisateurs`.

**Le lien d'invitation n'est jamais renvoyé à la plateforme** : quiconque le détient peut choisir
le mot de passe du compte.

### `POST /v1/colis`

Scope : `colis:creation`.

**Requête**

| Champ | | |
|---|---|---|
| `idExterneMarchand` | **requis** | Doit correspondre à un marchand déjà synchronisé, **dans le même environnement** |
| `reference` | **requis** | La référence du colis *chez eux*. **Clé d'idempotence** → `Commande.codeSuiviPartenaire` |
| `clientNom` `clientTelephone` `ville` `adresse` | **requis** | `ville` est du texte libre, rapproché du référentiel en *best-effort* (jamais bloquant) |
| `montantCod` | **requis** | Strictement positif. Une chaîne est acceptée (sérialiseur Decimal côté partenaire) |
| `quantite` | optionnel | Entier positif, défaut `1` |
| `poidsKg` `codePostal` `produitDescription` `notes` | optionnels | |
| `ouvrir` `fragile` | optionnels | Booléens, défaut `false` |

**Réponse**

```jsonc
// 201 — créé   |   200 avec "issue": "deja_ingere" sur un rejeu
{ "issue": "cree", "reference": "SHP-2026-0001", "codeSuivi": "PD-000123",
  "marchandId": "…", "statut": "nouveau_colis", "aRisque": false }
```

Un **rejeu répond 200 avec le code de suivi déjà attribué**, et non une erreur : une reprise
après timeout ou une redélivrance de file de messages est un cas *normal*, et le code existant
est précisément ce dont l'appelant a besoin pour se réconcilier.

Le colis entre avec `source = 'api'`, `statut = 'nouveau_colis'`, une entrée d'historique signée
par le compte de service, et **RG-08 appliqué** (vérification de liste noire → `aRisque`).

### `POST /v1/colis/lot`

Scope : `colis:creation`. Corps = **tableau** de colis, 1 à **200**.

**Réponse : toujours `207`**, même quand tout passe. Un code qui changerait selon le contenu
obligerait l'appelant à écrire deux chemins de lecture — exactement le genre de subtilité qu'une
intégration finit par ignorer. **Le code global ne dit rien du sort d'une ligne ; seul
`lignes[].ok` le dit.**

```jsonc
{ "total": 10, "crees": 7, "dejaIngeres": 0, "refuses": 3,
  "lignes": [
    { "index": 0, "reference": "SHP-1001", "ok": true,
      "resultat": { "issue": "cree", "codeSuivi": "PD-000124", … } },
    { "index": 2, "reference": "SHP-1003", "ok": false,
      "code": "champ_requis", "message": "Le champ « ville » est requis" }
  ] }
```

Un lot est **partiellement acceptable** : 200 colis dont 3 portent une ville illisible en créent
197. Une machine ne peut pas « corriger et réessayer » comme un humain devant un tableur ; lui
rejeter tout le lot l'obligerait au tri manuel que l'API est censée éviter.

Chaque ligne refusée porte son `index` **et** sa `reference` — sans quoi le partenaire ne saurait
pas laquelle rejouer.

---

## 5. L'API back-office — endpoints

Tous sous permission **`integrations:manage`**, détenue par le seul rôle `admin` par défaut.
Clé propre et non un repli sur `settings:manage` que tout le back-office détient : une clé d'API
donne à une machine tierce le droit de créer des marchands déjà validés et de déposer des colis.

| Méthode | Chemin | |
|---|---|---|
| `GET` | `/api/plateformes` | Liste (compte des clés actives et des marchands liés) |
| `POST` | `/api/plateformes` | Crée une plateforme **et son compte de service**, en une transaction |
| `GET` | `/api/plateformes/[id]` | Détail : clés, marchands liés (200 max), 100 derniers appels |
| `PATCH` | `/api/plateformes/[id]` | `{ nom?, actif? }`. `actif: false` = **l'interrupteur d'incident** : coupe toutes les clés d'un coup sans les révoquer |
| `POST` | `/api/plateformes/[id]/cles` | `{ environnement, scopes, libelle?, quotaParMinute? }` → **`cleComplete` renvoyée une seule fois** |
| `PATCH` | `/api/plateformes/[id]/cles/[cleId]` | `{ action: "revoquer" }` (refus dur, immédiat) ou `{ action: "expirer", expireLe? }` (refus doux, défaut +7 j) |

### Rotation d'une clé, sans coupure

```
J      POST …/cles              → clé B émise ; la clé A fonctionne toujours
J → n  le partenaire déploie B  ; les deux clés répondent
J+n    PATCH …/cles/A {action:"expirer"}
       → 7 jours de grâce, pendant lesquels chaque appel de A renvoie
         l'en-tête « Mathio-Key-Deprecation: <ISO8601> », visible dans SES journaux
J+n+7  A cesse de répondre (401 cle_expiree)
```

Plafond : **2 clés actives par plateforme et par environnement**. Sans plafond, des clés oubliées
s'accumuleraient, et chacune resterait un accès valide que personne ne surveille.

Une ligne de clé **n'est jamais supprimée**, même révoquée : `derniereUtilisationLe` et
`nbAppels` restent exploitables pour savoir, après coup, quand une clé fuitée a servi.

---

## 6. Codes d'erreur

L'API machine renvoie `{ "code": "…", "message": "…" }`. Le **code** est stable et c'est sur lui
que l'intégrateur branche son `if` ; le message est écrit pour un humain qui lit un journal et
peut être reformulé sans préavis.

| HTTP | `code` | |
|---|---|---|
| 400 | `json_invalide` | Le corps n'est pas du JSON. **Un 400 et non un 500** : le problème n'est pas chez nous |
| 400 | `corps_invalide` | Pas un objet (ou pas un tableau, sur `/lot`) |
| 400 | `champ_requis` | Le message **nomme le champ** |
| 400 | `telephone_invalide` `email_invalide` `rib_invalide` `type_compte_invalide` | |
| 400 | `montant_invalide` `quantite_invalide` `poids_invalide` | |
| 400 | `lot_vide` | |
| 401 | `cle_absente` | |
| 401 | `cle_invalide` | Malformée, préfixe inconnu **ou** secret faux — **un seul code pour les trois**, sinon l'endpoint devient un oracle d'énumération de préfixes |
| 401 | `cle_revoquee` | Refus **dur**. Distinct de l'expiration : les deux mènent au même refus mais ne se corrigent pas pareil (réémettre vs prolonger) |
| 401 | `cle_expiree` | Refus **doux** échu |
| 403 | `scope_manquant` | Le message liste les scopes attendus |
| 403 | `plateforme_desactivee` | |
| 404 | `marchand_inconnu` | Inconnu **ou** dans l'autre environnement — **message volontairement indistinct** : une clé de test ne doit pas servir d'oracle sur ce qui existe en production |
| 409 | `compte_non_marchand` | Ces coordonnées appartiennent à un livreur, un agent de hub, un membre du back-office. Le convertir n'est pas une décision qu'une machine tierce a à prendre |
| 409 | `conflit_identifiants` | Le téléphone et l'email désignent **deux comptes différents** chez nous. Refus plutôt qu'un choix arbitraire |
| 409 | `deja_lie` | Ce marchand est déjà rattaché à cette plateforme sous un autre `idExterne` |
| 409 | `marchand_de_test` | Une clé **live** vise des coordonnées appartenant à un marchand créé dans le bac à sable. Purger l'environnement de test d'abord |
| 409 | `marchand_de_production` | Une clé **test** vise des coordonnées appartenant à un marchand réel. Utiliser des coordonnées fictives en bac à sable |
| 409 | `synchronisation_concurrente` | Deux synchronisations du même marchand se sont croisées. **Rejouer la requête** : elle renverra `deja_synchronise` |
| 413 | `lot_trop_grand` | |
| 429 | `quota_depasse` | Le message porte le délai d'attente |
| 500 | `erreur_interne` | Rien de l'interne ne filtre vers l'appelant |

---

## 7. Comment tester — les cinq niveaux

Les niveaux 1 et 2 sont automatiques. **Les niveaux 3 à 5 ne sont couverts par rien** et
constituent le travail de validation qui reste à faire.

### Niveau 1 — Tests unitaires : `npm test`

`tsx --test lib/__tests__/*.test.ts` — **pas Jest, pas Vitest**. Seul `lib/` est testé.

38 tests couvrent les **règles pures**, celles dont on veut voir l'échec dans un test plutôt
qu'en production :

| Fichier | Ce qui est couvert |
|---|---|
| `plateforme-cles.test.ts` | Aller-retour d'une clé générée ; le secret n'est pas reconstituable depuis ce qui est stocké ; longueur stable du préfixe (c'est la clé de lookup) ; 8 formes malformées refusées ; un secret base64url contenant `-` et `_` — le bug ne se manifesterait qu'une clé sur quelques dizaines ; un hash tronqué en base renvoie `false` au lieu de lever (`timingSafeEqual` lève sur des tailles différentes → 500 au lieu de 401) ; `assainirScopes` ; extraction de l'en-tête ; fenêtre de dépréciation |
| `plateforme-marchands.test.ts` | Les 5 champs requis, espaces compris ; email normalisé en minuscules (la colonne est unique — sans ça, deux comptes pour la même personne) ; 4 écritures de téléphone acceptées et normalisées ; un numéro non marocain refusé et **non rangé tel quel** (il serait introuvable au rattachement suivant) ; RIB ; `typeCompte` ; corps non-objet ; élagage |
| `plateforme-colis.test.ts` | Référence requise (la colonne est nullable en base — l'accepter vide désactiverait l'anti-doublon) ; champs d'acheminement ; `montantCod > 0`, chaîne acceptée ; quantité entière ; poids ; corps non-objet ; élagage |

**Ce que ce niveau ne peut pas couvrir** : tout ce qui touche la base ou le HTTP. C'est l'objet
du niveau 2.

### Niveau 2 — Scénario de bout en bout : `npm run simuler:shipeh`

**Prérequis** : un serveur de développement en cours (`npm run dev`) et les migrations
appliquées (`npm run db:migrate`). `npm run db:reseau` n'est **pas** nécessaire — sans
référentiel de villes, `villeId` reste `null`, ce qui n'est pas bloquant.

Le script attend le serveur en sondant **l'hôte de l'API**, et non celui du back-office — que la
configuration de développement pointe parfois sur un tunnel ngrok pour tester au téléphone
(cf. `.env.example`). La sonde est un appel sans clé : un `401 cle_absente` prouve toute la
chaîne d'un coup, et les deux pannes courantes se distinguent au lieu de se confondre derrière un
« injoignable » :

| Message | Cause |
|---|---|
| `Serveur injoignable` | `npm run dev` n'est pas lancé. Le lancer dans un autre terminal |
| `Le serveur répond, mais « … » n'est pas l'hôte de son API` | Le serveur tourne, mais sur un autre port (Next bascule sur `3001` quand `3000` est pris) ou avec un `HOST_API` différent. Surcharger : `AUDIT_BASE_URL=http://127.0.0.1:<port>` et `HOST_API=<hôte>` |

Le simulateur crée sa propre plateforme, ses six clés, ses marchands et ses colis (tous préfixés
`SIM-SHIPEH`), puis **supprime tout** en fin d'exécution, succès ou échec. Il est réexécutable
sans risque.

**37 vérifications**, réparties en 10 volets :

| | Volet | Ce qu'il prouve |
|---|---|---|
| 1 | Cloisonnement d'hôte | L'API n'existe pas sur le domaine du back-office ; l'hôte de l'API n'atteint ni `/api/commandes`, ni `/admin`, ni `/login` |
| 2 | Authentification | Clé absente / malformée / inconnue / révoquée / expirée — et les trois premières renvoient **le même code** |
| 3 | Scopes | Déposer un colis sans `colis:creation` → 403 |
| 4 | Marchands | Création active (clé live) ; rejeu sans écriture ; **clé test → compte en attente, jamais actif** ; rattachement d'un marchand inscrit en direct ; compte non marchand ; conflit téléphone/email ; charge utile invalide nommant le champ |
| 5 | Colis | Dépôt unitaire ; **rejeu → même code de suivi** ; marchand inconnu ; lot de 50 ; rejeu du lot (50 déjà ingérés, 50 en base — pas 100) ; **lot partiel : lignes 2, 5, 8 refusées, 7 créées** ; plafond 413 ; lot vide 400 ; JSON malformé 400 et non 500 |
| 6 | Bac à sable | Une clé test ne voit pas les marchands de production |
| 7 | Quota | Clé bridée à 2/minute : le 3ᵉ appel → 429 |
| 8 | Suspension | `actif: false` coupe toutes les clés d'un coup |
| 9 | Traçabilité | Appels journalisés, refus compris ; compteurs de clé tenus ; **historique du colis signé par un compte de rôle `plateforme`** ; tous les colis portent `source = 'api'` |

Sortie attendue : `39 OK, 0 KO`.

### La console interactive : `npm run shipeh`

Entre le simulateur (qui juge) et la recette manuelle (qui vérifie l'écran), il manquait de quoi
**improviser** : changer un champ, rejouer un appel, essayer un cas tordu. C'est ce que fait la
console.

Elle tient le rôle du partenaire — même HTTP, même hôte, même `Authorization: Bearer` — et montre
le suivi côté Mathio sans quitter le terminal : marchands liés, colis ingérés, journal des appels,
purge.

| Elle propose | |
|---|---|
| Synchroniser un marchand · déposer un colis · déposer un lot | Champs pré-remplis, modifiables |
| **Rejouer le dernier appel** | Le test d'idempotence en une touche |
| **Requête libre** | Chemin et corps JSON au choix, pour les cas non prévus |
| Suivi : marchands liés · colis ingérés · journal | La contrepartie côté Mathio |
| Purger les données de test | Le même code que le bouton du back-office |

**Pourquoi une console et pas un Swagger UI** : l'API machine ne pose **aucun en-tête CORS** — c'est
ce qui rend l'absence de contrôle d'`Origin` correcte sur son hôte — donc un Swagger servi dans un
navigateur se ferait refuser chaque appel. S'y ajoutent deux obstacles Windows : `api.localhost` ne
résout pas, et PowerShell 5.1 mutile le JSON passé en ligne de commande. La console contourne les
trois.

Le secret d'une clé existante n'est pas récupérable (seul son SHA-256 est en base) : la console
propose donc soit de coller une clé, soit d'en **émettre une nouvelle**, gardée en mémoire pour la
session.

### La collection Postman : `scripts/postman/`

35 requêtes, **chacune portant ses assertions** — l'onglet « Test Results » dit vert ou rouge.
Couvre le cloisonnement d'hôte, l'authentification, les trois endpoints, les refus de
validation, le lot partiel, et les deux gardes de rattachement.

**Prérequis** : `HOST_API=127.0.0.1:3000` dans `.env`, puis redémarrer `npm run dev`. Windows ne
résout pas les sous-domaines `.localhost` — vérifié, `api.localhost` renvoie `ENOTFOUND` sous
Node comme sous .NET — donc Postman échouerait avant d'atteindre le serveur. Un navigateur, lui,
les résout tout seul. `api.localhost:3000` reste accepté en plus, les scripts existants ne
bougent pas.

Lancer le dossier « 1 » en premier : sa première requête fixe l'identifiant de passage et crée
les marchands dont dépendent les colis. Détail dans `scripts/postman/README.md`.

### L'audit d'administration et de sécurité : `npm run audit:plateformes`

**26 vérifications automatiques** qui couvrent l'essentiel des niveaux 3 et 4 : création de
plateforme et bornes du code, compte de service inerte, périmètre et plafond des clés, secret
jamais stocké en clair, rotation et révocation, suspension, `AuditLog` sur chacun de ces gestes,
permission `integrations:manage` réellement fermée, cookie de session qui n'ouvre pas l'API
machine, absence de `Set-Cookie` sur l'hôte dédié, compte de service incapable de se connecter sur
les trois espaces, journal sans donnée de client final, **idempotence sous dix appels
simultanés**, et purge complète et tracée.

Le script crée ses comptes, les préfixe, et les supprime en fin d'exécution.

Il ne reste alors à faire **à l'œil** que ce qui demande vraiment des yeux — cinq points, listés
à la fin de son exécution.

### Niveau 3 — L'écran d'administration, à la main

**Aucun test automatique ne couvre `/admin/integrations`.** C'est le premier trou à combler.

Se connecter en admin sur le domaine du back-office, puis :

| | À vérifier | Attendu |
|---|---|---|
| 3.1 | La navigation affiche « Intégrations » sous *Administration* | Visible pour un admin |
| 3.2 | Un compte **sans** `integrations:manage` (créer un superviseur depuis `/admin/equipe`) | L'entrée de menu **n'apparaît pas**, et l'accès direct à `/admin/integrations` redirige vers `/admin` |
| 3.3 | Créer une plateforme « Shipeh » | Le code est proposé d'après le nom (`shipeh`) et reste modifiable |
| 3.4 | Recréer le même code | 409, message explicite |
| 3.5 | Code invalide (`Shipeh!`, `-x`, `a`) | 400 avec la règle énoncée |
| 3.6 | Vérifier en base le compte de service | `role = 'plateforme'`, `actif = false`, ni téléphone ni email |
| 3.7 | Émettre une clé `test` en cochant « marchand déjà validé » | La case est **grisée et non cochable** ; côté serveur le refus existe aussi (400) |
| 3.8 | Émettre une clé sans aucun scope | Le bouton reste désactivé ; côté serveur, 400 |
| 3.9 | Émettre une clé `live` | La clé complète s'affiche **une seule fois** ; le bouton « Copier » fonctionne |
| 3.10 | Fermer puis rouvrir l'écran | La clé complète **n'est plus nulle part** ; seul le préfixe reste |
| 3.11 | Émettre une 3ᵉ clé live active | 409 : le plafond de 2 est appliqué |
| 3.12 | « Expirer » une clé | Badge « Expire le … » ; la clé fonctionne encore ; l'en-tête `Mathio-Key-Deprecation` apparaît dans la réponse |
| 3.13 | « Révoquer » une clé | Badge « Révoquée » ; les actions disparaissent ; la clé répond 401 `cle_revoquee` |
| 3.14 | Renommer la plateforme | Le nom du **compte de service** suit — sinon l'ancien nom s'afficherait comme auteur des colis ingérés après le changement |
| 3.15 | Après un `npm run simuler:shipeh` | Le journal des appels se remplit ; les refus portent un message ; **aucun corps de requête n'est stocké** (il porterait des données de clients finaux) |
| 3.16 | Onglet « Marchands synchronisés » | Les marchands créés y figurent avec leur `idExterne` et leur environnement |
| 3.17 | `/admin/equipe` | Le rôle `plateforme` n'y est **pas proposé** : ces comptes ne se créent pas à la main |
| 3.18 | Responsive et thème sombre | Les tables défilent dans leur cadre, la page ne défile pas latéralement |
| 3.19 | Bloc « Données de bac à sable » après un run du simulateur | Le compte de marchands et de colis `test` s'affiche ; il disparaît quand il n'y a rien |
| 3.20 | Bouton « Purger » | Confirmation chiffrée, puis les compteurs retombent à zéro. Les marchands et colis `live` sont intacts |
| 3.21 | `/admin/marchands` après un run du simulateur | Les marchands issus d'une clé de test portent une pastille **« test »** ; les vrais marchands n'en ont pas |
| 3.23 | `/admin/colis` après un run | Les colis déposés par une clé de test portent la même pastille, à côté de leur code de suivi. Les colis réels n'en ont pas |
| 3.22 | Un marchand rattaché (inscrit en direct puis revendiqué en test), après purge | **Il existe toujours.** C'est ce que garantit `creeParSynchro` |

### Niveau 4 — Sécurité, à vérifier explicitement

Ces points sont exercés par le simulateur mais méritent une vérification indépendante : ce sont
eux qui ne pardonnent pas.

| | Test | Commande / geste | Attendu |
|---|---|---|---|
| 4.1 | Le parcours complet **avec un vrai cookie de session admin** vers `/api/v1/colis` sur l'hôte du back-office | Depuis la console du navigateur, connecté en admin : `fetch('/api/v1/colis', {method:'POST'})` | **404**. Le cookie ne doit jamais ouvrir l'API machine |
| 4.2 | L'hôte de l'API ne pose **aucun** cookie | `curl -i -H "Host: api.localhost:3000" http://127.0.0.1:3000/api/v1/colis -X POST` | Aucun `Set-Cookie` dans la réponse |
| 4.3 | Le compte de service ne peut pas se connecter | Tenter `/api/auth/login` avec son email — il n'en a pas ; puis lui en poser un en base, `actif = true`, et retenter | 401 dans tous les cas : le rôle n'appartient à aucun espace |
| 4.4 | Le secret n'est pas en base | `SELECT prefixe, secret_hash FROM cles_api_plateforme` | Uniquement des SHA-256 de 64 caractères hex |
| 4.5 | Les colis d'une clé `test` ne sont pas facturables | Créer un marchand `test`, lui déposer un colis, ouvrir `/admin/factures` | Le marchand `test` est bien un marchand à part entière — **si vous ne voulez pas le voir en facturation, c'est une décision à prendre maintenant** (voir §9) |
| 4.6 | Le journal ne fuite pas | `SELECT * FROM journal_appels_api` | Ni nom, ni téléphone, ni adresse de client final |
| 4.7 | Un `Origin` forgé ne change rien sur l'hôte API | Rejouer un appel valide en ajoutant `Origin: https://evil.example` | Inchangé — il n'y a pas d'authentification ambiante à protéger |
| 4.8 | Concurrence sur l'idempotence | Lancer 10 fois **en parallèle** le même `POST /v1/colis` | **Un seul** colis en base. La garantie est la contrainte d'unicité, pas le code |

### Niveau 5 — Ce qui ne peut être validé qu'en préproduction

| | |
|---|---|
| **Hôte réel** | Poser `HOST_API=api.votre-domaine.ma`, un certificat TLS, et vérifier que le reverse proxy répercute bien `X-Forwarded-Host` sur `Host` — sinon tous les espaces se confondent |
| **Refus de démarrage** | `HOST_API` égal à un hôte d'espace → le démarrage doit **échouer** |
| **`HOST_API` absent** | En production, `/api/v1/**` doit être **injoignable partout**. Une intégration s'ouvre en posant une variable, pas en déployant du code |
| **Email d'invitation** | Configurer SMTP, créer un marchand avec une **vraie** adresse, et suivre le lien jusqu'à la définition du mot de passe et la connexion sur le domaine marchand. Vérifier que le lien pointe bien sur l'hôte marchand et non sur l'hôte API |
| **Quotas sous charge** | Un vrai lot de 200 colis, chronométré : vérifier que la requête tient dans le délai du reverse proxy et de la plateforme d'hébergement |
| **WAF et filtrage IP** | Le domaine ops est filtrable par IP/VPN, l'API doit rester joignable depuis Internet. Affaire d'infrastructure, hors application |

---

## 8. Checklist de validation définitive

```
Automatique
[ ] npm run lint                → aucune erreur
[ ] npm test                    → 171 tests, 0 échec
[ ] npm run db:migrate          → aucune migration en attente
[ ] npm run simuler:shipeh      → 39 OK, 0 KO
[ ] npm run simuler:shipeh      → rejoué une 2e fois, toujours 39 OK (idempotence du script)

Manuel — écran d'administration (§7.3)
[ ] Les 18 points du tableau, dont : clé affichée une seule fois, plafond de 2 clés,
    case « marchand validé » grisée sur une clé test, journal qui se remplit

Manuel — sécurité (§7.4)
[ ] Les 8 points, dont : un cookie de session admin n'ouvre pas /api/v1/**,
    aucun Set-Cookie sur l'hôte API, 10 appels concurrents → 1 seul colis

Préproduction (§7.5)
[ ] Hôte réel + TLS + X-Forwarded-Host
[ ] Démarrage refusé si HOST_API collisionne
[ ] /api/v1/** injoignable sans HOST_API
[ ] Email d'invitation suivi de bout en bout
[ ] Lot de 200 chronométré

Décisions à prendre avant la mise en service (§9)
[ ] Facturation des marchands d'environnement `test`
[ ] Documentation à remettre à Shipeh
[ ] Webhooks de retour de statuts : maintenant ou plus tard
```

---

## 9. Hors périmètre et points ouverts

### Volontairement hors périmètre

- **Webhooks de retour de statuts vers la plateforme.** Sans eux, Shipeh nous envoie des colis
  et ne sait jamais ce qu'ils deviennent — son marchand doit venir chez nous pour le savoir. La
  projection INTERNE → PUBLIC des statuts est **déjà spécifiée** au §5.3 d'`API_PARTENAIRES.md`
  et servirait telle quelle. C'est le prochain lot naturel.
- **Annulation d'un colis par la plateforme** (`POST /v1/colis/{ref}/annulation`).
- **Lecture d'un colis** (`GET /v1/colis/{ref}`) : aucune surface de lecture n'est exposée.
- **Documentation destinée à Shipeh.** Le présent document est écrit pour *nous*. Leurs
  développeurs auront besoin d'un équivalent réduit : endpoints, formats, codes d'erreur,
  rotation des clés — sans la carte de nos fichiers ni nos arbitrages internes.

### Points ouverts, à trancher

1. **Les marchands `test` restent de vrais marchands** — atténué, pas supprimé. Ils portent
   désormais une pastille « test » dans `/admin/marchands`, ils sont comptés sur
   `/admin/integrations`, et une purge les efface d'un geste. Mais tant qu'on ne l'a pas
   déclenchée, ils sont là : approuvables, facturables. C'est le prix de l'isolation logique
   dans une base unique, et il n'existe pas de moyen de l'annuler sans passer à une base
   séparée. **La discipline à tenir est donc opérationnelle** : purger avant la mise en
   service, et ne pas laisser traîner un bac à sable actif après l'intégration.
2. **Purge du journal.** `JournalAppelApi` grossit d'une ligne par appel. À 600 appels/minute, il
   faut une purge — rien n'est en place. Une tâche planifiée supprimant au-delà de 30 jours
   suffirait.
3. **`derniereUtilisationLe` et `nbAppels` sont écrits à chaque appel**, soit une écriture de
   plus par requête sur une même ligne. Acceptable à l'échelle visée ; à revoir si une
   plateforme sature son quota en continu.
4. **La limite de purge est fermée à la source, pas rattrapée après coup.** Les colis d'un
   marchand *rattaché* survivraient à une purge — `commandes` ne portant aucune marque
   d'environnement, on ne sait pas distinguer, chez un marchand qui est AUSSI un vrai client, un
   colis d'essai d'une commande réelle. Plutôt que d'ajouter une colonne `environnement` sur la
   table la plus chaude du schéma (et l'obligation permanente de l'exclure partout : facturation,
   routage, statistiques, listes), **le cas est rendu impossible** : une clé `test` ne peut pas se
   rattacher à un marchand réel, et une clé `live` ne peut pas se rattacher à un artefact de bac à
   sable. Un marchand lié en `test` a donc toujours été créé par la synchronisation, donc reste
   toujours purgeable — `colisConserves` vaut structurellement 0 pour toute donnée créée depuis
   ces gardes.
