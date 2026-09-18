# Collections Postman — API machine

Deux collections, pour les **deux audiences** de l'API machine. Elles partagent la mécanique de
clés et l'hôte, jamais le périmètre de données :

| Fichier | Audience | Ce qu'elle fait |
|---|---|---|
| `shipeh.postman_collection.json` | plateforme de **vente** | nous **dépose** des marchands et des colis |
| `prestataires.postman_collection.json` | **transporteur** sous-traitant | nous **déclare l'issue** des colis qu'on lui a confiés |

Le §« Mise en route » ci-dessous vaut pour les deux — seule l'étape 4 diffère. La collection
prestataires est détaillée en fin de fichier.

---

## Collection Shipeh — API plateformes partenaires

Tests manuels de l'API machine. 35 requêtes, **chacune portant ses propres assertions** :
l'onglet « Test Results » dit vert ou rouge, il n'y a rien à lire à l'œil.

## Mise en route

1. **`.env`** doit contenir :

   ```
   HOST_API=127.0.0.1:3000
   ```

   Indispensable, et voici pourquoi : Windows ne résout pas les sous-domaines `.localhost`
   (vérifié — `api.localhost` renvoie `ENOTFOUND` sous Node comme sous .NET). Postman, qui
   tourne sur Node, échouerait donc avant même d'atteindre le serveur. Un navigateur, lui,
   résout `*.localhost` tout seul : c'est pour ça que le back-office fonctionne sans rien faire.

   `api.localhost:3000` reste accepté en plus de cette valeur en développement — les scripts
   existants continuent de marcher.

2. **Redémarrer** `npm run dev` (la variable est lue au démarrage).

3. **Importer** dans Postman les deux fichiers de ce dossier : la collection et l'environnement.

4. **Émettre deux clés** depuis `/admin/integrations` — une `test`, une `live` — et les coller
   dans les variables `cleTest` et `cleLive` de l'environnement. Elles ne s'affichent qu'une
   fois : les copier immédiatement.

   Pour que le dossier 1.3 passe, la clé `live` doit détenir le scope
   `marchands:creation_validee`.

## Ordre d'exécution

**Lancer le dossier « 1 » avant les autres.** Sa première requête fixe l'identifiant de passage
(`{{passage}}`), refixé à chaque exécution, et crée les marchands dont dépendent les colis. Le
Collection Runner exécute tout dans l'ordre : c'est la façon la plus simple de tout jouer.

| Dossier | Ce qu'il couvre |
|---|---|
| **0** | Cloisonnement d'hôte, authentification, absence de cookie, JSON illisible |
| **1** | Marchands : création test et live, rejeu, champ complet, six refus de validation |
| **2** | Colis : dépôt, rejeu idempotent, bornes numériques, marchand inconnu |
| **3** | Lot : valide, rejeu, partiellement invalide, vide, au-delà du plafond |
| **4** | Cloisonnement bac à sable / production, et les deux gardes de rattachement |

## Ce que la collection ne couvre pas

Trois choses, parce qu'elles demandent une configuration particulière plutôt qu'une requête :

- **Clé révoquée / expirée** : révoquer ou expirer une clé depuis `/admin/integrations`, puis
  rejouer n'importe quelle requête. Attendu `401 cle_revoquee` / `401 cle_expiree`.
- **Scope manquant** : émettre une clé sans `colis:creation` et rejouer le dossier 2.
  Attendu `403 scope_manquant`.
- **Quota** : émettre une clé avec `quotaParMinute` à 2, puis trois requêtes de suite.
  Attendu `429 quota_depasse` à la troisième.

## Après la séance

Purger les données de bac à sable depuis `/admin/integrations` : les marchands et colis créés
par la clé `test` sont de vraies lignes dans les vraies tables.

## Exécution sans Postman

`npm run simuler:shipeh` couvre le même terrain en 39 vérifications automatiques, et nettoie
derrière lui. `npm run shipeh` ouvre une console interactive pour improviser.

---

## Collection prestataires — API de suivi

`prestataires.postman_collection.json` — 14 requêtes, mêmes assertions embarquées. Elle couvre le
flux décrit dans `API_SUIVI_PRESTATAIRES.md` : un transporteur nous déclare qu'un colis est livré,
reporté, refusé.

### Ce qu'il faut avant de lancer

Les étapes 1 à 3 de la mise en route sont les mêmes. L'étape 4 diffère sur deux points, et ce sont
les deux causes d'échec au démarrage :

1. **La plateforme doit être rattachée à un transporteur.** Dans `/admin/integrations` →
   « Nouvelle plateforme », choisir le transporteur dans le sélecteur. C'est ce choix — et lui
   seul — qui fait de ce compte un compte de prestataire. Sans lui, tout répond
   `403 compte_sans_prestataire`.
