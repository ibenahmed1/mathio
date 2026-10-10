# Déploiement du 10 octobre 2026 — note unique

**Cette note remplace celles du 3 octobre (`DEPLOIEMENT_2026-10-03.md`) et du 7 octobre
(`DEPLOIEMENT_2026-10-07.md`), qui n'ont pas été déployées.** Ne plus suivre ces deux notes, ni
les consignes envoyées séparément avant le 10 octobre : tout ce qu'elles demandaient est repris
ici, dans le bon ordre, avec les décisions prises depuis.

Branche : `dev` (GitHub `ibenahmed1/mathio`), dernier commit du 10 octobre.

Ce que le déploiement apporte :

- **Transporteurs** : remise par API à Meta Livraison et EST Livraison ; Casablanca passe à
  Power Delivery.
- **Villes** : réseau regroupé en 11 hubs régionaux, une ville = un transporteur, 46 villes
  ajoutées (API Power). Au total **500 villes**, chacune avec son transporteur et son tarif.
- **Stock** : un colis peut contenir plusieurs produits ; stock suivi par variante ; alerte quand
  un produit tombe à 10.
- **Shipeh** : identifiants des marchands, produits de stock, colis à plusieurs produits, liste
  des villes au tarif Shipeh de 30 dh.
- Notifications (cloche et push), comptabilité marchand, équipe et rôles back-office,
  simulateur de rentabilité.

## Étapes, dans l'ordre

### 1. Sauvegarder la base

L'étape 5 déplace, fusionne et supprime des hubs et des villes. Il n'y a pas de retour arrière
automatique : **sauvegarder la base de production avant de commencer.**

### 2. Répéter sur une copie (fortement recommandé)

Restaurer la sauvegarde sur une base de test, y faire les étapes 3 à 6, et vérifier que le
contrôle final de l'étape 5 est vert. C'est la seule façon de voir le déroulé complet de
l'étape 5 avant de toucher la production (voir la remarque « À blanc » de cette étape).

### 3. Déployer le code et appliquer les migrations

```
npx prisma migrate deploy
```

Huit migrations, toutes en **ajout seul**, sans perte de données :

| Migration | Effet |
|---|---|
| `20261003100000_remise_ville_par_nom` | rend `remises_prestataire.city_id` facultatif, ajoute `ville_envoyee` |
| `20261005100000_permission_simulateur` | donne le droit `simulateur:use` aux comptes `admin` |
| `20261005120000_simulations_rentabilite` | table des scénarios du simulateur |
| `20261006120000_notifications_cloche_coupes` | préférences de cloche par compte |
| `20261007120000_audit_details` | détail des actions dans le journal de l'équipe |
| `20261007130000_roles_backoffice` | rôles de l'équipe interne |
| `20261010120000_stock_variantes_colis` | variante consommée par un colis, dates de réservation et de réintégration du stock |
| `20261010130000_colis_multi_produits` | table `lignes_colis` (contenu des colis) ; chaque colis existant reçoit sa ligne |

Si la production a déjà certaines de ces migrations, `migrate deploy` ne joue que les autres.

**Redémarrer le serveur après le build.** Un serveur lancé avec l'ancien client Prisma répond
500 sur les nouvelles routes.

### 4. Variables d'environnement

À vérifier sur le serveur (voir `.env.example`) :

| Variable | Rôle | Si absente |
|---|---|---|
| `HOST_API` | domaine de l'API des partenaires (Shipeh, webhooks transporteurs) | aucune API partenaire ne répond |
| `META_LIVRAISON_CLE`, `META_LIVRAISON_SECRET` | notre compte partenaire Meta Livraison | la remise à Meta échoue |
| `META_LIVRAISON_WEBHOOK_SECRET` | signature de leur webhook | leurs statuts sont refusés |
| `EST_LIVRAISON_CLE` | notre compte EST Livraison | la remise à EST échoue |
| `FIREBASE_*` (7 variables) | notifications push | pas de push ; la cloche fonctionne quand même |

Ne pas définir `META_LIVRAISON_BASE_URL` en production : cette variable sert uniquement aux tests.

### 5. Mettre les villes à l'état validé — une seule commande

**Condition préalable : aucune tournée interne contenant des colis de Casablanca ne doit être
ouverte.** Le script le vérifie lui-même et s'arrête sinon.

```
npx tsx scripts/deployer-referentiel-villes.ts          # à blanc : affiche ce qui sera fait, n'écrit rien
npx tsx scripts/deployer-referentiel-villes.ts --oui    # applique
```

Le script amène la base **exactement** à l'état validé le 10 octobre, enregistré dans
`scripts/referentiel-villes-photo.json` (12 hubs, 500 villes, un transporteur et un tarif par
ville). Il enchaîne cinq étapes et s'arrête à la première qui échoue :

| Étape | Ce qu'elle fait |
|---|---|
| 1. Regroupement en hubs régionaux | Les agences des transporteurs deviennent **11 hubs régionaux** ; le hub central devient « Hub Central ». Villes, colis, comptes, bons et historique sont **déplacés**, jamais recréés. |
| 2. Décisions de villes d'octobre | Casablanca chez Power ; villes retirées ou fusionnées, **leurs colis rattachés à la ville restante** ; une ville = un transporteur ; tarifs ; retour à 0 dh partout ; les 46 villes de l'API Power ajoutées avec leur tarif ; Tata retirée ; « azrou » devient « Azrou (Ifrane) ». |
| 3. Alignement sur la photo | Corrige ce qui diffère encore de l'état validé : tarif modifié depuis, ville manquante, ville écrite autrement. Chaque correction est listée. **Ne supprime jamais rien.** |
| 4. Une ville, un transporteur | Vérifie qu'aucune ville n'a deux transporteurs ; rattache les colis en attente à la bonne ville. Un colis déjà confié à un transporteur n'est jamais modifié. |
| 5. Contrôle final | Compare la base à la photo. Doit être identique. |

