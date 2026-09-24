# Intégration EST Livraison — remise des colis par LEUR API

Ce document décrit le branchement de Mathio sur l'API d'**EST Livraison** (`pb.estlivraison.com`),
un de nos transporteurs sous-traitants (région de l'Oriental, une agence à Oujda, 63 villes —
§ `SOUS_TRAITANCE.md`). Il est écrit **pour nous** : sens du flux, ce que leur documentation dit de
faux, état d'avancement, points bloquants.

Ne pas le confondre avec ses voisins :

| Document | Qui appelle qui | État |
|---|---|---|
| `API_SUIVI_PRESTATAIRES.md` | le transporteur **nous** appelle, dans notre format | implémenté |
| `API_SUIVI_EST_LIVRAISON.md` | **le document qu'on leur remet** — même flux, écrit pour eux | à leur envoyer |
| `INTEGRATION_POWER_DELIVERY.md` | nous appelons Power, dans son format | implémenté |
| **ce document** | **nous** appelons EST Livraison, dans **son** format | **dépôt vérifié, remise à écrire (§4)** |

---

## 1. Le flux

```
bon d'envoi vers l'Agence Oujda
   │  bouton « Remettre à EST Livraison »          ← PAS ENCORE ÉCRIT (§4)
   ▼
POST add-rammasage (une commande par appel) ──► RemisePrestataire ─► « Remis à un transporteur »
                                                      ▲
statut de terrain ──► POST /api/v1/livraisons/statut ─┘   ← EUX nous appellent
```

**Leur API ne sert AUCUNE lecture.** Pas de suivi, pas de webhook, pas de liste, pas un seul `GET`.
Elle ne sait que déposer un colis — et même pas l'annuler, sa route de suppression n'existant pas
(§3.2). L'issue des colis ne peut donc revenir que par **notre** API de suivi, qu'ils doivent
appeler — d'où `API_SUIVI_EST_LIVRAISON.md`.

---

## 2. Décisions arrêtées

**Notre `codeSuivi` part brut, sans préfixe** — contrairement au `MTH-` de Power Delivery. Ils nous
répondront sur `/api/v1/livraisons/statut`, qui cherche le colis sur ce champ exact ; un préfixe
obligerait le module de statuts, partagé par tous les transporteurs, à apprendre à le retirer. Notre
format (`JAD-RBIEC9-310726`) est assez distinctif pour ne pas heurter le code d'un autre de leurs
clients.

**`city_created` est une alarme, jamais une information.** Leur API **crée** la ville qu'elle ne
connaît pas au lieu de refuser. Une ville créée par notre appel prouve donc que le libellé envoyé
est faux, et que le colis partirait dans une ville que personne ne dessert. `lireCreation` en fait
un échec.

**Leurs `client_name` / `client_phone` restent vides.** Leur sens n'est pas documenté, et le seul
plausible — l'expéditeur — désignerait notre marchand. Leur donner le marchand, c'est leur donner
notre client.

**Une commande par appel.** Leur modèle d'erreur ne dit pas si un lot partiellement invalide est
rejeté en entier ; une commande par appel rend la question sans objet.

**L'échange passe par leur champ `is_echange`**, pas par une consigne en note : ils ont le champ,
Power ne l'avait pas.

**Longueur à 350 caractères : tronquer ou refuser, selon l'enjeu.** Le nom du produit et la note se
tronquent. L'adresse, le nom et le téléphone du destinataire font **refuser** le colis — une adresse
coupée livre à une adresse incomplète, ce qui est pire qu'un colis non remis.

---

## 3. Ce que leur documentation dit de faux

Leur OpenAPI (`Client Commands API (Ramassage)`, v1.0.0) a été confronté à leur serveur le
**23/09/2026**, **avec leur accord pour tester**. Le dépôt fonctionne, mais rien de ce que leur
documentation écrit sur la forme des échanges n'est exact.

Les appels de découverte portaient tous un corps incomplet, donc sans effet. Deux enregistrements
ont ensuite été créés volontairement (§3.4 ter) — ils sont à leur faire retirer.