2. **La clé doit être une clé `live` portant le scope `livraisons:statut`.** Le scope n'apparaît que
   sur un compte rattaché, et il est le seul proposé sur un tel compte : les scopes de vente y sont
   refusés à l'émission.

   ⚠️ **`livraisons:statut` est refusé sur une clé `test`**, et ce n'est pas un oubli : cet endpoint
   ne crée rien, il **mute des colis réels**. Rien à marquer, rien à purger — contrairement aux
   marchands créés en test. Un bac à sable qui écrit en production n'en est pas un. Le formulaire
   d'émission propose donc `live` par défaut sur un compte de transporteur, et grise le scope
   lorsqu'on bascule en `test`.

Puis, dans l'onglet **Variables** de la collection, colonne **Current value** (l'*Initial value* ne
part pas dans les requêtes), renseigner `cleLive` et **trois codes de suivi de colis réellement
confiés à ce transporteur** (`colisA`, `colisB`, `colisC`).

> **Qu'est-ce qu'un colis « confié » ?** Un colis dont le hub actuel est une agence de ce
> transporteur (`Commande.hubActuelId` → `Hub.prestataireId`). Un colis qui n'y est pas répond
> `404`, **même si son code existe** — c'est le périmètre, pas une panne. Le même 404 couvre les
> deux cas volontairement : les distinguer dirait à qui sonde quels codes de suivi existent.

### Les trois dossiers

| Dossier | Ce qu'il couvre |
|---|---|
| **0** | Branchement : clé absente, clé valide, catalogue des 12 statuts |
| **1** | Un colis : livré, rejeu idempotent, report daté, et six refus (date absente, date ambiguë, statut anglais, statut interne, colis inconnu, colis clos) |
| **2** | Lot : mixte avec une ligne fautive, et lot vide |

**Le dossier 1 ferme `colisA`** — sa requête 1.1 le passe à « livré ». C'est voulu : 1.9 vérifie
ensuite qu'un colis clos refuse tout nouveau statut. Lancer les dossiers dans l'ordre.

**La collection est rejouable.** Les assertions acceptent `applique` comme `inchange` : rejouer une
déclaration est un cas normal, pas une erreur, et c'est précisément ce que teste 1.2.

### Les deux paires à ne jamais laisser dériver

Ce sont les seules dont un échec est un vrai défaut de sécurité, pas une régression de confort :

- **1.8 et le 404 de périmètre** — un colis inconnu et un colis d'un autre transporteur doivent
  rendre le même code. Un `403` sur le second serait une fuite d'information.
- **1.2 et 1.9** — rejouer le même statut reste neutre (`200 inchange`), changer le statut d'un
  colis clos est refusé (`409`). L'idempotence passe AVANT la clôture : dans l'ordre inverse, un
  lot rejoué après une livraison ferait remonter des erreurs sur des colis parfaitement traités.

### Ce que la collection ne couvre pas

- **Clé de canal de vente** sur ces endpoints (attendu `403 compte_sans_prestataire`) : demande une
  seconde plateforme, non rattachée.
- **L'effet en base** — Postman voit les réponses HTTP, pas les lignes écrites. C'est `npm run
  simuler:prestataire` qui le vérifie (ci-dessous).

### Exécution sans Postman

```bash
npm run colis:confies              # quels colis sont déclarables, et par qui
npm run colis:confies PD-101686    # pourquoi CE colis l'est, ou ne l'est pas
npm run simuler:prestataire        # les 21 vérifications, de bout en bout
```

`simuler:prestataire` — **28 vérifications**. Il crée ses propres clés (`test`, `live`, révoquée,
expirée, à quota bridé), les révoque toutes à la fin, monte un second compte machine temporaire sur
un autre transporteur puis le supprime, et prend trois colis déclarables — ou ceux qu'on lui passe
en argument. Il exerce les mêmes appels que la collection, **plus ce que Postman ne peut pas
faire** :

| Vérification | Pourquoi elle ne peut pas se faire au JSON |
|---|---|
| Le colis est passé à `livre`, `dateLivraison` posée | l'API renvoie l'issue, pas l'état stocké |
| **UNE seule ligne d'historique malgré le rejeu** | l'idempotence pourrait répondre « inchange » tout en empilant des lignes qui laisseraient croire à une seconde tentative |
| L'historique est signé du **compte de service** | c'est la seule chose qui rende la trace honnête |
| `hubId` reste nul sur cette ligne | la colonne ne se renseigne qu'aux transitions posées à un quai |
| La note est devenue un commentaire de colis | et non un `motifRetour`, qui porte une liste fermée |
| `dateNouvelleLivraison` est renseignée | c'est elle qui met le colis dans la file de relance |
| **Un vrai colis d'un vrai concurrent → 404** | demande deux comptes machine sur deux transporteurs |
| **Cinq déclarations simultanées → une seule ligne** | teste le verrou optimiste sous charge réelle |
| Clé révoquée, expirée, quota dépassé | demandent des clés fabriquées pour l'occasion |

⚠️ **Il écrit pour de vrai** : le premier colis finit `livre`, donc facturable au marchand. Il ne
crée ni ne supprime aucun colis — il n'utilise que ceux qu'on lui donne.
