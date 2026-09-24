# Déclarer l'état de nos colis — API Mathio Delivery

Document destiné aux développeurs d'**EST Livraison**.

Nous vous confions nos colis par votre API (`add-rammasage`). Ce document décrit le chemin
inverse : comment nous déclarer ce que devient chaque colis sur le terrain — livré, reporté,
refusé, injoignable.

Sans ce retour, un colis que vous avez livré reste « remis au transporteur » chez nous : le
marchand n'est pas payé et votre prestation n'est pas facturable. C'est donc le maillon qui ferme
le cycle.

---

## 1. Le code qui relie nos deux systèmes

**Le `code` que nous vous envoyons dans `add-rammasage` est notre code de suivi. C'est exactement
celui que vous devez nous citer en retour.**

```
JAD-RBIEC9-310726
```

Nous ne vous envoyons aucun autre identifiant, et nous n'attendons aucune traduction de votre
part : le code part chez vous tel quel, il nous revient tel quel. Si votre système attribue son
propre numéro interne, gardez-le pour vous — il ne nous sert pas.

La casse n'a pas d'importance : nous normalisons en majuscules à la réception, et les espaces de
bord sont retirés.

---

## 2. Authentification

Une clé que nous vous remettons, dans l'en-tête `Authorization` :

```http
Authorization: Bearer mtk_live_<prefixe>_<secret>
```

Repli accepté si votre client HTTP ne permet pas de poser `Authorization` :

```http
X-Mathio-Api-Key: mtk_live_<prefixe>_<secret>
```

- Nous vous remettons d'abord une clé de **test**, puis une clé **live** une fois le branchement
  validé. Les deux se ressemblent, seul le préfixe change (`mtk_test_` / `mtk_live_`).
- La clé n'est affichée qu'une fois chez nous : conservez-la. En cas de perte, nous en émettons une
  nouvelle et révoquons l'ancienne.
- **Quota : 600 appels par minute et par clé.** Au-delà, `429`.

Racine de l'API : `https://api.⟨DOMAINE⟩` — nous vous la communiquons avec la clé.

> Ces routes n'existent que sur ce domaine. Elles répondent 404 sur nos autres domaines : si vous
> obtenez un 404 sur **tous** les endpoints, vérifiez d'abord l'hôte.

---

## 3. Les quatre endpoints

| Endpoint | Quand l'appeler |
|---|---|
| `POST /api/v1/auth` | une fois, au branchement — vérifie que la clé fonctionne |
| `GET /api/v1/statuts` | au démarrage de votre système, puis en cache |
| `POST /api/v1/livraisons/statut` | à chaque événement terrain |
| `POST /api/v1/livraisons/statut/lot` | en fin de tournée, ou la nuit |

### 3.1 Vérifier la clé — `POST /api/v1/auth`

Aucun corps à envoyer.

```jsonc
{ "valide": true, "plateforme": "est-livraison", "environnement": "test",
  "scopes": ["livraisons:statut"] }
```

Appelez-le en premier. Il distingue « ma clé est mauvaise » (401) de « ma clé est bonne mais mal
configurée » (403) sans toucher à un vrai colis.

### 3.2 Le catalogue — `GET /api/v1/statuts`

Renvoie la liste des statuts acceptés, avec pour chacun son libellé et s'il exige une date. Nous
pouvons y **ajouter** des valeurs ; nous n'en retirons jamais sans changer de version d'API.
Lisez-le au démarrage plutôt que de recopier le tableau du §4 en dur.

### 3.3 Un événement — `POST /api/v1/livraisons/statut`

```jsonc
{
  "codeSuivi": "JAD-RBIEC9-310726",
  "statut": "reporte",
  "date": "2026-09-12",                      // requise pour reporte et programme
  "note": "Client absent, rappelle demain"   // facultative, 150 caractères max
}
```

| Champ | Règle |
|---|---|
| `codeSuivi` | requis — le `code` que nous vous avons envoyé (§1) |
| `statut` | requis, une des 12 valeurs du §4 |
| `date` | ISO 8601 : `2026-09-12` ou `2026-09-12T14:30:00Z`. Requise pour `reporte` et `programme`, ignorée ailleurs |
| `note` | 150 caractères maximum — au-delà l'appel est refusé, la note n'est pas tronquée |

Réponse :

```jsonc
{ "issue": "applique", "codeSuivi": "JAD-RBIEC9-310726", "statut": "reporte" }
```

`issue` vaut `applique`, ou **`inchange`** si le colis portait déjà ce statut. `inchange` n'est pas
une erreur : **renvoyer deux fois le même événement est sans danger**, rien n'est dupliqué. En cas
de doute sur un appel qui n'a pas répondu, renvoyez-le.

### 3.4 Un lot — `POST /api/v1/livraisons/statut/lot`

```jsonc
{ "livraisons": [
    { "codeSuivi": "JAD-RBIEC9-310726", "statut": "livre" },
    { "codeSuivi": "CAS-M2P4X7-310726", "statut": "reporte", "date": "2026-09-12" }
] }
```

**100 lignes maximum.** Chaque ligne suit exactement les règles du §3.3.

```jsonc
{
  "totalTraite": 1,
  "totalRefuse": 1,
  "resultats": [
    { "issue": "applique", "codeSuivi": "JAD-RBIEC9-310726", "statut": "livre" },
    { "issue": "refuse", "codeSuivi": "CAS-M2P4X7-310726", "code": "colis_clos",
      "message": "Ce colis est clos (« livre ») : son statut ne peut plus être modifié" }
  ]
}
```

