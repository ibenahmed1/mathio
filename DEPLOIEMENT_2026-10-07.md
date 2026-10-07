# Déploiement du 7 octobre 2026 — réseau en 11 hubs et référentiel des villes

Branche : `dev`, commit « Regrouper le réseau en 11 hubs régionaux et arrêter le référentiel des villes ».

Ce déploiement porte deux décisions de l'exploitation :

- **6 octobre** : les 24 agences des transporteurs sont regroupées en **11 hubs régionaux** ;
- **7 octobre** : il ne reste qu'**une ligne par ville**. Taza et Guercif passent à EST Livraison seul. Oujda et Taounate perdent leur ligne en double.

Il fait suite au déploiement du 3 octobre (`DEPLOIEMENT_2026-10-03.md`). Si ce dernier n'a pas encore été fait en production, suivre ses étapes 2, 3 et 7. **Ses étapes 4 et 5 sont remplacées par les étapes 4 et 5 ci-dessous** : le script de décisions reprend toutes les décisions d'octobre, anciennes et nouvelles.

## Étapes, dans l'ordre

### 1. Sauvegarder la base

Les étapes 3 et 4 déplacent puis suppriment des hubs et des villes. Il n'y a pas de retour arrière automatique : sauvegarder la base avant.

### 2. Déployer le code

Ce déploiement n'apporte **aucune migration** de base de données. `npx prisma migrate deploy` peut être lancé comme d'habitude, mais il ne doit rien trouver de nouveau.

Redémarrer le serveur après le build.

### 3. Regrouper les agences en 11 hubs régionaux

**`prisma migrate deploy` ne fait pas cette étape. Il faut la lancer à la main.**

```
npx tsx scripts/regrouper-hubs-regionaux.ts          # à blanc : affiche ce qui sera fait, n'écrit rien
npx tsx scripts/regrouper-hubs-regionaux.ts --oui    # applique
```

Ce que fait le script :

- **Hub central** : il est renommé « Hub Central ». Il reste séparé et ne sert jamais de destination.
- **Hub qui reprend chaque région** : pour chaque région, l'agence du transporteur installée dans la ville principale devient le hub régional. Elle est renommée, son identifiant ne change pas.
- **Agences absorbées** : elles lui transfèrent leurs villes, leurs colis, leurs comptes rattachés, leurs bons et leur historique, puis sont supprimées.
- **Villes** : elles sont déplacées, jamais recréées. Aucun tarif ni aucun coût d'achat ne change.

Les 11 hubs :

| Hub | Transporteur |
|---|---|
| Hub Tanger | Amir Livraison |
| Hub Oujda | EST Livraison |
| Hub Agadir | Leader Colis |
| Hub Guelmim | Sahario Express |
| Hub Rabat, Hub Casablanca, Hub El Jadida, Hub Safi, Hub Marrakech | Power Delivery |
| Hub Fès | Meta Livraison (ex-9 agences) |
| Hub Béni Mellal | Colivraison (ex-6 agences) |

Résultat attendu en fin de rapport : `contrôle : … villes, 0 doublon(s), 0 agence(s) restante(s)`.

Si le script s'arrête sur un **blocage**, typiquement une même ville présente dans deux agences d'une même région, il n'écrit rien. **Ne pas contourner : prévenir l'équipe.**

### 4. Appliquer les décisions de villes

**Condition préalable (inchangée depuis le 3 octobre) : aucune tournée interne contenant des colis de Casablanca ne doit être ouverte.** Le script le vérifie lui-même.

```
npx tsx scripts/decisions-villes-octobre-2026.ts          # à blanc
npx tsx scripts/decisions-villes-octobre-2026.ts --oui    # applique
```

À lancer **après l'étape 3**, car le script cherche les villes par hub régional. Il s'applique en une seule transaction et peut être relancé sans effet.

Nouveautés du 7 octobre, en plus des décisions déjà décrites le 3 octobre :

