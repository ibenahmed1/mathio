# Collection Postman — API plateformes partenaires (Shipeh)

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
