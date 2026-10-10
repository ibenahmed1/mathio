# API Mathio Delivery — intégration Shipeh

Documentation destinée aux **développeurs de Shipeh**. Elle décrit tout ce qu'il faut pour
envoyer à Mathio Delivery vos marchands, le stock que vous déposez dans notre entrepôt, et vos
colis.

Version 2.0 — octobre 2026

### Ce qui change depuis la version 1.0

| | |
|---|---|
| **Marchands** (§4) | `email` **et** `motDePasse` sont désormais **obligatoires** : ce sont les identifiants du marchand chez vous, et ils deviennent les siens chez nous. Plus d'email d'invitation. `nomBoutique` devient facultatif. Le champ `invitationEnvoyee` de la réponse est remplacé par `motDePasseDefini` |
| **Produits de stock** (§5) | **Nouvel endpoint** `POST /v1/produits` : vous déclarez chaque produit, son SKU (ou ceux de ses variantes) et la quantité envoyée à notre entrepôt |
| **Colis** (§6, §7) | Le champ **`produits`** (`[{ "sku", "quantite" }]`) est **obligatoire** : chaque colis contient un ou plusieurs produits de stock. Un SKU inconnu bloque le colis. Les champs `quantite` et `produitDescription` ne sont plus lus |
| **Villes** (§8) | `code` est un code court **`V001`…** (il remplace l'ancien identifiant) ; `tarifLivraison` vaut **30 dh** pour toutes les villes |
| **Clés** | Ces nouveautés demandent les droits `produits:creation` et `villes:lecture` : nous vous émettons de **nouvelles clés** |

---

## Table des matières

1. [Ce que l'intégration fait](#1-ce-que-lintégration-fait)
2. [Démarrer](#2-démarrer)
3. [Authentification](#3-authentification)
4. [`POST /v1/marchands`](#4-post-v1marchands)
5. [`POST /v1/produits`](#5-post-v1produits)
6. [`POST /v1/colis`](#6-post-v1colis)
7. [`POST /v1/colis/lot`](#7-post-v1colislot)
8. [`GET /v1/villes`](#8-get-v1villes)
9. [Idempotence — à lire avant d'écrire du code](#9-idempotence--à-lire-avant-décrire-du-code)
10. [Environnement de test](#10-environnement-de-test)
11. [Passer en production](#11-passer-en-production)
12. [Référence des erreurs](#12-référence-des-erreurs)
13. [Quotas et rotation des clés](#13-quotas-et-rotation-des-clés)
14. [Nous signaler un problème](#14-nous-signaler-un-problème)

---

## 1. Ce que l'intégration fait

Trois automatisations, et rien d'autre.

| | |
|---|---|
| **Synchronisation des comptes** | Un marchand s'inscrit chez vous → son compte est créé chez nous. Il s'y connecte avec **le même email et le même mot de passe que chez vous**, puis suit ses colis depuis son espace Mathio |
| **Déclaration du stock** | Vous envoyez des produits à notre entrepôt pour un marchand → vous nous déclarez chaque produit, son SKU et la quantité envoyée. Le marchand les voit dans son inventaire |
| **Ingestion des colis** | Un colis est créé chez vous → il entre dans notre chaîne logistique, à l'unité ou par lot. Il contient un ou plusieurs produits de ce stock, désignés par leur SKU, que nous préparons dans notre entrepôt |

**Le flux est à sens unique : vous écrivez, vous ne lisez pas.** En dehors de la liste de nos
villes (§8), l'API n'expose aucun endpoint de consultation. Le suivi des colis et du stock se
fait, pour le marchand, depuis son espace Mathio.

> Le retour automatique des statuts vers vos serveurs (webhooks) n'est pas encore disponible.
> Il fera l'objet d'une version ultérieure.

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
| `telephone` | Numéro marocain : `0` puis `5`, `6` ou `7`, puis 8 chiffres. Les écritures `+212…`, `212…` et les espaces sont acceptées et normalisées |

**Identifiants de connexion** — requis tous les deux. Ce sont ceux du marchand chez vous ; ils
deviennent les siens chez nous :

| Champ | Format |
|---|---|
| `email` | Son login. Normalisé en minuscules |
| `motDePasse` | Son mot de passe, **en clair**. Pris tel quel, sans suppression d'espaces ; 72 octets au maximum. Nous le chiffrons dès réception (bcrypt) et ne le conservons ni ne le journalisons jamais en clair |

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
il vaut toujours `en_attente_validation` — voir §10.

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
| `409` | `marchand_de_test` | Vous utilisez une clé `live` sur des coordonnées créées en bac à sable. Voir §11 |
| `409` | `marchand_de_production` | Vous utilisez une clé `test` sur des coordonnées d'un marchand réel. Voir §10 |
| `400` | `champ_requis` | Le message nomme le champ manquant |
| `400` | `telephone_invalide` · `email_invalide` · `mot_de_passe_invalide` · `rib_invalide` · `type_compte_invalide` | Format incorrect |

---

## 5. `POST /v1/produits`

Déclare un produit de stock d'un de vos marchands : le produit, son SKU et la quantité que vous
envoyez à notre entrepôt. Demande le droit `produits:creation` sur votre clé.

**Déclarez un produit avant de l'utiliser dans un colis** : un colis qui cite un SKU que nous ne
connaissons pas est refusé (§6).

### Champs

Même format que l'ajout d'un produit depuis l'espace marchand, avec en plus le marchand concerné.

| Champ | Format |
|---|---|
| `idExterneMarchand` | **Requis.** L'`idExterne` d'un marchand déjà synchronisé. Le stock est propre à chaque marchand |
| `nom` | **Requis.** Nom du produit |
| `reference` | **Votre SKU** du produit. **Requis pour un produit sans variantes** (c'est son unité de stock). **Facultatif pour un produit à variantes** : à défaut, nous lui attribuons une référence interne (`PRD-…`), renvoyée dans la réponse, dont vous n'avez pas à vous servir |
| `quantiteEnCours` | **Requis pour un produit sans variantes.** Quantité envoyée à notre entrepôt, entier positif ou nul |
| `note` | Texte libre |
| `photoUrl` | URL `https://…`, ou image embarquée `data:image/…;base64,…` de 2 Mo au plus |
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

Un produit sans variantes :

```json
{ "idExterneMarchand": "SHIPEH-1", "nom": "Mug blanc", "reference": "MUG-01", "quantiteEnCours": 20 }
```

**Produit à variantes : ce sont les SKU des variantes qui comptent.** Chaque variante est une
unité de stock à part, et c'est son SKU que vos colis citent (§6). Le SKU du produit ne sert qu'à
regrouper ses variantes : envoyez-y votre identifiant de produit parent si vous en avez un. Un
préfixe commun (`ROBE-ETE`, `ROBE-ETE-ROUGE-M`) est lisible mais pas exigé : nous rattachons les
variantes à leur produit parce qu'elles arrivent dans le même appel, jamais en comparant les SKU.

**Un SKU désigne une seule chose chez un marchand** : le SKU d'un produit et ceux de ses variantes
ne peuvent servir à rien d'autre dans son stock. Les SKU sont comparés **sans tenir compte des
majuscules**.

### La quantité est annoncée, pas encore en stock

La quantité déclarée est celle que vous **envoyez**. Elle devient du stock disponible quand notre
entrepôt a **réceptionné et compté** la marchandise. D'ici là, le produit est
`pas_encore_recu`.

### Réponses

```json
{
  "issue": "cree",
  "reference": "PRD-K7M2Q9XA",
  "produitId": "3f1c…",
  "statutReception": "pas_encore_recu",
  "variantes": [
    { "reference": "PRD-K7M2Q9XA-BLEU-M", "varianteId": "…" },
    { "reference": "PRD-K7M2Q9XA-ROUGE-L", "varianteId": "…" },
    { "reference": "PRD-K7M2Q9XA-ROUGE-M", "varianteId": "…" }
  ]
}
```

| Code | `issue` | |
|---|---|---|
| `201` | `cree` | Le produit est créé dans le stock du marchand |
| `200` | `deja_existant` | Ce produit est déjà déclaré pour ce marchand : reconnu à son SKU, ou, sans SKU de produit, parce que **toutes** ses variantes existent déjà sous un même produit. **Aucune écriture**, et **la quantité n'est pas ajoutée une seconde fois** |

### Refus spécifiques

| Code | `code` | |
|---|---|---|
| `404` | `marchand_inconnu` | Aucun marchand synchronisé sous cet identifiant, dans l'environnement de votre clé |
| `409` | `sku_deja_utilise` | Un des SKU désigne déjà un **autre** produit (ou une de ses variantes) de ce marchand |
| `400` | `sku_duplique` | Le même SKU apparaît deux fois dans la requête (produit compris) |
| `400` | `champ_requis` · `quantite_invalide` · `photo_invalide` · `variantes_trop_nombreuses` | Le message nomme le champ |
| `403` | `scope_manquant` | Votre clé n'a pas le droit `produits:creation` |

---

## 6. `POST /v1/colis`

Dépose un colis. **Chaque colis contient un ou plusieurs produits de stock** du marchand, désignés
par leur SKU (§5). Un même produit peut figurer dans autant de colis que vous voulez.

### Champs

**Requis** :

| Champ | Format |
|---|---|
| `idExterneMarchand` | L'`idExterne` d'un marchand déjà synchronisé |
| `reference` | Votre référence du colis. **C'est la clé d'idempotence** — voir §9 |
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

Avant de créer le colis, nous vérifions **chaque SKU** dans le stock **de ce marchand**. S'il en
manque un seul, **le colis est refusé et rien n'est créé** : la réponse nomme tous les SKU
inconnus, pour que vous corrigiez en un seul aller-retour. Déclarez le produit (§5), puis rejouez.

Le stock disponible, lui, n'est pas vérifié à ce moment : il est réservé quand notre entrepôt
prépare le colis. Si la quantité manque alors (stock annoncé pas encore réceptionné, ou déjà
consommé par d'autres colis), le colis reste en attente chez nous jusqu'au réapprovisionnement ;
il n'est ni refusé ni perdu.

### Réponses

```json
{
  "issue": "cree",
  "reference": "SHP-2026-0001",
  "codeSuivi": "PD-101066",
  "marchandId": "6a1d1e40-…",
  "statut": "nouveau_colis",
  "aRisque": false
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
| `400` | `sku_inconnu` | Un ou plusieurs SKU n'existent pas dans le stock de ce marchand. Le message les nomme. Déclarez-les via §5 |
| `400` | `sku_a_variantes` | Ce SKU est celui d'un produit à variantes : indiquez le SKU d'une de ses variantes (le message les liste) |
| `400` | `produits_invalides` | `produits` n'est pas un tableau, est vide, ou dépasse 100 lignes |
| `400` | `montant_invalide` · `quantite_invalide` · `poids_invalide` | Valeur hors bornes ou de mauvais type |
| `400` | `champ_requis` | Le message nomme le champ (`produits`, `produits[0].sku`…) |

---

## 7. `POST /v1/colis/lot`

Dépose plusieurs colis en un appel. Le corps est un **tableau**, de 1 à **200** colis, chacun au
format du §6.

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
        "aRisque": false
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

## 8. `GET /v1/villes`

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

## 9. Idempotence — à lire avant d'écrire du code

C'est le point le plus important de cette documentation.

**Rejouer un appel ne crée jamais de doublon.** Vous pouvez donc réessayer sans risque après un
timeout, une coupure réseau, ou une redélivrance de votre file de messages.

| Endpoint | Clé d'idempotence | Rejeu |
|---|---|---|
| `/v1/marchands` | `idExterne` | `200` + `issue: "deja_synchronise"` |
| `/v1/produits` | SKU du produit (à défaut, SKU de ses variantes) + marchand | `200` + `issue: "deja_existant"`, **sans ajouter la quantité** |
| `/v1/colis` | `reference` | `200` + `issue: "deja_ingere"` + **le code de suivi d'origine** |

Deux conséquences pour votre code :

**Un rejeu répond en succès, pas en erreur.** Ne traitez pas `200 deja_ingere` comme un échec :
c'est la confirmation que le colis est bien chez nous, avec le numéro de suivi qui va avec.

**Ne réutilisez jamais une `reference` pour un colis différent.** Nous vous renverrions le colis
d'origine, et le nouveau ne serait jamais créé. Une référence, un colis, définitivement.

La garantie tient même si deux de vos serveurs appellent en même temps.

---

## 10. Environnement de test

Votre clé `mtk_test_…` travaille dans un espace séparé. Vous pouvez y envoyer n'importe quoi.

### Ce qui change

| | En bac à sable |
|---|---|
| Marchands créés | Restent **en attente de validation** — jamais actifs |
| Visibilité | Une clé `test` ne voit **que** les marchands qu'elle a créés |
| Produits déclarés | Rangés chez ces marchands de test, et supprimés avec eux à la purge du bac à sable |
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

## 11. Passer en production

Dans cet ordre :

1. **Prévenez-nous.** Nous purgeons les données de votre bac à sable de notre côté.
2. Nous vous transmettons votre clé `mtk_live_…`.
3. Vous changez la clé dans votre configuration. **Rien d'autre ne change** — ni adresse, ni
   format, ni code.
4. Avec la clé `live`, vous resynchronisez vos marchands (§4), **puis redéclarez leurs produits
   de stock** (§5) avant d'envoyer leurs premiers colis : les produits du bac à sable ne passent
   pas en production.

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

## 12. Référence des erreurs

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
| `400` | `telephone_invalide` | Format marocain attendu |
| `400` | `email_invalide` | |
| `400` | `mot_de_passe_invalide` | Chaîne de caractères, 72 octets au maximum |
| `400` | `rib_invalide` | 24 chiffres exactement |
| `400` | `type_compte_invalide` | Valeurs : `marchand`, `entreprise`, `dropshipping` |
| `400` | `montant_invalide` | Doit être `> 0` et `≤ 99999999.99` |
| `400` | `quantite_invalide` | Entier positif (positif ou nul pour une quantité de stock) |
| `400` | `produits_invalides` | Le contenu d'un colis : tableau de 1 à 100 lignes |
| `400` | `sku_inconnu` | SKU absent du stock du marchand — le message les nomme |
| `400` | `sku_a_variantes` | SKU d'un produit à variantes : indiquer celui d'une variante |
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
| `409` | `sku_deja_utilise` | SKU déjà porté par un autre produit du marchand |
| `413` | `lot_trop_grand` | Plus de 200 colis |
| `429` | `quota_depasse` | Voir §13 |
| `500` | `erreur_interne` | Chez nous. Réessayez, et signalez-le si ça persiste |

### Ce qu'il faut rejouer, ce qu'il ne faut pas

| Rejouable tel quel | À corriger avant de rejouer |
|---|---|
| `429`, `500`, `synchronisation_concurrente` | Tous les `400` |
| `deja_synchronise`, `deja_existant`, `deja_ingere` (déjà des succès) | `400 sku_inconnu` — déclarez le produit d'abord (§5) |
| | `404 marchand_inconnu` — créez le marchand d'abord (§4) |

Sur `429`, le message indique le délai d'attente. Une temporisation exponentielle est la bonne
réponse.

---

## 13. Quotas et rotation des clés

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

## 14. Nous signaler un problème

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
POST /api/v1/produits      déclarer un produit de stock (SKU, variantes, quantité envoyée)
POST /api/v1/colis         déposer un colis : produits [{ sku, quantite }] obligatoire
POST /api/v1/colis/lot     déposer jusqu'à 200 colis
GET  /api/v1/villes        nos villes : nom, code, tarif de livraison

Authorization: Bearer mtk_<env>_<prefixe>_<secret>
Content-Type: application/json

Idempotence   marchands → idExterne     produits → SKU      colis → reference
Rejeu         200 deja_synchronise      200 deja_existant   200 deja_ingere + même codeSuivi
SKU inconnu   colis refusé (400 sku_inconnu), rien n'est créé
Lot           toujours 207, lire lignes[].ok
Erreurs       { "code": "...", "message": "..." } — brancher sur code
```