**Le lot répond toujours 200, même si toutes les lignes sont refusées**, et il n'est pas atomique :
une ligne fautive ne retient pas les autres. Lisez `resultats` ligne par ligne, pas le seul code
HTTP. Seules les erreurs qui empêchent de traiter le lot lui-même — clé, corps illisible, plus de
100 lignes — sortent en erreur HTTP.

---

## 4. Les statuts acceptés

| Valeur | Libellé | Date requise | Ferme le colis |
|---|---|---|---|
| `livre` | Livré | | **oui** |
| `refuse` | Refusé | | |
| `annule` | Annulé | | **oui** |
| `hors_zone` | Hors-zone | | |
| `reporte` | Reporté | **oui** | |
| `programme` | Programmé | **oui** | |
| `injoignable` | Injoignable | | |
| `boite_vocale` | Boite Vocal | | |
| `deuxieme_appel_pas_reponse` | Deuxième Appel Pas Réponse | | |
| `troisieme_appel_pas_reponse` | Troisième Appel Pas Réponse | | |
| `numero_errone` | Numero_Erroné | | |
| `client_interesse` | Client intéressé | | |

Si vous avez déjà branché une API COD marocaine, votre vocabulaire se retrouve ici :

| Chez vos confrères | Chez nous |
|---|---|
| `DELIVERED` | `livre` |
| `POSTPONED` | `reporte` |
| `NOANSWER` — personne n'a répondu | `injoignable` (porte sur la **personne**) |
| `UNREACHABLE` — adresse inaccessible | `hors_zone` (porte sur l'**adresse**) |
| `CANCELLED` | `annule` |
| `REFUSE` | `refuse` |
| `PROGRAMMED` | `programme` |
| `INTERESTED` | `client_interesse` |

**Ce que nous n'acceptons pas, et pourquoi.** Les étapes de votre logistique interne — ramassé,
expédié, arrivé au dépôt, en cours de tri — n'ont pas d'équivalent ici : nous ne suivons que
**l'issue de la livraison**. Envoyez-nous l'événement quand votre livreur a un constat à rapporter.

Le **retour** d'un colis ne se déclare pas non plus par cette API : il est enregistré chez nous au
scan de réception du colis physique. Un colis que vous nous renvoyez ne demande aucun appel.

---

## 5. Le périmètre

Vous pouvez déclarer les colis dont la **ville de destination** fait partie de votre réseau. Tout
autre code — inconnu chez nous, ou destiné à une ville que vous ne desservez pas — répond :

```jsonc
{ "code": "colis_introuvable", "message": "…" }   // 404
```

Un colis déjà **clos** (`livre`, `annule`) ne peut plus changer d'état : `409 colis_clos`. C'est
volontaire — une livraison payée ne se rouvre pas depuis l'extérieur. Si un colis clos doit être
corrigé, appelez-nous.

---

## 6. Codes d'erreur

Toute erreur a la même enveloppe :

```jsonc
{ "code": "statut_invalide", "message": "…" }
```

**Branchez vos conditions sur `code`, jamais sur `message`** : nous pouvons reformuler un message,
jamais changer un code.

| HTTP | `code` | Quand |
|---|---|---|
| 400 | `json_invalide` | corps illisible |
| 400 | `corps_invalide` | le corps, ou une ligne du lot, n'est pas un objet JSON |
| 400 | `champ_requis` | `codeSuivi` absent, ou `livraisons` vide |
| 400 | `statut_invalide` | valeur hors catalogue — le message cite les valeurs acceptées |
| 400 | `date_requise` | date absente, illisible ou hors ISO 8601 sur `reporte` / `programme` |
| 400 | `note_trop_longue` | plus de 150 caractères |
| 400 | `lot_trop_grand` | plus de 100 lignes |
| 401 | `cle_absente` / `cle_invalide` | clé absente ou refusée |
| 401 | `cle_expiree` / `cle_revoquee` | clé qui a fonctionné, et ne fonctionne plus |
| 403 | `scope_manquant` | clé valide, droit `livraisons:statut` absent — prévenez-nous |
| 403 | `plateforme_desactivee` | compte suspendu — prévenez-nous |
| 404 | `colis_introuvable` | code inconnu, ou ville hors de votre réseau (§5) |
| 409 | `colis_clos` | colis déjà terminal |
| 409 | `conflit_concurrent` | le colis a changé pendant le traitement — **réessayez l'appel** |
| 429 | `quota_depasse` | plus de 600 appels par minute |
| 500 | `erreur_interne` | de notre côté — réessayez, puis signalez-le nous |

`409 conflit_concurrent` et `429` sont les deux seuls cas où réessayer a du sens. Un `400` ou un
`404` ne se répare pas en réessayant.

---

## 7. Pour démarrer

1. Nous vous remettons une **clé de test** et la racine de l'API.
2. `POST /api/v1/auth` → doit répondre `"valide": true`.
3. `GET /api/v1/statuts` → doit lister 12 statuts.
4. Nous vous confions un colis réel ; vous nous déclarez son issue sur la clé de test.
5. Bascule en clé **live**.

Pour toute question sur ce document, ou si un code d'erreur vous bloque, contactez-nous avant de
contourner.
