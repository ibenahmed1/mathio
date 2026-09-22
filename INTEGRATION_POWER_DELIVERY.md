# Intégration Power Delivery — remise et suivi par LEUR API

Ce document décrit le branchement de Mathio sur l'API de **Power Delivery** (`elog.ma`), un de nos
transporteurs sous-traitants. Il est écrit **pour nous** : sens du flux, carte des fichiers,
décisions, mise en service, tests, points ouverts.

Ne pas le confondre avec ses voisins :

| Document | Qui appelle qui | État |
|---|---|---|
| `API_SUIVI_PRESTATAIRES.md` | le transporteur **nous** appelle, dans notre format | implémenté |
| `API_PARTENAIRES.md` | spécification large de la sous-traitance sortante | spécification |
| **ce document** | **nous** appelons Power, dans **son** format ; il nous pousse ses webhooks | implémenté |

`API_SUIVI_PRESTATAIRES.md` §10 pariait que Power « ne brancherait probablement jamais d'API ». Il
en a une — une API client ordinaire, celle qu'il donne à toute boutique. C'est donc à nous de
l'adopter : ce module en est l'adaptateur.

---

## 1. Le flux

```
bon d'envoi vers une agence Power
   │  bouton « Remettre à Power Delivery »
   ▼
POST addparcelsnew (un colis par appel) ──► RemisePrestataire  ─► colis « Remis à un transporteur »
                                                 ▲
webhook signé  ──► POST /api/v1/webhooks/power-delivery ─┤
trackparcel    ◄── bouton « Actualiser » / rattrapage   ─┘ ─► statut du colis (même règle que notre API)
```

- La remise **remplace l'export Excel** du bon pour les villes qu'ils identifient. L'Excel reste la
  voie des autres (§4).
- Statuts **appliqués** : la livraison (livré, refusé, reporté, injoignable…), la mise en
  distribution, le retour. Leur logistique interne (ramassé, expédié, en voyage…) est seulement
  **mémorisée** sur la remise (`lib/power-delivery-statuts.ts`, décision du 22/09/2026).
- Les actions sur un colis confié (actualiser, transmettre une correction, demander un retour,
  relivrer) sont dans la modale de suivi du colis.

---

## 2. Carte des fichiers

| Fichier | Rôle |
|---|---|
| `lib/power-delivery.ts` | client HTTP de leur API, construction du colis transmis |
| `lib/power-delivery-statuts.ts` | leurs 29 statuts → appliqué / mémorisé / inconnu |
| `lib/power-delivery-villes.ts` | nos 91 villes Power → leur `cityId` (85 rapprochées, 6 mises de côté) |
| `lib/remise-power-delivery.ts` | remise d'un bon d'envoi, colis par colis |
| `lib/suivi-power-delivery.ts` | signature, lecture et application d'un webhook ou d'un suivi |
| `lib/actions-power-delivery.ts` | état, actualisation, correction, retour, relivraison |
| `lib/livraison-statut.ts` | `deciderTransitionStatut` + `ecrireTransition`, **partagés** avec notre API de statuts |
| `app/api/bons-envoi/[id]/remise-power-delivery` | la remise |
| `app/api/commandes/[id]/power-delivery/**` | l'état et les quatre actions |
| `app/api/v1/webhooks/power-delivery` | réception des webhooks — **sans session** (§5) |
| `components/admin/RemisePowerDelivery.tsx`, `PowerDeliveryColis.tsx` | les écrans |
| `scripts/verifier-villes-power-delivery.ts` | contrôle des villes contre leur API, lecture seule |
| `scripts/configurer-webhook-power-delivery.ts` | déclare notre récepteur chez eux |
| `scripts/suivre-colis-power-delivery.ts` | rattrapage du suivi, à blanc par défaut |
| `scripts/simuler-power-delivery.ts` | bout en bout contre un faux Power, base de test seulement |
| migration `20260922121607_remises_prestataire` | `remises_prestataire`, `evenements_prestataire` |

**`commandes` ne reçoit aucune colonne.** Abandonner l'intégration reviendrait à supprimer deux
tables.

---

## 3. Ce que leur documentation dit de faux

Vérifié par de vrais appels le 21/09/2026 — **ne jamais écrire une correspondance d'après leur doc** :

- `listcities` répond `{ success, data, total }`, pas un tableau nu ;
- les codes réels sont `OUT_OF_AREA`, `CANCELED`, `EN_VOYAGE`… et non `HORS_ZONE`, `CANCELLED`,
  `ENVG`. Les deux graphies sont acceptées ;
- la réponse de `addparcelsnew` n'est **pas documentée** : elle est lue de façon défensive et
  conservée brute sur la remise ;