### 3.1 Leur serveur répond, et c'est bien un PocketBase

```
GET https://pb.estlivraison.com/api/health
→ 200 {"message":"API is healthy.","code":200,"data":{}}
```

### 3.2 La route de suppression N'EXISTE PAS

```
POST /v1/api/clients/commands/delete
→ 404 {"data":{},"message":"The requested resource wasn't found.","status":404}
```

C'est le 404 générique de PocketBase, celui que sert n'importe quelle route non déclarée. Cinq
transpositions du préfixe ont été essayées (`/api/v1/…`, `/api/…`, `/v1/…`, `/clients/…`,
`/api/v1/api/…`), puis quatre variantes du nom (`delete-rammasage`, `remove`, `cancel`,
`delete-commands`), sous les deux formes de corps : **toutes en 404**.

**L'annulation d'un colis déposé est donc impossible.** Ce qui part chez eux ne se reprend que par
un appel téléphonique. C'est la raison pour laquelle `scripts/tester-remise-est-livraison.ts` est à
blanc par défaut.

### 3.3 La route de création existe, mais n'attend pas le corps documenté

Leur OpenAPI décrit un dépôt **en lot**, sous une enveloppe `{ commands: [...] }`. Leur serveur rend
le même `"Code is required."` pour `{}`, `{"commands":[]}`, `{"commands":[{"code":"…"}]}` et
`{"orders":[{"code":"…"}]}` : il cherche un `code` **à la racine**. Un handler qui itérerait
`commands[]` aurait cité l'index de la ligne fautive, comme leur doc le montre.

**Leur API attend un objet PLAT, un colis par appel.** Toute la section « bulk » de leur
documentation est fausse, réponse comprise.

### 3.4 Le contrat réel, relevé de bout en bout

Champs **requis**, dans l'ordre où leur validation les réclame :

| Champ | Message si absent |
|---|---|
| `code` | `Code is required.` |
| `city` | `City is required.` |
| `receiver_phone_number` | `Receiver_phone_number is required.` |

Les huit autres champs de leur doc — `receiver_full_name`, `receiver_address`, `product_name`,
`quantity`, `price`, `note`, `is_echange`, `package_opened` — sont **acceptés en plus** : un dépôt
portant les onze champs a été accepté. Leur `additionalProperties: false` documenté ne s'est donc
pas manifesté sur ces noms-là.

Leur réponse à une création acceptée :

```jsonc
{ "success": true, "inserted": 1, "command_id": "sg8avc4ppmk7xhp",
  "command_code": "MATHIO-TEST-202609231716", "city_created": null }
```

Au **singulier** — `command_id`, `command_code`, `city_created` — là où leur doc annonce
`command_ids`, `inserted_codes`, `cities_created`. Et `city_created` vaut **`null`**, pas un tableau
vide, quand la ville existait déjà.

`lib/est-livraison.ts` lit **les deux formes** : celle qu'ils servent, et celle qu'ils documentent.
Trois lignes de plus, et l'alarme du §2 ne se tait pas le jour où ils aligneraient leur API sur leur
doc.

### 3.4 bis « OUJDA » existe chez eux

Le `city_created: null` rendu pour `city: "OUJDA"` **prouve** que cette ville existait déjà dans
leur base. C'est la seule correspondance de ville vérifiée à ce jour, et le seul moyen d'en vérifier
une sans leur liste — chaque vérification coûtant un dépôt réel, et chaque erreur créant une ville
fantôme. Les 62 autres villes de la grille attendent leur liste.

### 3.4 ter Deux enregistrements de test à faire retirer

Créés chez eux pendant ces essais, avec leur accord. **Leur API n'ayant aucune route d'annulation
qui réponde, ils ne peuvent être retirés que par EST Livraison :**

| Leur identifiant | Code envoyé |
|---|---|
| `ar9g1pvqkjayy06` | `MATHIO-SONDE-NE-PAS-UTILISER` |
| `sg8avc4ppmk7xhp` | `MATHIO-TEST-202609231716` |

### 3.5 Trois contradictions internes, relevées à la lecture

