# API Mathio Delivery — intégration Shipeh

Documentation destinée aux **développeurs de Shipeh**. Elle décrit tout ce qu'il faut pour
envoyer à Mathio Delivery vos marchands, le stock que vous déposez dans notre entrepôt, et vos
colis.

Version 2.4 — octobre 2026

### Ce qui change depuis la version 2.3

| | |
|---|---|
| **Colis** (§8, §9) | Un colis n'est plus accepté « en attente de stock ». Il est **refusé**, et rien n'est créé, si l'un de ses produits n'a pas encore été **validé par notre entrepôt** (`409 produit_non_valide`) ou si le **stock disponible ne suffit pas** (`409 stock_insuffisant`). Rejouez-le après la réception de votre stock. `enAttenteStock` reste dans la réponse et vaut toujours `false` |

### Ce qui change depuis la version 2.2

| | |
|---|---|
| **Produits** (§5) | `photoUrl` devient **obligatoire** : un produit déclaré sans photo est refusé (`400 champ_requis`) |

### Ce qui change depuis la version 2.1

| | |
|---|---|
| **Stock commun** (§5) | `idExterneMarchand` devient **facultatif** dans `POST /v1/produits` : sans lui, le produit rejoint **votre stock commun**, partagé par tous vos marchands. Un SKU est désormais **unique dans tout votre univers** (stock commun et stocks de tous vos marchands) |
| **Envois de stock** (§6) | **Nouvel endpoint** `POST /v1/stock/envois` : annoncez chaque arrivage (réassort) d'un produit déjà déclaré, commun ou personnel |
| **Lecture du stock** (§7) | **Nouvel endpoint** `GET /v1/stock` : annoncé et disponible, SKU par SKU, et la consommation du stock commun par chacun de vos marchands |
| **Colis** (§8, §9) | Le stock est retiré **dès l'arrivée du colis**. S'il manque, le colis est accepté et la réponse porte **`enAttenteStock: true`** ; il est servi à la prochaine réception. Un SKU est cherché dans le stock du marchand, puis dans votre stock commun |
| **Clés** | `GET /v1/stock` demande le droit **`stock:lecture`** ; `POST /v1/stock/envois` utilise `produits:creation`. Nous vous émettons de nouvelles clés |

### Ce qui change depuis la version 1.0