**À blanc** sur la production actuelle, seule l'étape 1 peut être simulée : les étapes suivantes
cherchent les villes par hub régional, qui n'existent qu'une fois l'étape 1 appliquée. Le script
le dit et s'arrête. D'où la répétition sur une copie (étape 2 de cette note).

Le script peut être **relancé sans risque** : une étape déjà faite ne trouve rien à faire.

Résultat attendu en fin de rapport :

```
=== 5. Contrôle final ===

   ✔ Référentiel identique à la photo du 2026-10-10 : 12 hubs, 500 villes.
```

**S'il s'arrête sur un « ✘ » : ne pas contourner, prévenir l'équipe**, avec le rapport complet.
Cas connus :

- *Tournée interne de Casablanca ouverte* (étape 2) : la clôturer, puis relancer.
- *Ville à retirer qui porte encore des colis sans ville d'accueil* (étape 2) : la ville est
  nommée ; réaffecter ses colis, puis relancer.
- *Villes en base absentes de la photo* (étape 5) : une ville existe en production sans exister
  dans l'état validé, probablement créée depuis l'écran des hubs. Le script ne la supprime pas
  (elle peut porter des colis) : l'équipe décide.

### 6. Vérifier

Ce contrôle ne fait que lire :

```
npx tsx scripts/auditer-conformite-sources.ts
```

Attendu :

```
LIGNES DU FICHIER ABSENTES DE LA BASE : 0
TARIFS DIVERGENTS : 0
VILLES EN BASE SANS LIGNE SOURCE : 0
✔ Contenu conforme : chaque ligne des fichiers est en base, dans la bonne agence, au bon prix.
```

Les `ÉCARTS DE GRAPHIE` (7, uniquement des différences de majuscules) ne sont pas bloquants.

**Ne plus lancer** `scripts/verifier-villes-power-delivery.ts` ni
`scripts/verifier-villes-colivraison.ts`, que demandaient les notes du 3 et du 7 octobre : ils
cherchent encore les anciennes agences et signalent de faux écarts depuis le regroupement en
hubs régionaux.

### 7. Shipeh

Les API partenaires sont servies sur le domaine `HOST_API`, sous `/api/v1` :

| Endpoint | Rôle |
|---|---|
| `POST /v1/marchands` | créer le compte d'un marchand, avec son email et son mot de passe Shipeh |
| `POST /v1/produits` | déclarer un produit de stock (SKU, variantes, quantité envoyée) |
| `POST /v1/colis`, `POST /v1/colis/lot` | déposer des colis contenant un ou plusieurs produits de stock |
| `GET /v1/villes` | nos 500 villes, au tarif Shipeh de 30 dh |

Les droits d'une clé ne se modifient pas. Il faut donc, dans `/admin/integrations`, sur la
plateforme Shipeh :

1. **créer une clé `test`** avec `marchands:creation`, `produits:creation`, `colis:creation`,
   `villes:lecture` ;
2. **créer une clé `live`** avec `marchands:creation_validee`, `produits:creation`,
   `colis:creation`, `villes:lecture` ;
3. copier chaque clé **au moment de sa création** (elle ne se réaffiche jamais) et la
   transmettre à Shipeh par un canal sûr, avec l'adresse `https://<HOST_API>/api/v1` et
   `DOCUMENTATION_SHIPEH.md` ;
4. si Shipeh utilise déjà une ancienne clé, la mettre en expiration une fois les nouvelles en
   service.

Vérification :

```
curl -H "Authorization: Bearer <clé>" https://<HOST_API>/api/v1/villes
# attendu : 200, { "devise": "MAD", "nombre": 500, "villes": [ { "nom", "code", "tarifLivraison": 30 }, … ] }
```

## Conséquences pour l'exploitation

- **Hubs** : l'écran des hubs et la création des bons d'envoi ne montrent plus que les 11 hubs
  régionaux. Les anciens noms d'agence (Meknès, Taza, Errachidia…) sont devenus des villes de ces
  hubs.
- **Casablanca et sa région** partent chez **Power Delivery**, et non plus chez nos livreurs.
- **Une ville = un transporteur**, quelle que soit l'orthographe saisie (« Bouleman » part chez
  Meta comme « Boulmane », « TAZA » chez EST comme « Taza Ville »).
- **Retour à 0 dh** chez tous les transporteurs.
- **Stock** : un colis peut contenir plusieurs produits. Le stock de chaque produit est réservé
  au passage en préparation. Quand un produit tombe à 10, l'admin et les agents d'inventaire
  reçoivent une alerte « Stock bas ».
- **Shipeh** : leurs colis doivent citer des SKU déclarés au préalable ; un SKU inconnu bloque le
  colis. **La liste des villes change** (codes retirés, 46 villes ajoutées) : leur demander de la
  recharger après le déploiement.

## À ne pas faire

- **Ne pas lancer `npm run db:reseau` sur la production.** Cette commande réaligne tous les
  tarifs sur les grilles d'origine et écrase les corrections faites depuis l'application.
- **Ne pas lancer `scripts/restituer-lignes-sources.ts`.** Script à usage unique, déjà passé.
- **Ne pas lancer séparément** `regrouper-hubs-regionaux.ts`, `decisions-villes-octobre-2026.ts`
  ou `appliquer-routage-moins-cher.ts` : l'étape 5 les enchaîne dans le bon ordre.
- **Ne pas reprendre la photo** (`scripts/referentiel-villes-photo.ts`) sur la production : elle
  fait foi parce qu'elle a été prise sur l'état validé.