| Décision | Effet en base |
|---|---|
| **Taza et Guercif à EST Livraison seul** | `TAZA` et `GUERCIF` (Meta, Hub Fès) sont supprimées. Leurs colis sont rattachés à `Taza Ville` et `Guercif Ville` (EST, Hub Oujda). Même prix d'achat : 25 dh. |
| **Oujda : une seule ligne** | `Oujda (Centre & Quartiers)` est fusionnée dans `Oujda` (EST, 15 dh). |
| **Taounate : une seule ligne** | `taounate centre` est fusionnée dans `Taounate` (Meta, 25 dh). |

Lignes attendues dans le rapport, pour une base qui ne les a pas encore :

```
« TAZA » supprimée
« GUERCIF » supprimée
« Oujda (Centre & Quartiers) » supprimée
« taounate centre » supprimée
```

Une ligne `… : absente, déjà fait` est normale si la décision est déjà appliquée.

**Colis saisis sous un nom de grille** : un colis saisi « Oujda (Centre & Quartiers) », « taounate centre », « TAZA » ou « GUERCIF » est toujours reconnu et part vers la ligne restante. Les envois par API aux transporteurs ne changent pas : Oujda part chez EST sous « OUJDA », Taounate chez Meta sous sa ville n°577.

### 5. Contrôler « une ville, un transporteur »

```
npx tsx scripts/appliquer-routage-moins-cher.ts          # à blanc
npx tsx scripts/appliquer-routage-moins-cher.ts --oui    # seulement si des colis en attente sont listés
```

Résultat attendu :

```
Villes desservies par plusieurs transporteurs : 0
✔ Aucune ville n’est desservie par plusieurs transporteurs.
```

Si une ville apparaît comme partagée entre deux transporteurs, le script s'arrête sans rien écrire. **Ne pas forcer : prévenir l'équipe.**

### 6. Vérifier

Ces contrôles ne font que lire.

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

L'audit compare chacune des villes des 11 hubs, avec son prix, aux grilles des 7 transporteurs : 470 lignes, dont la grille Colivraison, retranscrite le 7 octobre. Il compare aussi les 5 villes d'implantation dont le prix a été fixé par décision (Fès, Boulmane, Taounate, Oujda, El Jadida). Les `ÉCARTS DE GRAPHIE` (7, uniquement des différences de majuscules) ne sont pas bloquants. Les villes du hub de test « Hub Audit Tournée » sont ignorées.

**Tout écart de contenu en production (ligne absente, tarif divergent, ville sans origine) doit être remonté à l'équipe avant de poursuivre.**

Puis, comme le 3 octobre (ces deux scripts interrogent les API des transporteurs) :

```
npx tsx scripts/verifier-villes-power-delivery.ts     # attendu : « Aucun écart. »
npx tsx scripts/verifier-villes-colivraison.ts        # attendu : « Aucun écart. »
```

## Conséquences pour l'exploitation

- L'écran des hubs et la création des bons d'envoi ne montrent plus que les **11 hubs régionaux**. Les anciens noms d'agence (Meknès, Taza, Errachidia…) sont devenus des villes de ces hubs.
- **Taza et Guercif partent chez EST Livraison**, au même prix qu'avant (25 dh).
- Oujda et Taounate ne s'affichent plus qu'une fois, sous leur nom usuel.
- Chaque ville n'a toujours qu'un transporteur.
- **Shipeh** : quatre codes de ville disparaissent de `GET /api/v1/villes` (les lignes `TAZA`, `GUERCIF`, `Oujda (Centre & Quartiers)` et `taounate centre`). Leur demander de **recharger la liste des villes** après le déploiement. Les colis qu'ils envoient avec le nom de ville restent reconnus, quelle que soit la graphie (« Taza », « TAZA », « Oujda (Centre & Quartiers) »…).

## À ne pas faire

- **Ne pas lancer `npm run db:reseau` sur la production.** Cette commande réaligne tous les tarifs sur les grilles d'origine et écrase les corrections faites depuis l'application.
- **Ne pas lancer `scripts/restituer-lignes-sources.ts`.** C'était un script à usage unique, déjà passé. Rejoué, il remettrait en place des noms de grille que les décisions ci-dessus ont retirés.
- Ne pas inverser les étapes 3 et 4.