- Le schéma déclare `code` et `city` requis ; le texte de l'endpoint y ajoute
  `receiver_phone_number` ; l'exemple « minimal » ne l'envoie pas. **C'est le texte qui a raison**
  (§3.4) : leur exemple minimal est refusé par leur propre serveur.
- Le chemin porte une faute de frappe — `add-rammasage`, deux *m*, un *s* — et un préfixe inversé
  (`/v1/api` au lieu de `/api/v1`). Les deux sont recopiés tels quels : c'est bien à cette adresse
  que la route répond.
- Un code en doublon sort en **400**, pas en 409. C'est notre seul garde-fou d'idempotence :
  renvoyer le même code après un appel resté sans réponse prouverait que le colis existe chez eux.

---

## 4. État d'avancement

| | |
|---|---|
| `lib/est-livraison.ts` | écrit, **vérifié contre leur serveur** — corps plat, réponse au singulier |
| `lib/est-livraison-villes.ts` | écrit — **1 ville sur 63** (`OUJDA`, vérifiée), 62 en attente de leur liste |
| `scripts/tester-remise-est-livraison.ts` | écrit — dépôt d'un colis de test, **à blanc par défaut** |
| `scripts/verifier-cle-est-livraison.ts` | écrit — **inutilisable** : il s'appuie sur `delete`, qui répond 404 |
| `API_SUIVI_EST_LIVRAISON.md` | écrit, à leur envoyer |
| `lib/est-livraison.test.ts` + `-villes.test.ts` | 42 tests |
| `lib/remise-est-livraison.ts`, route, écran | **pas écrits** — le lot suivant |
| Migration `RemisePrestataire` | **pas générée** — `cityId` en nullable + `villeEnvoyee String?` |

Le dépôt d'un colis est donc **fonctionnel de bout en bout**, du corps construit par nos soins
jusqu'à la lecture de leur réponse. Ce qui manque est chez nous (la remise depuis un bon d'envoi) et
chez eux (les villes, l'annulation, le retour de statut).

---

## 5. Ce qui bloque, et ce qu'il faut leur demander

Par ordre de blocage.

1. **Faire retirer les deux enregistrements de test** (§3.4 ter) : leur API ne sait pas les
   supprimer.
2. **Leur liste de villes**, libellés exacts. C'est elle qui fait foi : ils ne livrent que ce qui y
   figure, et leur API crée la ville qu'elle ne reconnaît pas au lieu de refuser. Seule `OUJDA` est
   vérifiée ; les 62 autres villes de la grille restent non remettables par l'API, et l'Excel du bon
   reste leur voie.
3. **L'URL réelle de l'annulation** — celle de leur doc répond 404, ainsi que neuf variantes
   (§3.2). Sans elle, un colis déposé par erreur ne se reprend qu'au téléphone.
4. **Peuvent-ils appeler notre API de suivi** (`API_SUIVI_EST_LIVRAISON.md`) ? Sans ça, un colis
   livré par eux reste « remis à un transporteur » chez nous jusqu'à notre propre scan.
5. Ce que « ramassage » recouvre chez eux : leur API n'a **aucun champ d'adresse d'expéditeur ni de
   date d'enlèvement**. Ce sont donc des réglages posés sur notre compte, de leur côté — d'où
   viennent-ils chercher les colis ?
6. Le sens de `client_name` / `client_phone` (§2).
7. Leur doc mérite une correction de leur part : corps plat, réponse au singulier, route d'annulation
   absente. Tant qu'elle reste en ligne telle quelle, le prochain intégrateur refera ce travail.

---

## 6. À savoir avant la mise en service

EST Livraison et Meta Livraison desservent **tous deux la Province de Taza** — `Aknoul`, `Bouhlou`,
`Tahla`, `Taourirt` et six autres (§ `SOUS_TRAITANCE.md` §2.9). Le périmètre de notre API de suivi
étant dérivé de la **ville de destination** et non d'une table de remise, **les deux transporteurs
pourront déclarer le même colis** sur ces dix villes, y compris celui que l'autre a livré.
