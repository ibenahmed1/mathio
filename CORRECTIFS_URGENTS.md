# Correctifs urgents

Défauts constatés, reconnus, et volontairement **reportés**. Chacun est reproductible et localisé :
ce fichier existe pour qu'aucun ne soit redécouvert par accident dans six mois.

Ordre = gravité décroissante. Une entrée ne se supprime pas quand on la corrige : on la barre et on
cite le commit.

---

## 1. Le statut `recu` est un cul-de-sac

**Constaté le 9 septembre 2026**, sur le colis `PD-101685`, en tentant de l'ajouter à un bon d'envoi.

### Le symptôme

Un colis passé par « Bien reçu » depuis un bon de livraison n'apparaît **dans aucun bon d'envoi**, et
aucun geste de l'application ne peut l'en sortir. Il est figé, sans message d'erreur nulle part —
l'écran de création du BE ne le liste simplement pas.

### La mécanique

`POST /api/bons-livraison/[id]/bien-recu` écrit `statut: 'recu'`
([route.ts:31](app/api/bons-livraison/%5Bid%5D/bien-recu/route.ts#L31)).

Or `recu` n'est accepté par aucune des deux portes de sortie :

| Porte | Ce qu'elle accepte | `recu` ? |
|---|---|---|
| `getColisEligiblesEnvoi` ([lib/hub-envoi.ts:16](lib/hub-envoi.ts#L16)) | `recu_au_hub`, ou `ramasse` + `enStock` | non |
| `POST /api/commandes/scan-reception` ([route.ts:83](app/api/commandes/scan-reception/route.ts#L83)) | `ramasse`, `en_transit` | non — 409 |

### Pourquoi c'est probablement accidentel

Le pipeline **stock** a exactement la même action « bien reçu », et elle écrit `ramasse`
([bons-preparation/[id]/bien-recu/route.ts:34](app/api/bons-preparation/%5Bid%5D/bien-recu/route.ts#L34))
— un statut qui reste éligible au bon d'envoi. Les deux pipelines divergent donc sur un geste
identique, et rien dans `prisma/schema.prisma` ne justifie l'écart.

### Contournement actuel

Un **admin** peut forcer `recu` → `recu_au_hub` via `PATCH /api/commandes/[id]/statut` : aucun des
garde-fous de cette route ne couvre cette transition, et l'admin les outrepasse de toute façon.
C'est un contournement, pas une correction — il suppose que quelqu'un sache que le colis est bloqué.

### Piste de correction

Deux options, à trancher **avant** de coder — c'est la machine à états des colis :

1. aligner le « bien reçu » du BL sur celui du bon de préparation (`recu` → `ramasse`) ;
2. ou ouvrir `recu` en entrée de `scan-reception`, au même titre que `ramasse` et `en_transit`.

La seconde préserve la sémantique de `recu` (« le marchand nous l'a remis ») ; la première supprime
la divergence entre les deux pipelines. Question ouverte : à quoi sert `recu` s'il ne mène nulle part ?

---

## 2. La comptabilité contrôle le rôle en dur, au lieu de la permission

**Constaté le 9 septembre 2026**, sur un compte `superviseur` porteur de `comptabilite:read`.

### Le symptôme

L'entrée « Comptabilité » s'affiche dans la barre latérale, le proxy laisse passer la requête, et la
page **redirige silencieusement vers `/admin`** — l'utilisateur croit avoir cliqué à côté et retombe
sur l'accueil.

### La mécanique

Quatre endroits testent une liste de rôles codée en dur là où le catalogue de permissions fait déjà
autorité :

| Fichier | Contrôle |
|---|---|
| [app/admin/comptabilite/page.jsx:13](app/admin/comptabilite/page.jsx#L13) | `ROLES_COMPTABILITE = ["admin", "responsable"]` puis `redirect("/admin")` |
| [app/api/finance/route.ts:12](app/api/finance/route.ts#L12) | `requireUser(['admin','responsable'])` |
| [app/api/finance/[id]/annuler/route.ts:6](app/api/finance/%5Bid%5D/annuler/route.ts#L6) | idem |
| [app/api/commandes-stock-hub/route.ts:9](app/api/commandes-stock-hub/route.ts#L9) | idem |

Alors que [lib/permission-routes.ts](lib/permission-routes.ts#L103) mappe déjà ces chemins sur
`comptabilite:read` / `comptabilite:write`. Le module comptabilité est le seul du back-office à
doubler la matrice de permissions par un test de rôle — ce que les permissions granulaires étaient
censées remplacer.

### Piste de correction

`permissionAutorise(session, …, 'comptabilite:read')` côté page, et `requirePermission(...)` côté
API. **Décision métier requise d'abord** : le superviseur doit-il accéder à la comptabilité ? Si non,
la correction est de décocher la permission sur le compte, et de supprimer l'entrée de nav — pas de
toucher au code.

---

## ~~3. Cinq agences sur dix-sept ne desservent pas leur propre ville~~ — CORRIGÉ

**Constaté le 9 septembre 2026**, en cherchant où poser des colis de test pour l'API prestataires.
**Corrigé le même jour** par `scripts/ajouter-villes-agences.ts`, ajouté en fin de
`npm run db:reseau`. Décision et réserves consignées dans
[SOUS_TRAITANCE.md §2.10](SOUS_TRAITANCE.md).

Cinq agences desservaient tout un secteur sans pouvoir recevoir un colis pour la ville où elles
sont assises — Agence Oujda couvrait 63 villes de l'Oriental, mais pas Oujda :

| Agence | Villes desservies | Sa ville d'implantation |
|---|---|---|
| Agence Oujda | 63 | `Oujda` — **ajoutée** |
| Agence Taounate | 35 | `Taounate` — **ajoutée** |
| Agence El Jadida | 11 | `El Jadida` — **ajoutée** |
| Agence Fès | 2 | `Fès` — **ajoutée** |
| Agence Boulmane | 2 | `Boulmane` — **ajoutée** |

Un colis pour l'une de ces villes ne se rattachait à aucun hub et n'apparaissait dans aucun bon
d'envoi, sans que rien à l'écran ne dise pourquoi. Les cinq résolvent désormais vers leur agence.

### Ce qui reste ouvert

**Le prix.** Aucun tarif n'a été chargé : le coût de ces cinq villes est `null`, donc « inconnu » et
signalé comme tel à la facturation — jamais `0`. Tant que les transporteurs n'ont pas donné leur
prix, chaque colis qui y part fausse la marge (question 3 de `SOUS_TRAITANCE.md §3`).

**L'accord.** Nous déclarons livrer ces villes sans que les transporteurs l'aient confirmé. C'était
l'argument qui justifiait de ne pas les créer ; il n'est pas levé, il est assumé.

**Le silence de l'écran**, lui, n'est pas corrigé et reste valable au-delà de ces cinq villes :
l'écran de création d'un bon d'envoi devrait **dire** qu'un colis est exclu faute de ville au
référentiel, plutôt que de l'omettre sans un mot. C'est le même silence que le point 1 — un colis
absent d'une liste ne dit jamais pourquoi il en est absent.

---

## 4. Trois hubs internes sont invisibles au routage, leurs villes partent en sous-traitance

**Constaté le 9 septembre 2026**, au même audit que le point 3. Celui-ci coûte potentiellement de
l'argent à chaque colis.

### Le constat

Trois hubs **internes** (sans `prestataireId`, donc livrés par nos propres livreurs) ne déclarent
**aucune ville** dans la table `Ville` :

| Hub interne | Villes desservies | Où part sa propre ville |
|---|---|---|
| Hub Marrakech | 0 | → **Agence Marrakech** (Power Delivery) |
| Hub Tanger | 0 | → **Agence Tanger** (Amir Livraison) |
| Hub Audit Tournée (autre) | 0 | → **Agence Tanger** (Amir Livraison) |

### Pourquoi la règle d'arbitrage ne les protège pas

`meilleurHub` ([lib/hub-envoi.ts](lib/hub-envoi.ts)) fait pourtant primer un hub interne sur une
agence sous-traitée — « ce que nous savons livrer nous-mêmes n'a pas à partir chez un tiers ».

Mais cet arbitrage ne s'applique qu'entre **candidats de l'index**, et l'index est construit
uniquement à partir de la table `Ville`. Un hub à zéro ville n'est jamais candidat : la règle ne le
départage pas, elle ne le voit pas. `Hub.ville = "Marrakech"` est une étiquette d'affichage, sans
effet sur le routage.

Conséquence : **tout colis pour Marrakech ou Tanger part chez un sous-traitant**, alors qu'un hub
interne y est déclaré. Si ces hubs sont réels, on paie une agence pour livrer là où on livre déjà.

### Ce qu'il faut trancher d'abord

Deux lectures, et elles appellent des gestes opposés :

1. **Ces hubs sont réels** → il manque leurs villes. Les créer bascule Marrakech et Tanger en
   interne, avec effet immédiat sur le routage, le coût et la marge. À faire sciemment, pas en
   passant.
2. **Ce sont des reliquats de test** — l'un s'appelle « Hub Audit Tournée (autre) », ce qui n'est
   pas rassurant sur les deux autres → les supprimer, et le routage actuel est déjà correct.

Personne ne peut trancher depuis le code : la question est de savoir si nous avons du personnel à
Marrakech et à Tanger.

### Filet à poser dans tous les cas

`/admin/hubs` devrait signaler un hub interne à zéro ville. `villesPartagees()` expose déjà les
arbitrages que le routage fait en silence ; un hub que le routage **ignore complètement** mérite au
moins autant d'être visible.

---

## 5. Documentation destinée aux prestataires — à écrire

**Noté le 9 septembre 2026.** Sans elle, aucun prestataire ne peut s'intégrer. Page au style landing
page sur un lien difficile à deviner, clés transmises en privé. Détail : `API_SUIVI_PRESTATAIRES.md` §13.

---

## 6. Trois prestataires sur cinq ne peuvent rien remonter

**Noté le 9 septembre 2026.** Power Delivery, Sahario et Amir n'ont pas d'informatique : il leur faut
un import Excel de retour, sur la même logique que l'API (`lib/livraison-statut.ts`).

---

## 7. COD sous-traité ni déclaré, ni réconcilié

**Noté le 9 septembre 2026.** Bloqué sur la question 9 de `SOUS_TRAITANCE.md` : le transporteur
encaisse-t-il, et sous quel délai reverse-t-il ?

---

## 8. Deux implémentations pour écrire un statut de colis

**Noté le 9 septembre 2026.** `app/api/livreur/colis/[id]/statut/route.ts` (logique dans le handler)
et `lib/livraison-statut.ts` divergent. Les faire converger sur une seule fonction de `lib/`.