| | |
|---|---|
| **Marchands** (§4) | `email` **et** un mot de passe sont désormais **obligatoires** : ce sont les identifiants du marchand chez vous, et ils deviennent les siens chez nous. Le mot de passe s'envoie **en clair (`motDePasse`) ou en empreinte bcrypt (`motDePasseHash`)** : vous pouvez synchroniser vos marchands déjà inscrits sans détenir leur mot de passe. Plus d'email d'invitation. `nomBoutique` devient facultatif. Le champ `invitationEnvoyee` de la réponse est remplacé par `motDePasseDefini` |
| **Produits de stock** (§5) | **Nouvel endpoint** `POST /v1/produits` : vous déclarez chaque produit, son SKU (ou ceux de ses variantes) et la quantité envoyée à notre entrepôt |
| **Suivi des statuts** (§10) | **Nouvel endpoint** `GET /v1/colis` : vos colis dont le statut a changé, chacun avec son **statut actuel** (nos codes : `livre`, `refuse`, `retourne`…), à interroger périodiquement |
| **Colis** (§8, §9) | Le champ **`produits`** (`[{ "sku", "quantite" }]`) est **obligatoire** : chaque colis contient un ou plusieurs produits de stock. Un SKU inconnu bloque le colis. Les champs `quantite` et `produitDescription` ne sont plus lus |
| **Villes** (§11) | `code` est un code court **`V001`…** (il remplace l'ancien identifiant) ; `tarifLivraison` vaut **30 dh** pour toutes les villes |
| **Clés** | Ces nouveautés demandent les droits `produits:creation`, `colis:lecture` et `villes:lecture` : nous vous émettons de **nouvelles clés** |

---

## Table des matières

1. [Ce que l'intégration fait](#1-ce-que-lintégration-fait)
2. [Démarrer](#2-démarrer)
3. [Authentification](#3-authentification)
4. [`POST /v1/marchands`](#4-post-v1marchands)
5. [`POST /v1/produits`](#5-post-v1produits)
6. [`POST /v1/stock/envois`](#6-post-v1stockenvois)
7. [`GET /v1/stock`](#7-get-v1stock)
8. [`POST /v1/colis`](#8-post-v1colis)
9. [`POST /v1/colis/lot`](#9-post-v1colislot)
10. [`GET /v1/colis` — suivre les statuts](#10-get-v1colis--suivre-les-statuts)
11. [`GET /v1/villes`](#11-get-v1villes)
12. [Idempotence — à lire avant d'écrire du code](#12-idempotence--à-lire-avant-décrire-du-code)
13. [Environnement de test](#13-environnement-de-test)
14. [Passer en production](#14-passer-en-production)
15. [Référence des erreurs](#15-référence-des-erreurs)
16. [Quotas et rotation des clés](#16-quotas-et-rotation-des-clés)
17. [Nous signaler un problème](#17-nous-signaler-un-problème)

---

## 1. Ce que l'intégration fait

Trois automatisations, et rien d'autre.

| | |
|---|---|
| **Synchronisation des comptes** | Un marchand s'inscrit chez vous → son compte est créé chez nous. Il s'y connecte avec **le même email et le même mot de passe que chez vous**, puis suit ses colis depuis son espace Mathio |
| **Déclaration du stock** | Vous envoyez des produits à notre entrepôt → vous nous déclarez chaque produit et son SKU, puis chaque envoi. Le stock est soit **commun** (à vous, vendu par tous vos marchands), soit **personnel** (à un marchand). Le marchand voit son stock dans son espace |
| **Ingestion des colis** | Un colis est créé chez vous → il entre dans notre chaîne logistique, à l'unité ou par lot. Il contient un ou plusieurs produits de ce stock, désignés par leur SKU, que nous préparons dans notre entrepôt |

Vous lisez trois choses : **les changements de statut de vos colis** (§10), pour savoir quand un
colis est livré ou retourné, **votre stock** (§7), et la liste de nos villes (§11). Le marchand suit aussi ses colis et
son stock depuis son espace Mathio.

> L'envoi automatique des statuts vers vos serveurs (webhook) n'est pas encore disponible : il
> viendra en complément de §10, qui restera la source sûre (un webhook perdu passe inaperçu,
> une interrogation périodique rattrape tout).

---

## 2. Démarrer

### Adresse

```
https://api.<domaine-mathio>/api/v1
```

Nous vous communiquons l'adresse exacte en même temps que vos clés.

### Ce dont vous avez besoin

Deux clés d'API, que nous vous transmettons :

| Clé | Usage |
|---|---|
| `mtk_test_…` | Votre bac à sable. Rien de ce que vous y faites n'atteint la production |
| `mtk_live_…` | La production |

Intégrez d'abord avec la clé `test`. Passez en `live` quand vos scénarios passent — la bascule ne
demande qu'un changement de variable d'environnement chez vous : mêmes adresses, mêmes formats,
mêmes réponses.

### Premier appel

```bash
curl -X POST https://api.<domaine-mathio>/api/v1/marchands \
  -H "Authorization: Bearer mtk_test_…" \
  -H "Content-Type: application/json" \
  -d '{
    "idExterne": "SHIPEH-1",
    "nomComplet": "Ahmed Benali",
    "telephone": "0612345678",
    "email": "ahmed@exemple.test",
    "motDePasse": "le-mot-de-passe-du-marchand"
  }'
```

---

## 3. Authentification

Chaque requête porte votre clé dans l'en-tête `Authorization` :

```
Authorization: Bearer mtk_live_a7f3c19e_9kQ2xR4pLm8vNc0dW1sZ6tYbH3jF5gA7uE2iO4rT8yK
Content-Type: application/json
```

### La clé est un secret

Nous n'en conservons que l'empreinte : **nous sommes incapables de vous la redonner**. Perdue,
elle se remplace, elle ne se retrouve pas. Stockez-la comme un mot de passe de production —
variable d'environnement ou coffre à secrets, jamais dans votre dépôt de code.

Le préfixe `mtk_` est reconnu par les scanners de secrets (GitHub, gitleaks) : si une clé fuite
dans un dépôt, elle sera signalée. Prévenez-nous immédiatement, nous la révoquons.

### Refus d'authentification

| Code HTTP | `code` | Que faire |
|---|---|---|
| `401` | `cle_absente` | L'en-tête `Authorization` manque |
| `401` | `cle_invalide` | Clé mal formée, inconnue, ou secret incorrect. Vérifiez la copie — une clé tronquée est la cause la plus fréquente |
| `401` | `cle_revoquee` | Nous avons révoqué cette clé. Contactez-nous |
| `401` | `cle_expiree` | Une rotation était en cours et vous n'avez pas déployé la nouvelle clé à temps |
| `403` | `scope_manquant` | Cette clé n'a pas le droit d'appeler cet endpoint. Le message liste ce qui manque |
| `403` | `plateforme_desactivee` | Votre intégration est suspendue. Contactez-nous |

`cle_invalide` couvre volontairement plusieurs cas sans les distinguer, pour des raisons de
sécurité. Si vous le rencontrez, vérifiez d'abord que la clé est complète et sans espace.

---

## 4. `POST /v1/marchands`

Crée chez nous le compte d'un de vos marchands, ou le rattache s'il existe déjà.

### Champs

**Requis** — trois, plus les identifiants de connexion ci-dessous :

| Champ | Format |
|---|---|
| `idExterne` | Votre identifiant du marchand. **C'est la clé de la synchronisation** : c'est par lui que vous nous parlerez de ce marchand ensuite |
| `nomComplet` | Nom de la personne |
| `telephone` | Numéro marocain (`0` puis `5`, `6` ou `7`, puis 8 chiffres ; `+212…`, `00212…`, `212…` et les espaces acceptés, stocké `06…`) **ou international** avec son indicatif (`+33612345678` ou `0033612345678`, stocké `+33612345678`). Sans indicatif, un numéro qui commence par `0` est lu comme marocain |

**Identifiants de connexion** — l'email, et le mot de passe sous **l'une** des deux formes. Ce sont
ceux du marchand chez vous ; ils deviennent les siens chez nous :

| Champ | Format |
|---|---|
| `email` | **Requis.** Son login. Normalisé en minuscules |
| `motDePasseHash` | **Recommandé.** L'empreinte bcrypt que vous stockez : 60 caractères, préfixe `$2a$`, `$2b$` ou `$2y$`, **coût de 10 à 14**. Nous la rangeons telle quelle : le marchand se connecte chez nous avec le même mot de passe que chez vous, sans que celui-ci ne transite jamais. C'est la forme à utiliser pour vos marchands déjà inscrits |
| `motDePasse` | Ou bien son mot de passe **en clair**. Pris tel quel, sans suppression d'espaces ; 72 octets au maximum. Nous le chiffrons dès réception (bcrypt) et ne le conservons ni ne le journalisons jamais en clair |

**Exactement un** des deux champs `motDePasseHash` et `motDePasse` : ni l'un ni l'autre, ou les
deux, sont refusés. Le coût est plafonné à 14 parce qu'une empreinte plus coûteuse rendrait
chaque connexion de ce marchand anormalement lente.

Le mot de passe n'est pris en compte **qu'à la création** du compte. Sur un rattachement
(`rattache`) ou un rejeu (`deja_synchronise`), il est ignoré : le marchand garde le mot de passe
qu'il a déjà chez nous. Un changement de mot de passe fait ensuite chez vous n'est pas répercuté.

**Optionnels** :

| Champ | Format |
|---|---|
| `nomBoutique` | Nom commercial. À défaut, la boutique porte le `nomComplet` |
| `ville`, `adresse` | Texte libre |
| `rib` | Exactement 24 chiffres |
| `cin` | Numéro de carte d'identité |
| `siteWeb`, `nomBanque`, `registreCommerce`, `villeRamassage`, `raisonSociale`, `iceRc` | Texte libre |
| `typeCompte` | `marchand` (défaut), `entreprise` ou `dropshipping` |

Nous demandons volontairement **moins** que notre propre formulaire d'inscription : vous ne
détenez pas la photo du RIB. Une fiche incomplète, complétable ensuite chez nous, vaut mieux
qu'une fiche inventée.

### Réponses

```json
{
  "issue": "cree",
  "idExterne": "SHIPEH-1",
  "marchandId": "6a1d1e40-8642-4859-98eb-b086bd6d68cf",
  "nomBoutique": "Atlas Store",
  "statut": "actif",
  "motDePasseDefini": true
}
```

Trois issues possibles :

| Code | `issue` | Signification |
|---|---|---|
| `201` | `cree` | Le compte a été créé avec l'email et le mot de passe transmis |
| `200` | `rattache` | Ce marchand **était déjà notre client**, inscrit directement chez nous. Nous avons créé le lien, sans modifier sa fiche |
| `200` | `deja_synchronise` | Cet `idExterne` nous est déjà connu. **Aucune écriture** |

`marchandId` est notre identifiant interne. Vous n'avez pas besoin de le stocker : c'est votre
`idExterne` qui fait référence dans tous nos échanges. Nous le renvoyons pour vos journaux.

`statut` vaut `actif` ou `en_attente_validation` selon les droits de votre clé. En bac à sable,
il vaut toujours `en_attente_validation` — voir §13.

`motDePasseDefini` à `true` signifie que le compte a été créé avec le mot de passe transmis : le
marchand peut se connecter tout de suite (une fois son compte actif). À `false` (`rattache`,
`deja_synchronise`), le marchand garde le mot de passe qu'il avait déjà chez nous : vos
identifiants n'ouvrent pas forcément son compte.

### Refus spécifiques

| Code | `code` | Cause et remède |
|---|---|---|
| `409` | `compte_non_marchand` | Ces coordonnées appartiennent chez nous à un livreur ou à un membre de notre personnel. Vérifiez le numéro |
| `409` | `conflit_identifiants` | Le téléphone et l'email désignent **deux comptes différents** chez nous. Nous refusons de choisir |
| `409` | `deja_lie` | Ce marchand est déjà rattaché à votre plateforme sous un autre `idExterne` |
| `409` | `synchronisation_concurrente` | Deux de vos appels se sont croisés. **Rejouez** : vous obtiendrez `deja_synchronise` |
| `409` | `marchand_de_test` | Vous utilisez une clé `live` sur des coordonnées créées en bac à sable. Voir §14 |
| `409` | `marchand_de_production` | Vous utilisez une clé `test` sur des coordonnées d'un marchand réel. Voir §13 |
| `400` | `champ_requis` | Le message nomme le champ manquant |
| `400` | `mot_de_passe_ambigu` | `motDePasse` et `motDePasseHash` envoyés ensemble : n'en garder qu'un |
| `400` | `telephone_invalide` · `email_invalide` · `mot_de_passe_invalide` · `mot_de_passe_hash_invalide` · `rib_invalide` · `type_compte_invalide` | Format incorrect |

---

## 5. `POST /v1/produits`

Déclare un produit de stock : le produit, son SKU et la quantité que vous envoyez à notre
entrepôt. Demande le droit `produits:creation` sur votre clé.

**Deux propriétaires possibles** :

| | Comment | Qui le vend |
|---|---|---|
| **Stock commun** | Sans `idExterneMarchand` | Tous vos marchands. Il vous appartient ; chaque unité sortie est attribuée au marchand dont le colis l'a consommée (§7) |
| **Stock personnel** | Avec `idExterneMarchand` | Ce marchand seulement |

**Déclarez un produit avant de l'utiliser dans un colis** : un colis qui cite un SKU que nous ne
connaissons pas est refusé (§8).

### Champs

Même format que l'ajout d'un produit depuis l'espace marchand, avec en plus le marchand concerné
quand le produit lui est personnel.

| Champ | Format |
|---|---|
| `idExterneMarchand` | **Facultatif.** L'`idExterne` d'un marchand déjà synchronisé : le produit est à lui seul. **Absent : le produit rejoint votre stock commun** |
| `nom` | **Requis.** Nom du produit |
| `reference` | **Votre SKU** du produit. **Requis pour un produit sans variantes** (c'est son unité de stock). **Facultatif pour un produit à variantes** : à défaut, nous lui attribuons une référence interne (`PRD-…`), renvoyée dans la réponse, dont vous n'avez pas à vous servir |
| `quantiteEnCours` | **Requis pour un produit sans variantes.** Quantité envoyée à notre entrepôt, entier positif ou nul |
| `note` | Texte libre |
| `photoUrl` | **Requis.** URL `https://…`, ou image embarquée `data:image/…;base64,…` de 2 Mo au plus |
| `variantesActivees` | Booléen, défaut `false`. À `true`, le stock est suivi **variante par variante** |
| `variantes` | Requis si `variantesActivees` vaut `true` : tableau de `{ "nom", "reference", "quantiteEnCours" }`, chaque variante avec **son propre SKU** |

```json
{
  "idExterneMarchand": "SHIPEH-1",
  "nom": "Robe d'été",
  "reference": "PRD-K7M2Q9XA",
  "note": "Tissu léger, lavage à 30°",
  "photoUrl": "https://cdn.exemple.ma/robe.jpg",
  "variantesActivees": true,
  "variantes": [
    { "nom": "Rouge / M", "reference": "PRD-K7M2Q9XA-ROUGE-M", "quantiteEnCours": 10 },
    { "nom": "Rouge / L", "reference": "PRD-K7M2Q9XA-ROUGE-L", "quantiteEnCours": 6 },
    { "nom": "Bleu / M",  "reference": "PRD-K7M2Q9XA-BLEU-M",  "quantiteEnCours": 8 }
  ]
}
```

Un produit sans variantes, personnel :

```json
{ "idExterneMarchand": "SHIPEH-1", "nom": "Mug blanc", "reference": "MUG-01", "quantiteEnCours": 20, "photoUrl": "https://cdn.exemple.ma/mug.jpg" }
```

Un produit du stock commun :

```json
{ "nom": "Gourde inox", "reference": "GOURDE-01", "quantiteEnCours": 100, "photoUrl": "https://cdn.exemple.ma/gourde.jpg" }
```

**Produit à variantes : ce sont les SKU des variantes qui comptent.** Chaque variante est une
unité de stock à part, et c'est son SKU que vos colis citent (§8). Le SKU du produit ne sert qu'à
regrouper ses variantes : envoyez-y votre identifiant de produit parent si vous en avez un. Un
préfixe commun (`ROBE-ETE`, `ROBE-ETE-ROUGE-M`) est lisible mais pas exigé : nous rattachons les
variantes à leur produit parce qu'elles arrivent dans le même appel, jamais en comparant les SKU.

**Un SKU désigne une seule chose dans tout votre univers** : votre stock commun et les stocks
personnels de tous vos marchands. Le SKU d'un produit et ceux de ses variantes ne peuvent servir à
rien d'autre, ni chez vous ni chez aucun de vos marchands. C'est ce qui permet à un colis de citer
un SKU sans dire d'où vient la marchandise. Les SKU sont comparés **sans tenir compte des
majuscules**.

### La quantité est annoncée, pas encore en stock

La quantité déclarée est celle que vous **envoyez**. Elle devient du stock disponible quand notre
entrepôt a **réceptionné et compté** la marchandise. D'ici là, le produit est
`pas_encore_recu`.

La quantité de la déclaration est le **premier** envoi. Les arrivages suivants du même produit
s'annoncent par `POST /v1/stock/envois` (§6) : redéclarer le produit ne change rien
(`deja_existant`).

### Réponses

```json
{
  "issue": "cree",
  "reference": "PRD-K7M2Q9XA",
  "produitId": "3f1c…",
  "statutReception": "pas_encore_recu",
  "stockCommun": false,
  "variantes": [
    { "reference": "PRD-K7M2Q9XA-BLEU-M", "varianteId": "…" },
    { "reference": "PRD-K7M2Q9XA-ROUGE-L", "varianteId": "…" },
    { "reference": "PRD-K7M2Q9XA-ROUGE-M", "varianteId": "…" }
  ]
}
```

| Code | `issue` | |
|---|---|---|
| `201` | `cree` | Le produit est créé : dans le stock du marchand, ou dans votre stock commun (`stockCommun: true`) |
| `200` | `deja_existant` | Ce produit est déjà déclaré chez ce propriétaire : reconnu à son SKU, ou, sans SKU de produit, parce que **toutes** ses variantes existent déjà sous un même produit. **Aucune écriture**, et **la quantité n'est pas ajoutée une seconde fois** |

### Refus spécifiques

| Code | `code` | |
|---|---|---|
| `404` | `marchand_inconnu` | Aucun marchand synchronisé sous cet identifiant, dans l'environnement de votre clé |
| `409` | `sku_deja_utilise` | Un des SKU désigne déjà un **autre** produit (ou une de ses variantes), dans votre stock commun ou chez un de vos marchands |
| `400` | `sku_duplique` | Le même SKU apparaît deux fois dans la requête (produit compris) |
| `400` | `champ_requis` · `quantite_invalide` · `photo_invalide` · `variantes_trop_nombreuses` | Le message nomme le champ (`photoUrl` absent : `champ_requis`) |
| `403` | `scope_manquant` | Votre clé n'a pas le droit `produits:creation` |

---

## 6. `POST /v1/stock/envois`

Annonce un arrivage de marchandise vers notre entrepôt : quels SKU, combien. Demande le droit
`produits:creation`.

Chaque SKU doit être **déjà déclaré** (§5), dans votre stock commun ou chez un de vos marchands :
un envoi ne crée jamais de produit. Un même envoi peut mêler les deux.

### Champs

| Champ | Format |
|---|---|
| `referenceEnvoi` | **Requis.** Votre référence de l'envoi (bon de livraison, numéro de transfert…). **C'est la clé d'idempotence** |
| `lignes` | **Requis.** Tableau de 1 à 500 lignes `{ "sku", "quantite" }`. SKU d'un produit sans variantes ou **d'une variante**. Quantité entière strictement positive. Un même SKU répété n'en fait qu'une ligne, quantités additionnées |

```json
{
  "referenceEnvoi": "ENV-2026-0042",
  "lignes": [
    { "sku": "GOURDE-01", "quantite": 200 },
    { "sku": "PRD-K7M2Q9XA-ROUGE-M", "quantite": 12 }
  ]
}
```

### Ce que fait l'envoi

Les quantités sont **annoncées** : elles comptent dans `annonce` (§7) et deviennent `disponible`
quand notre entrepôt a réceptionné et compté la marchandise. Ce qui arrive en moins reste
visible ligne par ligne (`quantiteRecue`).

**Tout ou rien** : un seul SKU inconnu, et rien n'est annoncé.

### Réponses

```json
{
  "issue": "cree",
  "referenceEnvoi": "ENV-2026-0042",
  "statut": "attendu",
  "lignes": [
    { "sku": "GOURDE-01", "quantiteAnnoncee": 200, "quantiteRecue": 0 },
    { "sku": "PRD-K7M2Q9XA-ROUGE-M", "quantiteAnnoncee": 12, "quantiteRecue": 0 }
  ]
}
```

| Code | `issue` | |
|---|---|---|
| `201` | `cree` | L'envoi est annoncé |
| `200` | `deja_recu` | Cette `referenceEnvoi` a déjà été reçue. **Rien n'est ajouté une seconde fois** ; la réponse montre l'envoi d'origine et ce que nous en avons reçu à ce jour |

`statut` : `attendu` (rien reçu), `recu_partiel`, `recu`.

### Refus spécifiques

| Code | `code` | |
|---|---|---|
| `400` | `sku_inconnu` | Un ou plusieurs SKU ne sont déclarés nulle part dans votre univers. Le message les nomme. Déclarez-les via §5 |
| `400` | `sku_a_variantes` | SKU d'un produit à variantes : annoncez chaque variante par son SKU |
| `400` | `lignes_invalides` | `lignes` n'est pas un tableau, est vide, ou dépasse 500 lignes |
| `400` | `champ_requis` · `quantite_invalide` | Le message nomme le champ (`referenceEnvoi`, `lignes[0].sku`…) |
| `403` | `scope_manquant` | Votre clé n'a pas le droit `produits:creation` |

---

## 7. `GET /v1/stock`

Votre stock, **une ligne par SKU** (un produit sans variantes, ou chaque variante). Demande le
droit `stock:lecture`.

### Deux lectures

| Requête | Ce qu'elle renvoie |
|---|---|
| `GET /v1/stock` | Tout votre univers : votre stock commun et le stock personnel de chacun de vos marchands |
| `GET /v1/stock?idExterneMarchand=SHIPEH-1` | Ce que vend ce marchand : ses produits personnels, et les produits communs qu'il a déjà vendus, avec **sa consommation** |

### Réponse

```json
{
  "stock": [
    { "sku": "MUG-01", "nom": "Mug blanc", "proprietaire": "SHIPEH-1", "annonce": 0, "disponible": 14 },
    { "sku": "GOURDE-01", "nom": "Gourde inox", "proprietaire": "plateforme", "annonce": 200, "disponible": 37, "consommeParMarchand": 63 }
  ]
}
```

| Champ | |
|---|---|
| `proprietaire` | `plateforme` pour votre stock commun, sinon l'`idExterne` du marchand propriétaire |
| `annonce` | En route : annoncé (§5, §6), pas encore réceptionné |
| `disponible` | Réceptionné, et pas encore retiré pour un colis : ce qui peut encore être vendu |
| `consommeParMarchand` | Seulement avec `?idExterneMarchand`, sur une ligne du stock commun : unités sorties pour les colis de ce marchand, moins celles revenues en stock. C'est la base pour lui refacturer sa part |

Le stock commun n'est **ni réparti ni réservé** entre vos marchands : le premier colis arrivé est
le premier servi.

### Refus spécifiques

| Code | `code` | |
|---|---|---|
| `404` | `marchand_inconnu` | `idExterneMarchand` inconnu dans l'environnement de votre clé |
| `403` | `scope_manquant` | Votre clé n'a pas le droit `stock:lecture` |

---

## 8. `POST /v1/colis`

Dépose un colis. **Chaque colis contient un ou plusieurs produits de stock**, désignés par leur
SKU (§5) : produits personnels du marchand, produits de votre stock commun, ou les deux. Un même produit peut figurer dans autant de colis que vous voulez.

### Champs

**Requis** :

| Champ | Format |
|---|---|
| `idExterneMarchand` | L'`idExterne` d'un marchand déjà synchronisé |
| `reference` | Votre référence du colis. **C'est la clé d'idempotence** — voir §12 |
| `clientNom` | Destinataire |
| `clientTelephone` | Téléphone du destinataire |
| `ville` | Texte libre. Nous la rapprochons de notre référentiel quand nous la reconnaissons ; une ville inconnue n'est jamais refusée |
| `adresse` | Adresse de livraison |
| `montantCod` | Montant à encaisser, en dirhams. Strictement positif, maximum `99999999.99`. Arrondi à deux décimales. Une chaîne (`"349.90"`) est acceptée |
| `produits` | Contenu du colis : tableau de 1 à 100 lignes `{ "sku", "quantite" }`. Le SKU est celui d'un produit sans variantes, ou **celui d'une variante**. La quantité est un entier positif. Un même SKU répété n'en fait qu'une ligne, quantités additionnées |

**Optionnels** :

| Champ | Format |
|---|---|
| `codePostal` | |
| `poidsKg` | Nombre positif, maximum `9999.99` |
| `notes` | Consigne de livraison |
| `fragile` | Booléen, défaut `false` |
| `ouvrir` | Booléen, défaut `false`. Le client est autorisé à ouvrir le colis avant de payer |

```json
{
  "idExterneMarchand": "SHIPEH-1",
  "reference": "SHP-2026-0001",
  "clientNom": "Karim Idrissi",
  "clientTelephone": "0655443322",
  "ville": "Rabat",
  "adresse": "18 avenue Mohammed V",
  "montantCod": 349.90,
  "produits": [
    { "sku": "PRD-K7M2Q9XA-ROUGE-M", "quantite": 2 },
    { "sku": "MUG-01", "quantite": 1 }
  ]
}
```

### Le SKU doit exister

Avant de créer le colis, nous cherchons **chaque SKU** dans le stock personnel **de ce marchand**,
puis dans **votre stock commun**. Le stock personnel d'un autre marchand n'est jamais utilisé. S'il
en manque un seul, **le colis est refusé et rien n'est créé** : la réponse nomme tous les SKU
inconnus, pour que vous corrigiez en un seul aller-retour. Déclarez le produit (§5), puis rejouez.

### Le produit doit être validé, et en stock

Un produit déclaré (§5) n'accepte de colis qu'une fois **validé par notre entrepôt**, c'est-à-dire
réceptionné et compté. Avant, tout colis qui le contient est refusé (`409 produit_non_valide`),
et le message nomme les SKU concernés.

Votre colis est confirmé : **nous retirons son stock immédiatement**, et chaque unité retirée du
stock commun est attribuée à ce marchand (§7).

Si une quantité manque (stock annoncé pas encore réceptionné, ou déjà consommé par d'autres
colis), **le colis est refusé et rien n'est créé** (`409 stock_insuffisant`). Consultez le stock
disponible (§7), puis rejouez le colis après le réassort : la même `reference` est acceptée.

### Réponses

```json
{
  "issue": "cree",
  "reference": "SHP-2026-0001",
  "codeSuivi": "PD-101066",
  "marchandId": "6a1d1e40-…",
  "statut": "nouveau_colis",
  "aRisque": false,
  "enAttenteStock": false
}
```

| Code | `issue` | |
|---|---|---|
| `201` | `cree` | Le colis est entré dans notre chaîne |
| `200` | `deja_ingere` | Cette référence a déjà été reçue. **Le `codeSuivi` renvoyé est celui du colis existant** |

**`codeSuivi` est notre numéro de suivi.** C'est celui que le marchand et le destinataire verront.
Nous vous conseillons de le stocker en face de votre `reference`.

`aRisque` à `true` signale que le destinataire figure sur notre liste de vigilance. Le colis est
accepté ; nous le traitons avec précaution.

### Refus spécifiques

| Code | `code` | |
|---|---|---|
| `404` | `marchand_inconnu` | Aucun marchand synchronisé sous cet identifiant, **dans l'environnement de votre clé**. Créez-le d'abord |
| `400` | `sku_inconnu` | Un ou plusieurs SKU n'existent ni dans le stock de ce marchand ni dans votre stock commun. Le message les nomme. Déclarez-les via §5 |
| `400` | `sku_a_variantes` | Ce SKU est celui d'un produit à variantes : indiquez le SKU d'une de ses variantes (le message les liste) |
| `409` | `produit_non_valide` | Un ou plusieurs produits ne sont pas encore validés par notre entrepôt. Le message les nomme. Rejouez après la réception de votre stock |
| `409` | `stock_insuffisant` | Le stock disponible ne couvre pas le colis. Le message nomme le produit et la quantité demandée. Rejouez après le réassort |
| `400` | `produits_invalides` | `produits` n'est pas un tableau, est vide, ou dépasse 100 lignes |
| `400` | `montant_invalide` · `quantite_invalide` · `poids_invalide` | Valeur hors bornes ou de mauvais type |
| `400` | `champ_requis` | Le message nomme le champ (`produits`, `produits[0].sku`…) |

---

## 9. `POST /v1/colis/lot`

Dépose plusieurs colis en un appel. Le corps est un **tableau**, de 1 à **200** colis, chacun au
format du §8.

### Le lot est partiellement acceptable

**La réponse est toujours `207`**, même quand tout passe. Un lot de 200 colis dont 3 sont mal
formés en crée **197** — nous ne rejetons jamais un lot entier pour quelques lignes.

**Le code HTTP ne dit rien du sort d'une ligne. Seul `lignes[].ok` le dit.**

```json
{
  "total": 4,
  "crees": 2,
  "dejaIngeres": 0,
  "refuses": 2,
  "lignes": [
    {
      "index": 0,
      "reference": "SHP-2026-1001",
      "ok": true,
      "resultat": {
        "issue": "cree",
        "reference": "SHP-2026-1001",
        "codeSuivi": "PD-101062",
        "statut": "nouveau_colis",
        "aRisque": false,
        "enAttenteStock": false
      }
    },
    {
      "index": 1,
      "reference": "SHP-2026-1002",
      "ok": false,
      "code": "champ_requis",
      "message": "Le champ « ville » est requis"
    }
  ]
}
```

Chaque ligne refusée porte son **`index`** dans le tableau que vous avez envoyé **et** sa
**`reference`** : les deux, pour que vous puissiez la rejouer sans ambiguïté.

### Refus portant sur le lot entier

| Code | `code` | |
|---|---|---|
| `400` | `lot_vide` | Le tableau est vide |
| `400` | `corps_invalide` | Le corps n'est pas un tableau |
| `413` | `lot_trop_grand` | Plus de 200 colis. Découpez |

---

## 10. `GET /v1/colis` — suivre les statuts

La liste de **vos colis dont le statut a changé**, chacun avec son **statut actuel**.
Interrogez-la périodiquement — toutes les 10 à 15 minutes convient — pour savoir quand un colis
est livré et payer vos vendeurs. Demande le droit `colis:lecture` sur votre clé.

Seuls les colis **que vous avez déposés** (§8, §9) y figurent, dans l'environnement de votre clé.

```
GET /api/v1/colis?modifiesDepuis=2026-10-10T08:00:00Z&limite=200
Authorization: Bearer mtk_live_…
```

| Paramètre | |
|---|---|
| `modifiesDepuis` | Date ISO 8601. Les colis dont le statut a changé **à partir de** cette date. Requis au premier appel |
| `curseur` | À la place de `modifiesDepuis` : le `curseurSuivant` de la réponse précédente. Reprend exactement après le dernier colis reçu |
| `limite` | Nombre de colis par page, de 1 à 500. Défaut : 200 |

### Réponse

```json
{
  "colis": [
    {
      "reference": "SHP-2026-0001",
      "codeSuivi": "PD-101066",
      "statut": "livre",
      "libelle": "Livré",
      "final": true,
      "statutDate": "2026-10-09T14:22:11.000Z",
      "montantEncaisse": 349.9,
      "montantCod": 349.9,
      "transporteur": null
    }
  ],
  "curseurSuivant": "MjAyNi0xMC0wOVQxNDoyMjoxMS4wMDBafDZhMWQ…",
  "fin": true
}
```

| Champ | |
|---|---|
| `reference` | Votre référence du colis |
| `codeSuivi` | Notre numéro de suivi |
| `statut` | Le statut **actuel** du colis : **notre code de statut**, tel que nous l'utilisons (liste ci-dessous) |
| `libelle` | Son libellé en français, pour l'affichage |
| `final` | `true` pour un statut final (livré, retourné, annulé) : le colis est clos |
| `statutDate` | Date à laquelle le colis a pris ce statut |
| `montantEncaisse` | Le montant encaissé auprès du destinataire : le COD du colis quand il est **livré**, `0` sinon |
| `montantCod` | Le montant à encaisser sur ce colis (le COD de votre dépôt) |
| `transporteur` | **Réservé** : contiendra le nom et le numéro du livreur. Toujours `null` pour l'instant ; le champ est déjà là pour que son arrivée ne change pas la forme de la réponse |
| `curseurSuivant` | À garder pour l'appel suivant. Toujours présent dès qu'une page a été lue |
| `fin` | `true` : vous avez tout lu pour l'instant. `false` : rappelez tout de suite avec `curseurSuivant` |

**Un colis apparaît une seule fois par lecture**, avec son statut du moment. S'il change de statut
plus tard, il **réapparaît** dans une lecture suivante avec son nouveau statut : mettez à jour
votre colis à chaque fois, en vous fiant à `statutDate`. Les étapes intermédiaires survenues entre
deux de vos lectures ne sont pas rendues : seul le statut actuel compte.

`montantEncaisse` est le montant que le destinataire a payé à la livraison. Ce n'est pas encore
une confirmation du reversement par le transporteur : le suivi des reversements fera l'objet
d'une version ultérieure.

### Les statuts

Ce sont **nos propres codes de statut**, tels que nous les utilisons. Nous vous transmettons les
**19 statuts ci-dessous**, et seulement eux : les autres étapes internes (enregistrement,
transits entre nos sites, remise au transporteur…) ne sont pas transmises, et votre colis garde
alors le dernier statut reçu. La liste est fermée : branchez votre code sur le **code**
(`livre`), jamais sur le libellé. Si nous devions un jour la modifier, nous vous prévenons
**avant** la mise en service.

Un même colis peut reprendre plusieurs fois le même statut (plusieurs tentatives, plusieurs
appels) : il réapparaît alors avec une nouvelle `statutDate`.

| `statut` | Libellé | Signification | Final |
|---|---|---|---|
| `pret_pour_preparation` | Prêt pour préparation | Colis pris en charge, en attente de préparation dans notre entrepôt |  |
| `mise_en_distribution` | Mise en distribution | Colis parti en livraison |  |
| `livre` | Livré | Remis au destinataire | **oui** |
| `boite_vocale` | Boîte vocale | Appel au destinataire tombé sur la messagerie |  |
| `deuxieme_appel_pas_reponse` | 2e appel sans réponse | Deuxième appel sans réponse |  |
| `troisieme_appel_pas_reponse` | 3e appel sans réponse | Troisième appel sans réponse |  |
| `pas_de_reponse_sms` | Pas de réponse + SMS | Pas de réponse, SMS de relance envoyé |  |
| `injoignable` | Injoignable | Destinataire injoignable |  |
| `numero_errone` | Numéro erroné | Numéro de téléphone du destinataire erroné |  |
| `relance_nouveau_client` | Relancé nouveau client | Destinataire relancé |  |
| `attente_de_relancer` | Attente de relancer | Relance du destinataire à faire |  |
| `programme` | Programmé | Livraison fixée à une date convenue avec le destinataire |  |
| `reporte` | Reporté | Livraison reportée à une nouvelle date |  |
| `hors_zone` | Hors-zone | Adresse hors de notre zone de livraison |  |
| `refuse` | Refusé | Le destinataire a refusé le colis ; il va revenir vers le vendeur |  |
| `retourne_au_hub` | Retourné au Hub | Le colis non livré est revenu dans notre entrepôt |  |
| `retourne` | Retourné | Colis rendu au vendeur | **oui** |
| `annule` | Annulé | Livraison annulée | **oui** |
| `annule_par_vendeur` | Annulé par le vendeur | Annulé par le vendeur | **oui** |

**Pour payer vos vendeurs, appuyez-vous sur `livre`.** `retourne`, `annule` et `annule_par_vendeur`
signifient qu'il n'y a rien à payer. `refuse` n'est pas final : le colis repart vers nous, puis
vers le vendeur (`retourne`).

**Un statut final peut, exceptionnellement, être corrigé.** Nos transporteurs et nos équipes ne
peuvent plus le modifier, mais un administrateur Mathio le peut, pour réparer une erreur de
saisie. Le colis réapparaît alors avec son statut corrigé. Appliquez donc toujours **le statut le
plus récent reçu** pour un colis, et ne tenez pas un `livre` pour acquis définitivement.

### Les garanties

- **Ordre** : les colis sortent par `statutDate`, puis par identifiant quand deux ont la même
  date. Un curseur ne saute jamais un colis.
- **Rien de perdu** : un colis qui change de statut après votre lecture ressort à la suivante,
  avec son nouveau statut.
- **Rejouable** : relire la même période rend les mêmes colis, sauf ceux qui ont changé depuis
  (ils ressortent alors plus loin). Vous pouvez interroger avec un recouvrement volontaire
  (repartir quelques minutes avant votre dernier passage) sans risque.
- **Délai de stabilisation** : un changement de statut est visible une dizaine de secondes après
  être survenu. C'est ce qui garantit qu'un curseur ne passe jamais devant un changement encore
  en cours d'enregistrement.
- **Quota** : le même que le reste de l'API (§16). Une page de 500 colis compte pour une requête.

### Refus spécifiques

| Code | `code` | |
|---|---|---|
| `400` | `champ_requis` | Ni `modifiesDepuis` ni `curseur` |
| `400` | `date_invalide` | `modifiesDepuis` n'est pas une date ISO 8601 |
| `400` | `curseur_invalide` | Curseur altéré : reprenez celui renvoyé par la page précédente |
| `400` | `limite_invalide` | `limite` hors de 1 à 500 |
| `403` | `scope_manquant` | Votre clé n'a pas le droit `colis:lecture` |

---

## 11. `GET /v1/villes`

Liste les villes que nous desservons — environ 500, partout au Maroc — avec pour chacune son
code et notre tarif de livraison.

Cet appel ne fait que lire. Il demande le droit `villes:lecture` sur votre clé. Si votre clé ne
l'a pas, l'appel renvoie `403 scope_manquant`. Les droits d'une clé ne se modifient pas : nous
vous émettons une nouvelle clé qui le porte.

```
GET /api/v1/villes
Authorization: Bearer mtk_live_…
```

### Réponse

```json
{
  "devise": "MAD",
  "nombre": 500,
  "villes": [
    { "nom": "Agadir", "code": "V003", "tarifLivraison": 30 },
    { "nom": "Casablanca", "code": "V130", "tarifLivraison": 30 },
    { "nom": "Fès", "code": "V177", "tarifLivraison": 30 }
  ]
}
```

| Champ | |
|---|---|
| `nom` | Le nom de la ville dans notre référentiel. **Utilisez-le tel quel dans le champ `ville` de `POST /v1/colis`** : la ville est alors reconnue à coup sûr |
| `code` | Le code de la ville chez nous : `V` suivi d'un numéro sur trois chiffres (`V001`…`V500`, puis `V1000` au-delà de 999). **Il ne change jamais** — ni quand nous corrigeons l'orthographe du nom, ni quand la ville change de transporteur — et n'est jamais réattribué à une autre ville. Utilisez-le pour rapprocher vos villes des nôtres |
| `tarifLivraison` | Tarif de livraison que nous appliquons à vos marchands, en dirhams. **Prix unique de 30 dh pour toutes les villes**, Casablanca comprise |

Les villes sont triées par ordre alphabétique. La liste change rarement : la mettre en cache quelques heures suffit.

### Refus spécifiques

| Code | `code` | |
|---|---|---|
| `403` | `scope_manquant` | Votre clé n'a pas le droit `villes:lecture` |

---

## 12. Idempotence — à lire avant d'écrire du code

C'est le point le plus important de cette documentation.

**Rejouer un appel ne crée jamais de doublon.** Vous pouvez donc réessayer sans risque après un
timeout, une coupure réseau, ou une redélivrance de votre file de messages.

| Endpoint | Clé d'idempotence | Rejeu |
|---|---|---|
| `/v1/marchands` | `idExterne` | `200` + `issue: "deja_synchronise"` |
| `/v1/produits` | SKU du produit (à défaut, SKU de ses variantes) + propriétaire | `200` + `issue: "deja_existant"`, **sans ajouter la quantité** |
| `/v1/stock/envois` | `referenceEnvoi` | `200` + `issue: "deja_recu"`, **sans ajouter les quantités** |
| `/v1/colis` | `reference` | `200` + `issue: "deja_ingere"` + **le code de suivi d'origine** |

Deux conséquences pour votre code :

**Un rejeu répond en succès, pas en erreur.** Ne traitez pas `200 deja_ingere` comme un échec :
c'est la confirmation que le colis est bien chez nous, avec le numéro de suivi qui va avec.

**Ne réutilisez jamais une `reference` pour un colis différent.** Nous vous renverrions le colis
d'origine, et le nouveau ne serait jamais créé. Une référence, un colis, définitivement.

La garantie tient même si deux de vos serveurs appellent en même temps.

---

## 13. Environnement de test

Votre clé `mtk_test_…` travaille dans un espace séparé. Vous pouvez y envoyer n'importe quoi.

### Ce qui change

| | En bac à sable |
|---|---|
| Marchands créés | Restent **en attente de validation** — jamais actifs |
| Suivi (§10) | Une clé `test` ne lit que les colis déposés en bac à sable |
| Visibilité | Une clé `test` ne voit **que** les marchands qu'elle a créés |
| Produits déclarés | Rangés chez ces marchands de test, ou dans un stock commun de test distinct de celui de production. Supprimés à la purge du bac à sable, avec les envois |
| Le reste | Identique : mêmes adresses, mêmes formats, mêmes validations, mêmes erreurs |

### Deux règles à respecter

**1. Utilisez des coordonnées fictives.** Téléphones non attribués, adresses email d'un domaine
que vous contrôlez ou en `.test`.

Si vous synchronisez en bac à sable un marchand dont les coordonnées correspondent à un vrai
client déjà chez nous, vous recevrez :

```json
{ "code": "marchand_de_production",
  "message": "Ces coordonnées appartiennent à un marchand réel. Une clé de test ne peut pas s'y rattacher : utiliser des coordonnées fictives en bac à sable." }
```

Ce refus vous protège : sans lui, vos colis d'essai atterriraient dans le tableau de bord d'un
vrai marchand, et nous ne pourrions plus les en retirer.

**2. Une clé `test` ne peut pas déposer un colis chez un marchand de production.** Vous
recevriez `404 marchand_inconnu`, exactement comme pour un identifiant qui n'existe pas.

---

## 14. Passer en production

Dans cet ordre :

1. **Prévenez-nous.** Nous purgeons les données de votre bac à sable de notre côté.
2. Nous vous transmettons votre clé `mtk_live_…`.
3. Vous changez la clé dans votre configuration. **Rien d'autre ne change** — ni adresse, ni
   format, ni code.
4. Avec la clé `live`, vous resynchronisez vos marchands (§4), **puis redéclarez vos produits de
   stock**, communs et personnels (§5), avant d'envoyer les premiers colis : les produits du bac à
   sable ne passent pas en production.

### Un point à connaître

Vos identifiants `idExterne` sont indépendants entre les deux environnements : le même
`SHIPEH-1` peut exister en test et en production, ce sont deux marchands distincts.

En revanche, **un téléphone et un email ne peuvent désigner qu'une personne** chez nous. Si un
marchand de votre bac à sable a emprunté de vraies coordonnées, la synchronisation en production
vous répondra :

```json
{ "code": "marchand_de_test",
  "message": "Ces coordonnées appartiennent à un marchand créé dans le bac à sable. Purger l'environnement de test avant d'activer ce compte en production." }
```

Signalez-le nous : nous purgeons, vous rejouez. C'est exactement pour l'éviter que la règle des
coordonnées fictives existe.

---

## 15. Référence des erreurs

Toutes les erreurs ont la même forme :

```json
{ "code": "champ_requis", "message": "Le champ « nomComplet » est requis" }
```

**Branchez votre code sur `code`, jamais sur `message`.** Le code est stable ; le message est
écrit pour un humain qui lit un journal et peut être reformulé.

| HTTP | `code` | Signification |
|---|---|---|
| `400` | `json_invalide` | Le corps n'est pas du JSON |
| `400` | `corps_invalide` | Objet attendu (ou tableau, sur `/lot`) |
| `400` | `champ_requis` | Un champ obligatoire manque — le message le nomme |
| `400` | `telephone_invalide` | Ni marocain, ni international avec indicatif (`+…`) |
| `400` | `email_invalide` | |
| `400` | `mot_de_passe_invalide` | Chaîne de caractères, 72 octets au maximum |
| `400` | `mot_de_passe_hash_invalide` | Empreinte bcrypt de 60 caractères, `$2a$`/`$2b$`/`$2y$`, coût 10 à 14 |
| `400` | `mot_de_passe_ambigu` | `motDePasse` et `motDePasseHash` ensemble |
| `400` | `date_invalide` · `curseur_invalide` · `limite_invalide` | Paramètres de `GET /v1/colis` (§10) |
| `400` | `rib_invalide` | 24 chiffres exactement |
| `400` | `type_compte_invalide` | Valeurs : `marchand`, `entreprise`, `dropshipping` |
| `400` | `montant_invalide` | Doit être `> 0` et `≤ 99999999.99` |
| `400` | `quantite_invalide` | Entier positif (positif ou nul pour une quantité de stock) |
| `400` | `produits_invalides` | Le contenu d'un colis : tableau de 1 à 100 lignes |
| `400` | `sku_inconnu` | SKU absent du stock du marchand et de votre stock commun (colis), ou de tout votre univers (envoi) — le message les nomme |
| `400` | `lignes_invalides` | Les lignes d'un envoi : tableau de 1 à 500 lignes |
| `400` | `sku_a_variantes` | SKU d'un produit à variantes : indiquer celui d'une variante |
| `409` | `produit_non_valide` | Colis : produit pas encore validé par notre entrepôt (§8) |
| `409` | `stock_insuffisant` | Colis : stock disponible insuffisant (§8) |
| `400` | `sku_duplique` | Même SKU deux fois dans une déclaration de produit |
| `400` | `photo_invalide` | URL https ou image `data:image/…;base64` de 2 Mo au plus |
| `400` | `variantes_trop_nombreuses` | 200 variantes au plus par produit |
| `400` | `poids_invalide` | Nombre positif, `≤ 9999.99` |
| `400` | `lot_vide` | |
| `400` | `requete_invalide` | Requête mal formée, cas non couvert ci-dessus |
| `401` | `cle_absente` · `cle_invalide` · `cle_revoquee` · `cle_expiree` | Voir §3 |
| `403` | `scope_manquant` | Votre clé n'a pas le droit d'appeler cet endpoint |
| `403` | `plateforme_desactivee` | Intégration suspendue |
| `404` | `marchand_inconnu` | Pas de marchand sous cet identifiant, dans cet environnement |
| `409` | `compte_non_marchand` | Coordonnées d'un compte qui n'est pas un marchand |
| `409` | `conflit_identifiants` | Téléphone et email désignent deux comptes |
| `409` | `deja_lie` | Marchand déjà rattaché sous un autre `idExterne` |
| `409` | `synchronisation_concurrente` | Appels croisés — **rejouez** |
| `409` | `marchand_de_test` | Clé `live` sur des coordonnées de bac à sable |
| `409` | `marchand_de_production` | Clé `test` sur des coordonnées réelles |
| `409` | `sku_deja_utilise` | SKU déjà porté par un autre produit, dans votre stock commun ou chez un de vos marchands |
| `413` | `lot_trop_grand` | Plus de 200 colis |
| `429` | `quota_depasse` | Voir §16 |
| `500` | `erreur_interne` | Chez nous. Réessayez, et signalez-le si ça persiste |

### Ce qu'il faut rejouer, ce qu'il ne faut pas

| Rejouable tel quel | À corriger avant de rejouer |
|---|---|
| `429`, `500`, `synchronisation_concurrente` | Tous les `400` |
| `deja_synchronise`, `deja_existant`, `deja_recu`, `deja_ingere` (déjà des succès) | `400 sku_inconnu` — déclarez le produit d'abord (§5) |
| | `404 marchand_inconnu` — créez le marchand d'abord (§4) |

Sur `429`, le message indique le délai d'attente. Une temporisation exponentielle est la bonne
réponse.

---

## 16. Quotas et rotation des clés

### Quotas

**600 requêtes par minute et par clé**, par défaut. Nous pouvons l'ajuster à votre volume — un
`429` récurrent est une conversation à avoir, pas une fatalité.

Un plafond par adresse IP existe également, à un niveau largement supérieur : il ne concerne pas
un trafic légitime.

Un lot de 200 colis compte pour **une** requête. C'est la façon la plus efficace d'envoyer du
volume.

### Rotation

Nous renouvelons périodiquement les clés, sans interruption de service :

1. Nous vous transmettons la clé **B**. La clé **A** continue de fonctionner.
2. Vous déployez la B à votre rythme.
3. Nous programmons l'expiration de la A.

Pendant les **7 jours** qui précèdent l'expiration, chaque réponse en succès à un appel utilisant
la clé A porte l'en-tête :

```
Mathio-Key-Deprecation: 2026-09-14T10:00:00.000Z
```

**Surveillez cet en-tête dans vos journaux.** C'est l'avertissement qui vous laisse le temps
d'agir avant que la clé ne cesse de répondre.

En cas de fuite avérée, nous révoquons immédiatement, sans délai de grâce. Prévenez-nous au plus
vite : une révocation coûte moins cher qu'une clé dans la nature.

---

## 17. Nous signaler un problème

Nous conservons un journal de tous les appels reçus : horodatage, endpoint, code de réponse,
durée, et la référence concernée. Pour que nous retrouvions un appel, envoyez-nous :

- l'**horodatage approximatif** (à la minute près suffit) ;
- l'**`idExterne`** ou la **`reference`** concernée ;
- le **code de réponse** que vous avez reçu.

Inutile de nous envoyer le corps de vos requêtes : nous ne le conservons pas — il contiendrait
des données de vos clients finaux — mais nous avons le message d'erreur exact que nous vous avons
renvoyé. **Ne nous envoyez jamais un mot de passe de marchand** par email ou messagerie.

---

## Aide-mémoire

```
POST /api/v1/marchands     synchroniser un marchand
POST /api/v1/produits      déclarer un produit (photoUrl obligatoire) : sans idExterneMarchand = stock commun
POST /api/v1/stock/envois  annoncer un arrivage : referenceEnvoi, lignes [{ sku, quantite }]
GET  /api/v1/stock         votre stock ; ?idExterneMarchand=… : celui d'un marchand + sa consommation
POST /api/v1/colis         déposer un colis : produits [{ sku, quantite }] obligatoire
POST /api/v1/colis/lot     déposer jusqu'à 200 colis
GET  /api/v1/colis         suivre les statuts : ?modifiesDepuis=… puis ?curseur=…
GET  /api/v1/villes        nos villes : nom, code, tarif de livraison

Authorization: Bearer mtk_<env>_<prefixe>_<secret>
Content-Type: application/json

Idempotence   marchands → idExterne     produits → SKU      envois → referenceEnvoi   colis → reference
Rejeu         200 deja_synchronise      200 deja_existant   200 deja_recu             200 deja_ingere + même codeSuivi
SKU inconnu   colis refusé (400 sku_inconnu), rien n'est créé
Lot           toujours 207, lire lignes[].ok
Suivi         un colis par ligne, statut actuel ; fin=false → rappeler avec curseurSuivant
Erreurs       { "code": "...", "message": "..." } — brancher sur code
```