- trois vocabulaires coexistent (codes de suivi, `status` + `status_second` des webhooks, noms
  d'événements en français). On ne lit que les codes.

Leurs **libellés**, eux, sont mot pour mot ceux de nos 27 statuts d'origine : même famille de
logiciel. Ce qui ne dit pas que les mots veulent dire la même chose — leur « Retourné » est notre
« en retour », jamais notre `retourne`, terminal.

---

## 4. Décisions

| Décision | Pourquoi |
|---|---|
| Villes par **identifiant**, jamais par nom | un nom approchant peut être rattaché ailleurs, sans erreur |
| 6 villes mises de côté (`SIDI HAJAJ`, `ASNI`, `moulay brahim`, `El arjat`, `TEMSENA`, `ouargui`) | absentes de leur API, ou deux identifiants chez eux. Livrables par Excel, en attente de leur réponse |
| Code envoyé : `MTH-` + notre code | leur `parcel_code` est unique pour **tous** leurs clients |
| Le marchand n'est **jamais** transmis, ni ses notes libres | lui donner notre client |
| COD **figé** à la remise ; une correction le met à jour, tracée | c'est la dette du transporteur |
| `reporte` accepté **sans date** pour ce canal | ni leurs webhooks ni leur suivi n'en portent |
| `CANCELED` applique `annule` ; une **relivraison** demandée par nous le rouvre | `annule` reste terminal : c'est un geste humain tracé qui rouvre, jamais un statut externe |
| `payment_status` mémorisé, **jamais** posé sur `etatPaiement` | deux dettes, dans deux sens |
| Permission : `bon_envoi:manage` | même responsabilité que le bon d'envoi |
| Libellés : « Remis à un transporteur », « En retour par un transporteur » | le nom du transporteur est sur la remise, pas dans l'enum |

---

## 5. Le webhook, seule route sans session

`POST /api/v1/webhooks/power-delivery` n'a ni `requireUser` ni `requirePermission` : c'est **leur**
serveur qui appelle. L'exception est écrite dans `lib/permission-routes.ts`. Le contrôle d'accès :

- n'existe que sur `HOST_API` (404 partout ailleurs, `proxy.ts` §1 bis) ;
- **signature HMAC-SHA256 obligatoire** (optionnelle chez eux), hex nu ou `sha256=…`, comparée en
  temps constant. Sans `POWERDELIVERY_WEBHOOK_SECRET`, tout est refusé ;
- `timestamp` du corps (signé, contrairement à l'en-tête) dans une fenêtre de 10 minutes ;
- plafond de 300 appels par minute et par IP ;
- tout est journalisé dans `evenements_prestataire`, **rejets compris**.

Les codes de réponse pilotent leurs trois tentatives : 401 / 400 pour ce qu'il ne sert à rien de
rejouer, 200 pour tout ce qui a été lu (colis inconnu compris), 500 pour une panne chez nous.

---

## 6. Mise en service

1. `npm run db:migrate` — crée les deux tables.
2. `/admin/integrations` → nouvelle plateforme `power-delivery`, **rattachée au transporteur Power
   Delivery**. C'est son compte de service qui signe les statuts reçus. **Aucune clé à émettre** :
   Power ne nous appelle pas avec une de nos clés.
3. `.env` : `POWERDELIVERY_TOKEN`, `POWERDELIVERY_WEBHOOK_SECRET` (cf. `.env.example`), `HOST_API`.
4. `npx tsx scripts/verifier-villes-power-delivery.ts` — doit dire « Aucun écart ».
5. `npx tsx scripts/configurer-webhook-power-delivery.ts --configurer https://<HOST_API>/api/v1/webhooks/power-delivery`
6. Planifier `npx tsx scripts/suivre-colis-power-delivery.ts --oui` une fois par nuit.
7. **Premier vrai colis avec Power au téléphone** : chaque `addparcelsnew` déclenche un ramassage.

---

## 7. Tests

- `npm test` — traduction des statuts, construction du colis (champs autorisés, token jamais cité),
  signature, fenêtre, lecture du webhook, correspondance des villes, matrice des permissions.
- `npx tsx scripts/simuler-power-delivery.ts` — **30 vérifications** de bout en bout contre un faux
  Power, sur la base `institut_db_power` seulement (il refuse toute autre base). Ce que les tests
  unitaires ne voient pas : deux remises simultanées → une seule chez eux, un rejeu qui ne double
  pas l'historique, la signature du compte de service, la réouverture d'un colis annulé.

---

## 8. Points ouverts

**À demander à Power Delivery :**

1. la réponse exacte de `addparcelsnew`, et si leur code de suivi diffère du nôtre ;
2. un environnement de test ;
3. comment **annuler** un colis — leur API n'a pas d'endpoint pour ça ;
4. le format exact de `X-Webhook-Signature` (hex ou `sha256=`) ;
5. une date de report, quelque part ;
6. les 5 villes absentes (les livrent-ils ? sous quel identifiant ?), lequel des deux `ouargui`,
   `ait aourir`/`Aït ourir` et `tamelelt`/`Tamallalt` sont-elles une ville ou deux ;
7. à quoi sert leur statut `DELIVERED` n° 13, doublon du n° 12.

**Chez nous :**

- le **point de ramassage** envoyé (`parcel_pickup_*`) : décision reportée — rien n'est envoyé ;
- une **purge** d'`evenements_prestataire`, qui contient téléphones et adresses (comme
  `JournalAppelApi`) ;
- la **réconciliation du COD** à partir de `dernierPaiementExterne` ;
- un écart **préexistant** sur la clé étrangère `plateformes_partenaires.prestataire_id`
  (`ON DELETE SET NULL` au schéma, pas en base), que Prisma voulait glisser dans la migration de ce
  lot et qui en a été retiré : à traiter dans sa propre migration ;
- l'export Excel du bon d'envoi transmet encore le **nom du marchand**.
