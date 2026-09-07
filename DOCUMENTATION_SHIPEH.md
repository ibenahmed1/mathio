# API Mathio Delivery — intégration Shipeh

Documentation destinée aux **développeurs de Shipeh**. Elle décrit tout ce qu'il faut pour
envoyer vos marchands et vos colis à Mathio Delivery.

Version 1.0 — septembre 2026

---

## Table des matières

1. [Ce que l'intégration fait](#1-ce-que-lintégration-fait)
2. [Démarrer](#2-démarrer)
3. [Authentification](#3-authentification)
4. [`POST /v1/marchands`](#4-post-v1marchands)
5. [`POST /v1/colis`](#5-post-v1colis)
6. [`POST /v1/colis/lot`](#6-post-v1colislot)
7. [Idempotence — à lire avant d'écrire du code](#7-idempotence--à-lire-avant-décrire-du-code)
8. [Environnement de test](#8-environnement-de-test)
9. [Passer en production](#9-passer-en-production)
10. [Référence des erreurs](#10-référence-des-erreurs)
11. [Quotas et rotation des clés](#11-quotas-et-rotation-des-clés)
12. [Nous signaler un problème](#12-nous-signaler-un-problème)

---

## 1. Ce que l'intégration fait

Deux automatisations, et rien d'autre.

| | |
|---|---|
| **Synchronisation des comptes** | Un marchand s'inscrit chez vous → son compte est créé chez nous. Il reçoit un email pour définir son mot de passe, puis suit ses colis depuis son espace Mathio |
| **Ingestion des colis** | Un colis est créé chez vous → il entre dans notre chaîne logistique, à l'unité ou par lot |

**Le flux est à sens unique : vous écrivez, vous ne lisez pas.** L'API n'expose aucun endpoint de
consultation. Le suivi des colis se fait, pour le marchand, depuis son espace Mathio.

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
    "nomBoutique": "Atlas Store",
    "telephone": "0612345678",
    "email": "ahmed@exemple.test"
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

**Requis** — cinq :

| Champ | Format |
|---|---|
| `idExterne` | Votre identifiant du marchand. **C'est la clé de la synchronisation** : c'est par lui que vous nous parlerez de ce marchand ensuite |
| `nomComplet` | Nom de la personne |
| `nomBoutique` | Nom commercial |
| `telephone` | Numéro marocain : `0` puis `5`, `6` ou `7`, puis 8 chiffres. Les écritures `+212…`, `212…` et les espaces sont acceptées et normalisées |
| `email` | **Obligatoire.** C'est par lui que le marchand reçoit le lien pour définir son mot de passe — sans email, il ne peut jamais accéder à son espace |

**Optionnels** :

| Champ | Format |
|---|---|
| `ville`, `adresse` | Texte libre |
| `rib` | Exactement 24 chiffres |
| `cin` | Numéro de carte d'identité |
| `siteWeb`, `nomBanque`, `registreCommerce`, `villeRamassage`, `raisonSociale`, `iceRc` | Texte libre |
| `typeCompte` | `marchand` (défaut), `entreprise` ou `dropshipping` |

Nous demandons volontairement **moins** que notre propre formulaire d'inscription : vous ne
détenez ni photo de RIB ni mot de passe choisi par le marchand. Une fiche incomplète, complétable
ensuite chez nous, vaut mieux qu'une fiche inventée.

### Réponses

```json
{
  "issue": "cree",
  "idExterne": "SHIPEH-1",
  "marchandId": "6a1d1e40-8642-4859-98eb-b086bd6d68cf",
  "nomBoutique": "Atlas Store",
  "statut": "actif",
  "invitationEnvoyee": true
}
```

Trois issues possibles :

| Code | `issue` | Signification |
|---|---|---|
| `201` | `cree` | Le compte a été créé. Un email d'invitation est parti |
| `200` | `rattache` | Ce marchand **était déjà notre client**, inscrit directement chez nous. Nous avons créé le lien, sans modifier sa fiche |
| `200` | `deja_synchronise` | Cet `idExterne` nous est déjà connu. **Aucune écriture** |

`marchandId` est notre identifiant interne. Vous n'avez pas besoin de le stocker : c'est votre
`idExterne` qui fait référence dans tous nos échanges. Nous le renvoyons pour vos journaux.

`statut` vaut `actif` ou `en_attente_validation` selon les droits de votre clé. En bac à sable,
il vaut toujours `en_attente_validation` — voir §8.

`invitationEnvoyee` à `false` signifie que le compte existe mais qu'aucun email n'est parti.
C'est normal en bac à sable. En production, signalez-le nous.

### Refus spécifiques

| Code | `code` | Cause et remède |
|---|---|---|
| `409` | `compte_non_marchand` | Ces coordonnées appartiennent chez nous à un livreur ou à un membre de notre personnel. Vérifiez le numéro |
| `409` | `conflit_identifiants` | Le téléphone et l'email désignent **deux comptes différents** chez nous. Nous refusons de choisir |
| `409` | `deja_lie` | Ce marchand est déjà rattaché à votre plateforme sous un autre `idExterne` |
| `409` | `synchronisation_concurrente` | Deux de vos appels se sont croisés. **Rejouez** : vous obtiendrez `deja_synchronise` |
| `409` | `marchand_de_test` | Vous utilisez une clé `live` sur des coordonnées créées en bac à sable. Voir §9 |
| `409` | `marchand_de_production` | Vous utilisez une clé `test` sur des coordonnées d'un marchand réel. Voir §8 |
| `400` | `champ_requis` | Le message nomme le champ manquant |
| `400` | `telephone_invalide` · `email_invalide` · `rib_invalide` · `type_compte_invalide` | Format incorrect |

---

## 5. `POST /v1/colis`

Dépose un colis.

### Champs

**Requis** :

| Champ | Format |
|---|---|
| `idExterneMarchand` | L'`idExterne` d'un marchand déjà synchronisé |
| `reference` | Votre référence du colis. **C'est la clé d'idempotence** — voir §7 |
| `clientNom` | Destinataire |
| `clientTelephone` | Téléphone du destinataire |
| `ville` | Texte libre. Nous la rapprochons de notre référentiel quand nous la reconnaissons ; une ville inconnue n'est jamais refusée |
| `adresse` | Adresse de livraison |
| `montantCod` | Montant à encaisser, en dirhams. Strictement positif, maximum `99999999.99`. Arrondi à deux décimales. Une chaîne (`"349.90"`) est acceptée |

**Optionnels** :

| Champ | Format |
|---|---|
| `codePostal` | |
| `produitDescription` | Description du contenu |
| `quantite` | Entier positif, défaut `1` |
| `poidsKg` | Nombre positif, maximum `9999.99` |
| `notes` | Consigne de livraison |
| `fragile` | Booléen, défaut `false` |
| `ouvrir` | Booléen, défaut `false`. Le client est autorisé à ouvrir le colis avant de payer |

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
| `400` | `montant_invalide` · `quantite_invalide` · `poids_invalide` | Valeur hors bornes ou de mauvais type |
| `400` | `champ_requis` | Le message nomme le champ |

---

## 6. `POST /v1/colis/lot`

Dépose plusieurs colis en un appel. Le corps est un **tableau**, de 1 à **200** colis, chacun au
format du §5.

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

## 7. Idempotence — à lire avant d'écrire du code

C'est le point le plus important de cette documentation.

**Rejouer un appel ne crée jamais de doublon.** Vous pouvez donc réessayer sans risque après un
timeout, une coupure réseau, ou une redélivrance de votre file de messages.

| Endpoint | Clé d'idempotence | Rejeu |
|---|---|---|
| `/v1/marchands` | `idExterne` | `200` + `issue: "deja_synchronise"` |
| `/v1/colis` | `reference` | `200` + `issue: "deja_ingere"` + **le code de suivi d'origine** |

Deux conséquences pour votre code :

**Un rejeu répond en succès, pas en erreur.** Ne traitez pas `200 deja_ingere` comme un échec :
c'est la confirmation que le colis est bien chez nous, avec le numéro de suivi qui va avec.

**Ne réutilisez jamais une `reference` pour un colis différent.** Nous vous renverrions le colis
d'origine, et le nouveau ne serait jamais créé. Une référence, un colis, définitivement.

La garantie tient même si deux de vos serveurs appellent en même temps.

---

## 8. Environnement de test

Votre clé `mtk_test_…` travaille dans un espace séparé. Vous pouvez y envoyer n'importe quoi.

### Ce qui change

| | En bac à sable |
|---|---|
| Marchands créés | Restent **en attente de validation** — jamais actifs |
| Email d'invitation | **Jamais envoyé** |
| Visibilité | Une clé `test` ne voit **que** les marchands qu'elle a créés |
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

## 9. Passer en production

Dans cet ordre :

1. **Prévenez-nous.** Nous purgeons les données de votre bac à sable de notre côté.
2. Nous vous transmettons votre clé `mtk_live_…`.
3. Vous changez la clé dans votre configuration. **Rien d'autre ne change** — ni adresse, ni
   format, ni code.
4. Vous resynchronisez vos marchands avec la clé `live`.

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

## 10. Référence des erreurs

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
| `400` | `rib_invalide` | 24 chiffres exactement |
| `400` | `type_compte_invalide` | Valeurs : `marchand`, `entreprise`, `dropshipping` |
| `400` | `montant_invalide` | Doit être `> 0` et `≤ 99999999.99` |
| `400` | `quantite_invalide` | Entier positif |
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
| `413` | `lot_trop_grand` | Plus de 200 colis |
| `429` | `quota_depasse` | Voir §11 |
| `500` | `erreur_interne` | Chez nous. Réessayez, et signalez-le si ça persiste |

### Ce qu'il faut rejouer, ce qu'il ne faut pas

| Rejouable tel quel | À corriger avant de rejouer |
|---|---|
| `429`, `500`, `synchronisation_concurrente` | Tous les `400` |
| `deja_ingere` / `deja_synchronise` (déjà un succès) | `404 marchand_inconnu` — créez le marchand d'abord |

Sur `429`, le message indique le délai d'attente. Une temporisation exponentielle est la bonne
réponse.

---

## 11. Quotas et rotation des clés

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

## 12. Nous signaler un problème

Nous conservons un journal de tous les appels reçus : horodatage, endpoint, code de réponse,
durée, et la référence concernée. Pour que nous retrouvions un appel, envoyez-nous :

- l'**horodatage approximatif** (à la minute près suffit) ;
- l'**`idExterne`** ou la **`reference`** concernée ;
- le **code de réponse** que vous avez reçu.

Inutile de nous envoyer le corps de vos requêtes : nous ne le conservons pas — il contiendrait
des données de vos clients finaux — mais nous avons le message d'erreur exact que nous vous avons
renvoyé.

---

## Aide-mémoire

```
POST /api/v1/marchands     synchroniser un marchand
POST /api/v1/colis         déposer un colis
POST /api/v1/colis/lot     déposer jusqu'à 200 colis

Authorization: Bearer mtk_<env>_<prefixe>_<secret>
Content-Type: application/json

Idempotence   marchands → idExterne     colis → reference
Rejeu         200 deja_synchronise      200 deja_ingere + même codeSuivi
Lot           toujours 207, lire lignes[].ok
Erreurs       { "code": "...", "message": "..." } — brancher sur code
```
