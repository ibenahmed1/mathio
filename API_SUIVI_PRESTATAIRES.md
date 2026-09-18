# API de suivi consommée par les prestataires

Ce document décrit le module qui permet à un **transporteur sous-traitant** de nous déclarer
l'issue des colis qu'on lui a confiés. Il est écrit **pour nous** : carte des fichiers, arbitrages,
mise en service, tests. La documentation destinée aux prestataires en est un sous-ensemble
(endpoints, formats, codes d'erreur) — elle reste à écrire.

Ne pas le confondre avec ses deux voisins :

| Document | Flux | État |
|---|---|---|
| `INTEGRATION_PLATEFORMES_PARTENAIRES.md` | **entrant, vente** — Shipeh nous dépose des colis | implémenté |
| `API_PARTENAIRES.md` | sous-traitance sortante, spécification large | spécification |
| **ce document** | **entrant, transport** — le transporteur nous déclare des statuts | implémenté |

---

## 1. Le trou que ça ferme

Aujourd'hui, un colis confié à Power Delivery ou à Meta Livraison **sort du système**. La remise se
fait par un fichier Excel, hors outil. À partir de cette minute :

- la base ne sait plus rien du colis, figé à son dernier statut connu ;
- pour savoir s'il est livré, il faut téléphoner, ou attendre qu'on nous renvoie un fichier ;
- la facturation du marchand, le COD à réclamer et le contrôle de la facture du transporteur
  reposent tous sur une information qu'on va chercher à la main.

L'idée du module est de **renverser la charge** : ce n'est plus à nous d'appeler pour savoir, c'est
au prestataire de déposer l'information au fil de ses tournées.

**Personne chez nous n'appelle quoi que ce soit.** On expose, on attend. Et ce n'est pas le livreur
qui appelle : il continue de travailler dans l'application de son employeur, c'est le *système* du
prestataire qui nous relaie. Zéro double saisie — c'est toute la raison d'être du module.

```
Excel   Mathio ──────────► prestataire     (sortant, manuel, existe déjà)
API     Mathio ◄────────── prestataire     (entrant, machine, ce module)
```

### Ce que l'Excel rend inutile pour l'instant

Le prestataire a déjà la liste des colis : elle est dans le fichier. Aucun endpoint de lecture
(« quels colis sont à moi ? »), aucune étiquette, aucun bon de livraison n'est donc nécessaire.
La seule chose que le fichier ne sait pas faire, c'est **revenir**.

---

## 2. Carte des fichiers

### Nouveaux

| Fichier | Rôle |
|---|---|
| [`lib/livraison-statut.ts`](lib/livraison-statut.ts) | **tout le métier** : validation, périmètre, transitions, application, lot |
| [`app/api/v1/auth/route.ts`](app/api/v1/auth/route.ts) | `POST /api/v1/auth` — test de branchement |
| [`app/api/v1/statuts/route.ts`](app/api/v1/statuts/route.ts) | `GET /api/v1/statuts` — le catalogue |
| [`app/api/v1/livraisons/statut/route.ts`](app/api/v1/livraisons/statut/route.ts) | `POST` — un colis |
| [`app/api/v1/livraisons/statut/lot/route.ts`](app/api/v1/livraisons/statut/lot/route.ts) | `POST` — jusqu'à 100 |
| [`app/api/plateformes/transporteurs/route.ts`](app/api/plateformes/transporteurs/route.ts) | back-office : les transporteurs sans compte machine |
| [`prisma/migrations/20260908090000_compte_machine_prestataire/`](prisma/migrations/20260908090000_compte_machine_prestataire/) | la colonne de rattachement |
| [`lib/__tests__/livraison-statut.test.ts`](lib/__tests__/livraison-statut.test.ts) | validation et transitions |
| [`lib/__tests__/statuts-prestataire.test.ts`](lib/__tests__/statuts-prestataire.test.ts) | intégrité du catalogue |

### Modifiés

| Fichier | Ce qui change |
|---|---|
| [`prisma/schema.prisma`](prisma/schema.prisma) | `PlateformePartenaire.prestataireId` + relation inverse sur `Prestataire` |
| [`lib/statuts.ts`](lib/statuts.ts) | `CATALOGUE_STATUTS_PRESTATAIRE`, `STATUTS_PRESTATAIRE`, `statutPrestataire()` |
| [`lib/plateforme-cles.ts`](lib/plateforme-cles.ts) | scope `livraisons:statut`, partition `SCOPES_TRANSPORTEUR` / `SCOPES_VENTE` |
| [`lib/plateformes.ts`](lib/plateformes.ts) | rattachement à la création, garde de cohérence à l'émission des clés |
| [`app/api/plateformes/route.ts`](app/api/plateformes/route.ts) | accepte `prestataireId` |
| [`app/admin/integrations/page.tsx`](app/admin/integrations/page.tsx) | sélecteur de transporteur, scopes filtrés par nature |
| [`lib/types.ts`](lib/types.ts) | `PlateformeResume.prestataire` côté client |

### Ce qui n'a pas été touché

- **`commandes` ne reçoit aucune colonne.** Tout tient dans des champs qui existaient déjà :
  `statut`, `dateLivraison`, `dateNouvelleLivraison`, plus `HistoriqueStatutCommande` et
  `CommentaireCommande`.
- **Aucune table de remise.** Le périmètre est dérivé du référentiel (§5.1).
- **`lib/plateforme-auth.ts` est inchangé** : clés, quota, journal et compte de service servent
  les deux audiences sans modification.

---

## 3. Authentification

Identique au flux entrant des plateformes de vente — c'est le même
[`requirePlateforme()`](lib/plateforme-auth.ts), la même mécanique de clés.

```http
Authorization: Bearer mtk_live_<prefixe>_<secret>
```

Repli accepté : `X-Mathio-Api-Key: mtk_live_…`. **Un seul nom d'en-tête**, documenté une fois —
c'est le défaut le plus coûteux des API concurrentes, dont la page d'endpoint et la page de token
n'annoncent pas le même.

- **Hôte dédié.** Ces routes n'existent que sur `HOST_API` ; elles répondent **404** sur les trois
  hôtes d'espace, et l'hôte d'API n'atteint rien d'autre. Cloisonnement appliqué dans
  [`proxy.ts`](proxy.ts), dans les deux sens : un cookie de session ne peut jamais atteindre cette
  surface, une clé d'API ne peut jamais atteindre le back-office.
- **Sans la variable `HOST_API`, toute la surface est injoignable.** Une intégration s'ouvre en
  posant une variable d'environnement, pas en déployant du code.
- **Scope requis** : `livraisons:statut`, sauf sur `POST /api/v1/auth` qui n'en exige aucun.
- **Quota** par clé et par minute (`CleApiPlateforme.quotaParMinute`, 600 par défaut), plus un
  plafond par IP appliqué avant toute lecture en base.

---

## 4. Les quatre endpoints

Racine : `https://api.<domaine>` — en développement `http://api.localhost:3000`.

| Endpoint | Scope | Appelé par | Rythme |
|---|---|---|---|
| `POST /api/v1/auth` | aucun | le développeur du prestataire | au branchement |
| `GET /api/v1/statuts` | `livraisons:statut` | son système | au démarrage, puis en cache |
| `POST /api/v1/livraisons/statut` | `livraisons:statut` | son système | à chaque événement terrain |
| `POST /api/v1/livraisons/statut/lot` | `livraisons:statut` | son système | fin de tournée, ou la nuit |

### 4.1 `POST /api/v1/auth`

Aucun corps. **N'exige aucun scope, délibérément** : un intégrateur doit pouvoir distinguer « ma
clé est mauvaise » (401) de « ma clé est bonne mais on ne m'a pas ouvert cet endpoint » (403). Un
test qui exigerait un scope confondrait les deux.

Sans lui, la seule façon de vérifier un branchement serait de poser un vrai statut sur un vrai
colis — c'est-à-dire de faire une écriture d'argent pour répondre à une question de configuration.

```jsonc
{ "valide": true, "plateforme": "meta-livraison", "environnement": "live",
  "scopes": ["livraisons:statut"] }
```

La réponse ne contient que ce que l'appelant possède déjà. Rien qui renseigne sur notre système,
rien qui distingue deux clés valides.

### 4.2 `GET /api/v1/statuts`

```jsonc
{
  "statuts": [
    { "statut": "livre", "libelle": "Livré", "dateRequise": false, "terminal": true,
      "description": "Colis remis au destinataire." },
    { "statut": "reporte", "libelle": "Reporté", "dateRequise": true, "terminal": false,
      "description": "Livraison reportée : indiquer la date de la prochaine tentative." }
  ]
}
```

Servi par l'API plutôt que figé dans une page de documentation : le jour où une valeur s'ajoute, le
système du partenaire la connaît au premier appel suivant.

Le scope requis est celui de l'**écriture**. Ce catalogue est la liste de ce que *cette clé* peut
poser ; il n'a aucun sens pour une clé qui ne peut rien poser, qui reçoit donc 403 — la réponse
juste, pas un 200 avec une liste inutilisable.

Réponse **enveloppée dans un objet** et non servie en tableau nu : y ajouter un champ plus tard
reste compatible, passer d'un tableau à un objet ne l'est jamais.

### 4.3 `POST /api/v1/livraisons/statut`

```jsonc
{
  "codeSuivi": "PD-000123",
  "statut": "reporte",
  "date": "2026-09-12",                      // requise pour reporte et programme
  "note": "Client absent, rappelle demain"   // facultative, 150 caractères
}
```

| Champ | Règle |
|---|---|
| `codeSuivi` | requis. Détouré et **normalisé en majuscules** — un partenaire qui recopie depuis un tableur renvoie parfois une autre casse, et répondre 404 là-dessus enverrait chercher un colis qui existe |
| `statut` | requis, l'une des 12 valeurs du catalogue |
| `date` | ISO 8601 (`2026-09-12` ou `2026-09-12T14:30:00Z`). Requise si `dateRequise`, **ignorée sinon** |
| `note` | 150 caractères maximum |

Réponse :

```jsonc
{ "issue": "applique", "codeSuivi": "PD-000123", "statut": "reporte" }
```

`issue` vaut `applique` ou `inchange` (§5.2).

### 4.4 `POST /api/v1/livraisons/statut/lot`

```jsonc
{ "livraisons": [
    { "codeSuivi": "PD-000123", "statut": "livre" },
    { "codeSuivi": "PD-000124", "statut": "reporte", "date": "2026-09-12" }
] }
```

Cent lignes maximum. Chaque ligne suit exactement les règles de l'endpoint unitaire.

```jsonc
{
  "totalTraite": 1,
  "totalRefuse": 1,
  "resultats": [
    { "issue": "applique", "codeSuivi": "PD-000123", "statut": "livre" },
    { "issue": "refuse", "codeSuivi": "PD-000124", "code": "colis_clos",
      "message": "Ce colis est clos (« livre ») : son statut ne peut plus être modifié" }
  ]
}
```

**Réponse toujours 200, même si tout est refusé.** Le lot a bien été traité, c'est son contenu qui
porte le détail. Un 4xx global dirait « je n'ai rien fait », ce qui serait faux dès qu'une ligne est
passée. Seules les erreurs qui empêchent de traiter le lot lui-même — clé, scope, corps illisible,
plafond dépassé — sortent en erreur HTTP.

**Le lot n'est volontairement pas atomique.** Trente colis rentrent d'une tournée, un seul porte un
code erroné : refuser les vingt-neuf autres obligerait le partenaire à trouver la ligne fautive
avant de pouvoir déclarer quoi que ce soit, donc à retarder de vraies livraisons pour une faute de
frappe.

Le chemin est `/statut/lot` et non un endpoint frère au pluriel : c'est la convention déjà posée
par `POST /v1/colis` et `POST /v1/colis/lot`, et deux routes qui ne différeraient que par un « s »
final se confondraient à la lecture d'un journal.

---

## 5. Les garde-fous

### 5.1 Le périmètre, première garantie — avant même l'authentification

Une clé authentifiée mais sans périmètre pourrait poser `livre` sur le colis d'un confrère. Et
**`livre` est une écriture d'argent** : elle ferme le colis, le rend facturable au marchand et fait
naître une dette COD du transporteur.

Le périmètre n'est **pas porté par une table de remise** mais dérivé du référentiel existant. **Le
seul critère est la VILLE DE DESTINATION du colis** :

```
Commande.ville  ──(normaliserVille)──►  Ville.nom  ──►  Hub.prestataireId
```

Un colis est déclarable par un transporteur dès lors que sa ville figure parmi celles que ses
agences desservent. Le rapprochement se fait sur le nom **normalisé** — casse et accents repliés —
parce que `Commande.ville` est du texte libre saisi par un marchand : sans ça, « Meknès » ne
retrouverait pas « meknes » et le colis serait refusé à un transporteur qui le dessert.

**Un seul code de refus pour « inconnu » et « hors de vos villes »** : `colis_introuvable`, 404.
Distinguer les deux dirait à qui sonde quels codes de suivi existent chez nous — même raisonnement
que le message unique d'échec de clé.

#### Ce que ce critère a remplacé, et ce qu'il coûte

Le critère précédent était « le colis est physiquement dans une de ses agences »
(`Commande.hubActuelId → Hub.prestataireId`). Il a été **retiré** : il ne devenait vrai qu'au scan
de réception, alors que le transporteur a le colis en main bien avant et n'avait donc rien à
déclarer entre-temps.

Deux conséquences, assumées :

- **Le moment n'est plus borné.** Un colis destiné à sa zone est déclarable avant même de lui être
  remis, et le reste après son retour chez nous.
- **Une ville partagée est partagée.** Quand deux réseaux annoncent la même ville — `Aknoul`,
  `Bouhlou`, `Tahla`, `Taourirt` (§ `SOUS_TRAITANCE.md` §2.9) — **les deux** transporteurs peuvent
  déclarer le colis. `meilleurHub()` tranche le routage, pas le périmètre de cette API.

Seule une table de remise explicite refermerait les deux (§10).

### 5.2 Idempotence, et son ordre par rapport à la clôture

`deciderTransition()` applique deux règles, **dans cet ordre** :

1. **Même statut demandé que le statut actuel → `inchange`.** Une reprise après timeout est un cas
   normal ; renvoyer une erreur ferait croire à un échec, et empiler une seconde ligne d'historique
   ferait croire à une seconde tentative de livraison.
2. **Colis déjà terminal → refus `colis_clos` (409).** Un colis livré ne redevient pas « reporté »
   parce qu'un fichier est renvoyé deux fois, ou qu'un lot part d'un export périmé.

**L'ordre compte.** Si la clôture passait avant l'idempotence, un lot rejoué après une livraison
ferait remonter des 409 sur des colis parfaitement traités, et le partenaire chercherait une panne
inexistante.

**Et la garantie est portée par la base, pas par l'ordre des instructions.** La mise à jour est un
`updateMany` conditionné sur l'ancien statut — un verrou optimiste. Sans lui, deux appels
simultanés sur le même colis lisent le même état, décident tous deux « applique », et écrivent
**deux lignes d'historique** pour une seule transition : l'historique décrirait deux tentatives de
livraison là où il n'y en a eu qu'une. Le cas n'est pas théorique — un partenaire qui rejoue un lot
après un timeout envoie précisément des requêtes concurrentes sur les mêmes colis.

Quand le verrou refuse l'écriture, la décision est rejouée sur l'état réel plutôt que refusée en
bloc : si l'appel concurrent a fait exactement le même travail, la réponse juste est
`inchange`, pas une erreur. Sinon, `409 conflit_concurrent`.

### 5.3 La date, refusée plutôt que devinée

`new Date('12/09/2026')` vaut le **9 décembre** pour un partenaire qui écrivait le 12 septembre. La
date part dans `dateNouvelleLivraison`, donc dans la file de relance : l'erreur ne se verrait qu'au
moment où le colis ne serait pas retenté. Seul l'ISO 8601 est accepté.

### 5.4 Ce que l'écriture produit

| | |
|---|---|
| `Commande.statut` | la nouvelle valeur |
| `Commande.dateLivraison` | posée sur `livre` |
| `Commande.dateNouvelleLivraison` | posée sur `reporte` et `programme` |
| `HistoriqueStatutCommande` | une ligne, auteur = **compte de service du prestataire** |
| `CommentaireCommande` | la note, si elle est fournie |

L'historique affiche donc « Meta Livraison » là où il affiche ailleurs un nom de collègue.
`HistoriqueStatutCommande.utilisateurId` étant non nullable, c'est ce compte de service — rôle
`plateforme`, qui n'appartient à aucun espace et ne peut ouvrir de session nulle part — qui rend
l'écriture machine possible sans rendre la colonne nullable.

`hubId` reste nul sur cette ligne : la colonne ne se renseigne que sur les transitions posées à un
quai (scan de réception, bon d'envoi).

La note va dans un commentaire, **jamais dans `motifRetour`** : ce champ porte une valeur d'une
liste fermée (`MOTIFS_REPORT_LIVREUR`), et y verser du texte libre venu d'un tiers casserait les
écrans qui le lisent comme une valeur connue.

---

## 6. Le catalogue des statuts

Douze valeurs, dans [`lib/statuts.ts`](lib/statuts.ts). `libelle` et `terminal` sont **dérivés** de
`LABELS_STATUT_COMMANDE` et `STATUTS_TERMINAUX` : le contrat public ne peut pas se désaligner du
back-office.

| Valeur | Libellé | Date | Terminal |
|---|---|---|---|
| `livre` | Livré | | **oui** |
| `refuse` | Refusé | | |
| `annule` | Annulé | | **oui** |
| `hors_zone` | Hors-zone | | |
| `reporte` | Reporté | **requise** | |
| `programme` | Programmé | **requise** | |
| `injoignable` | Injoignable | | |
| `boite_vocale` | Boite Vocal | | |
| `deuxieme_appel_pas_reponse` | Deuxième Appel Pas Réponse | | |
| `troisieme_appel_pas_reponse` | Troisième Appel Pas Réponse | | |
| `numero_errone` | Numero_Erroné | | |
| `client_interesse` | Client intéressé | | |

### Correspondance avec le vocabulaire du marché

Les API livreur des plateformes COD marocaines exposent le même vocabulaire, en anglais. Un
intégrateur qui a déjà branché un confrère retrouve chacune de ses valeurs :

| Leur valeur | Chez nous |
|---|---|
| `DELIVERED` | `livre` |
| `POSTPONED` | `reporte` |
| `NOANSWER` — « personne n'a répondu » | `injoignable` (porte sur la **personne**) |
| `UNREACHABLE` — « lieu de livraison inaccessible » | `hors_zone` (porte sur l'**adresse**) |
| `CANCELLED` | `annule` |
| `REFUSE` | `refuse` |
| `DEUXIEME` | `deuxieme_appel_pas_reponse` |
| `TROIXIEME` *(faute de frappe d'origine)* | `troisieme_appel_pas_reponse` |
| `PROGRAMMED` | `programme` |
| `INTERESTED` | `client_interesse` |

### Ce qui est volontairement exclu

**Les statuts de notre logistique** — `nouveau_colis`, `attente_de_ramassage`, `ramasse`, `recu`,
`recu_au_hub`, `en_transit`, `expedie`, `mise_en_distribution`, `retourne`, `retourne_au_hub`,
`annule_par_vendeur`. Un tiers n'a aucun moyen de les observer ; les lui ouvrir reviendrait à le
laisser réécrire notre circuit interne depuis l'extérieur, sans qu'aucun de nos écrans ne puisse le
contredire.

**`pas_de_reponse_sms`**, alors qu'il est le voisin immédiat de `boite_vocale`. Il ne décrit pas un
constat de terrain mais l'échec d'une relance **par un canal que nous opérons**, qu'un sous-traitant
n'a aucun moyen de déclencher. Le lui ouvrir ferait affirmer qu'un SMS a été envoyé là où personne
n'en a envoyé, et fausserait la seule statistique qui dit si la relance par SMS sert à quelque
chose. C'est aussi ce qui lève l'ambiguïté du `NOANSWER` ci-dessus.

> ⚠️ **Ce catalogue est un contrat public.** Y ajouter une valeur est indolore ; en **retirer** une
> casse l'intégration du partenaire en silence, le jour où il l'enverra — donc longtemps après le
> déploiement qui l'a cassée. Toute réduction passe par une nouvelle version de l'API.

---

## 7. Les codes d'erreur

| HTTP | `code` | Quand |
|---|---|---|
| 400 | `json_invalide` | corps illisible |
| 400 | `corps_invalide` | le corps, ou une ligne du lot, n'est pas un objet JSON |
| 400 | `champ_requis` | `codeSuivi` absent, ou `livraisons` vide |
| 400 | `statut_invalide` | valeur hors catalogue — **le message cite les valeurs acceptées** |
| 400 | `date_requise` | date absente, illisible ou hors ISO 8601 sur `reporte` / `programme` |
| 400 | `note_trop_longue` | plus de 150 caractères |
| 400 | `lot_trop_grand` | plus de 100 lignes |
| 401 | `cle_absente` / `cle_invalide` | message unique : ne dit pas lequel des deux |
| 401 | `cle_expiree` / `cle_revoquee` | distingués — ils ne concernent qu'un porteur déjà authentifié une fois |
| 403 | `scope_manquant` | clé valide, `livraisons:statut` absent |
| 403 | `plateforme_desactivee` | compte machine suspendu |
| 403 | `compte_sans_prestataire` | clé de canal de vente sur un endpoint de transporteur |
| 404 | `colis_introuvable` | code inconnu **ou** ville hors de celles qu'il dessert |
| 409 | `colis_clos` | colis déjà terminal |
| 409 | `conflit_concurrent` | le colis a changé de statut pendant le traitement — réessayer |
| 429 | `quota_depasse` | quota par clé ou plafond par IP |
| 500 | `erreur_interne` | rien de l'interne ne sort vers l'appelant |

Enveloppe : `{ "code": "...", "message": "..." }`. Le message est écrit pour un humain qui lit un
journal ; le **code** est ce sur quoi l'intégrateur branche son `if`. Reformuler un message ne doit
jamais casser son code.

---

## 8. Mise en service

```bash
npm run db:migrate     # crée plateformes_partenaires.prestataire_id
```

Puis, depuis `/admin/integrations` (permission `integrations:manage`, rôle `admin`) :

1. **Nouvelle plateforme** → renseigner le nom, et **choisir le transporteur** dans le sélecteur.
   C'est ce choix — et lui seul — qui fait de ce compte un compte de prestataire. Le compte de
   service naît dans la même transaction.
2. **Émettre une clé** → seuls les scopes de la nature du compte sont proposés, `livraisons:statut`
   est présélectionné. Commencer en `test`.
3. Transmettre la clé complète au partenaire. **Elle n'est affichée qu'une fois.**

Deux règles appliquées à l'émission, pas dans les handlers — une clé qui ne détient pas le scope ne
peut pas l'exercer, quoi qu'il arrive ensuite au code :

- un compte de transporteur ne peut recevoir aucun scope de vente ;
- un canal de vente ne peut recevoir `livraisons:statut`.

Le rattachement **ne se modifie pas après coup** : déplacer un compte d'un transporteur à l'autre
changerait le périmètre de clés déjà déployées chez un tiers.

### Entretien

```bash
npm run purger:journal              # à blanc : dit ce qui serait supprimé
npm run purger:journal -- 30 --oui  # exécute, fenêtre de 30 jours
```

`JournalAppelApi` grossit d'une ligne par appel reçu, toutes intégrations confondues. À 600 appels
par minute et par clé — le quota par défaut — la table dépasse le million de lignes en une journée
soutenue. Elle ne porte aucune donnée personnelle (le corps rejeté n'est pas conservé) : le
problème est de volume, et se règle par une fenêtre glissante.

**À blanc par défaut, et c'est délibéré** : une purge est irréversible, et la commande la plus
dangereuse du dépôt ne doit pas être celle qu'on tape le plus facilement. Rien n'est supprimé sans
`--oui`. À brancher sur une tâche planifiée une fois la fenêtre choisie.

---

## 9. Tests

### Niveau 1 — unitaires

```bash
npm test
```

Deux fichiers couvrent ce module, sans base de données :

- [`lib/__tests__/statuts-prestataire.test.ts`](lib/__tests__/statuts-prestataire.test.ts) —
  intégrité du catalogue. La garde principale vérifie qu'**aucun de nos statuts internes** n'est
  atteignable par un tiers, et un test dédié vérifie que `pas_de_reponse_sms` reste exclu. Un autre
  vérifie que les dix valeurs du vocabulaire du marché ont toutes un équivalent exposé.
- [`lib/__tests__/livraison-statut.test.ts`](lib/__tests__/livraison-statut.test.ts) — validation
  et transitions, dont les deux cas qui ne se voient qu'au rejeu : le même statut rejoué reste
  neutre, y compris sur un colis clos.

L'application en base relève du niveau 2 : elle écrit un colis, un historique et un commentaire.

### Niveau 2 — de bout en bout, au cURL

Avec une clé `test`, sur l'hôte d'API. **En local, viser `127.0.0.1:3000` et non
`api.localhost:3000`** : les deux sont acceptés par le proxy hors production, mais Windows ne
résout pas les sous-domaines `.localhost`, et `curl.exe` échoue en `ENOTFOUND`. Combiné à `-s`, qui
masque aussi les erreurs de curl, **la commande ne renvoie alors rien du tout** — ni corps, ni
message. Poser `HOST_API=127.0.0.1:3000` dans `.env`, puis redémarrer `npm run dev`.

```bash
CLE="mtk_test_<prefixe>_<secret>"
API="http://127.0.0.1:3000/api/v1"

# 1. Le branchement
curl -s -X POST "$API/auth" -H "Authorization: Bearer $CLE"
# → 200 { "valide": true, "plateforme": "meta-livraison", ... }

# 2. Le catalogue
curl -s "$API/statuts" -H "Authorization: Bearer $CLE"
# → 200 { "statuts": [ … 12 entrées … ] }

# 3. Un report
curl -s -X POST "$API/livraisons/statut" \
  -H "Authorization: Bearer $CLE" -H "Content-Type: application/json" \
  -d '{"codeSuivi":"PD-000123","statut":"reporte","date":"2026-09-12","note":"Client absent"}'
# → 200 { "issue": "applique", … }

# 4. Un lot
curl -s -X POST "$API/livraisons/statut/lot" \
  -H "Authorization: Bearer $CLE" -H "Content-Type: application/json" \
  -d '{"livraisons":[{"codeSuivi":"PD-000123","statut":"livre"},
                     {"codeSuivi":"PD-000999","statut":"livre"}]}'
# → 200 { "totalTraite": 1, "totalRefuse": 1, … }
```

### Niveau 2 bis — le simulateur, qui voit la base

```bash
npm run simuler:prestataire                            # trois colis choisis automatiquement
npm run simuler:prestataire -- PD-101686 PD-101687 PD-101688
npm run colis:confies                                  # quels colis sont déclarables, et par qui
npm run colis:confies PD-101686                        # pourquoi CE colis l'est, ou ne l'est pas
```

**28 vérifications**, pendant du simulateur Shipeh pour l'autre audience. Il crée ses propres clés
— `test`, `live`, révoquée, expirée, à quota bridé — les révoque toutes à la fin, et monte un
second compte machine temporaire sur un autre transporteur pour l'unique test que rien d'autre ne
peut faire.

Ce qu'il couvre et que Postman ne peut pas couvrir :

| | Pourquoi le JSON ne suffit pas |
|---|---|
| Le colis est passé à `livre`, `dateLivraison` posée | l'API renvoie l'issue, pas l'état stocké |
| **Une seule ligne d'historique malgré le rejeu** | l'idempotence pourrait répondre « inchange » tout en empilant des lignes |
| L'historique est signé du **compte de service** | c'est la seule chose qui rende la trace honnête |
| `hubId` reste nul sur cette ligne | la colonne ne se renseigne qu'aux transitions posées à un quai |
| La note est devenue un commentaire, pas un `motifRetour` | ce champ porte une liste fermée |
| `dateNouvelleLivraison` renseignée | c'est elle qui met le colis dans la file de relance |
| **Un vrai colis hors des villes d'un concurrent → 404** | demande deux comptes machine, impossible depuis une collection |
| **Cinq déclarations simultanées → une ligne** | teste le verrou optimiste sous charge réelle |
| Clé révoquée, expirée, quota dépassé | demandent des clés fabriquées pour l'occasion |

⚠️ **Il écrit pour de vrai** : le premier colis finit `livre`. Il ne crée ni ne supprime aucun
colis — il n'utilise que ceux qu'on lui donne.

Une nuance sur le test de concurrence : il exerce une course, il ne la démontre pas absente. Ce
qui la ferme structurellement, c'est le `where` sur l'ancien statut ; le test constate que la
garantie tient sous cinq requêtes parallèles.

### Niveau 3 — ce qu'il faut vérifier explicitement

| # | Scénario | Attendu |
|---|---|---|
| 3.1 | Appel sans en-tête d'autorisation | `401 cle_absente` |
| 3.2 | Clé d'un **canal de vente** sur `/livraisons/statut` | `403 compte_sans_prestataire` |
| 3.3 | Clé valide **sans** `livraisons:statut` | `403 scope_manquant` |
| 3.4 | Colis dont la ville **n'est pas desservie** par ce transporteur | `404 colis_introuvable`, jamais 403 |
| 3.5 | Code de suivi inexistant | `404 colis_introuvable` — **message identique à 3.4** |
| 3.6 | `codeSuivi` en minuscules | accepté, le colis est trouvé |
| 3.7 | `statut: "DELIVERED"` | `400 statut_invalide`, message citant les 12 valeurs |
| 3.8 | `statut: "recu_au_hub"` | `400 statut_invalide` — statut réel, mais hors catalogue |
| 3.9 | `reporte` sans `date` | `400 date_requise` |
| 3.10 | `reporte` avec `date: "12/09/2026"` | `400 date_requise` — **jamais interprété** |
| 3.11 | Même déclaration rejouée | `200 issue: "inchange"`, **aucune** nouvelle ligne d'historique |
| 3.12 | `reporte` sur un colis déjà `livre` | `409 colis_clos` |
| 3.13 | `livre` rejoué sur un colis `livre` | `200 issue: "inchange"` — l'idempotence prime |
| 3.14 | Lot de 101 lignes | `400 lot_trop_grand`, **aucune ligne traitée** |
| 3.15 | Lot mixte (une ligne fautive) | `200`, les autres passent, `totalRefuse: 1` |
| 3.16 | Ces routes sur l'hôte admin ou marchand | **404** |
| 3.17 | Après un `livre` | l'historique du colis affiche le nom du prestataire comme auteur |

Les points 3.4/3.5 et 3.12/3.13 sont les deux paires à ne jamais laisser dériver : la première est
une fuite d'information, la seconde une source de faux incidents chez le partenaire.

---

## 10. Hors périmètre et points ouverts

### Volontairement hors périmètre

- **La lecture** — aucun `GET /v1/livraisons` : le prestataire a déjà sa liste dans le fichier
  Excel. À rouvrir le jour où la remise passera dans l'outil.
- **Les étiquettes et les bons de livraison** — même raison.
- **Le COD** : aucun endpoint financier. Le transporteur encaisse, il nous doit l'argent, et rien
  dans ce module ne le déclare. C'est la question 9 de `SOUS_TRAITANCE.md`.
- **La documentation destinée aux prestataires.** Le présent document est écrit pour nous. La page
  qui leur sera envoyée est un sous-ensemble réduit, sur un lien difficile à deviner — voir §13.

### Points ouverts

1. **La trace de la remise.** Le périmètre repose sur le hub actuel du colis, ce qui est juste mais
   ne dit ni **quand** le colis a été confié ni à quel lot il appartenait. Un colis déplacé d'un hub
   à l'autre sort rétroactivement du périmètre de celui qui l'a livré. Une table de remise,
   alimentée par l'import du fichier Excel, lèverait les deux limites.
2. **Les prestataires sans informatique.** Power Delivery, Sahario et Amir ne brancheront
   probablement jamais d'API. Pour eux, il faut un **import Excel de retour** : même fonction
   `lib/`, mêmes règles de transition, mais l'auteur de l'écriture est l'employé qui importe.
   C'est ce qui rendrait le chantier utile aux cinq prestataires et pas seulement à deux.
3. **Unifier avec le parcours livreur interne.**
   [`app/api/livreur/colis/[id]/statut/route.ts`](app/api/livreur/colis/%5Bid%5D/statut/route.ts)
   fait la même chose pour nos propres livreurs, avec sa logique dans le handler. Les deux portes
   doivent finir sur la même fonction `lib/`, avant qu'une règle ne diverge entre elles.
### Points refermés

- **Il n'y a pas de bac à sable pour ce flux, et c'est assumé** — `livraisons:statut` est refusé à
  l'émission sur une clé `test` (`SCOPES_INTERDITS_EN_TEST`, `lib/plateforme-cles.ts`). Voir §11.
- **Purge du journal** — `npm run purger:journal` (§8). Reste à la planifier.
- **Isolation entre transporteurs** — couverte par le simulateur, §4 de son scénario.
- **Concurrence sur l'historique** — verrou optimiste posé (§5.2), couvert par le simulateur.
- **Clé révoquée, expirée, quota** — couverts par le simulateur, §5 de son scénario.

---

## 11. Pourquoi ce flux n'a pas de bac à sable

Pour une plateforme de **vente**, l'environnement `test` est une vraie garantie : une clé de test
crée des artefacts — marchands, colis — qui sont marqués, comptés et purgeables d'un geste
(`CompteMarchandExterne.environnement`, `purgerDonneesTest`).

Ici, l'API **ne crée rien** : elle **mute des colis réels**. Il n'y a donc rien à marquer et rien à
purger — on ne « dé-livre » pas un colis, et sa sortie des files de relance comme son entrée dans
le périmètre de sélection de la facturation sont irréversibles.

**Un bac à sable qui écrit en production n'en est pas un**, et le nommer ainsi est plus dangereux
que de ne pas en avoir. `livraisons:statut` est donc refusé sur une clé `test`, à l'émission — pas
dans le handler : une clé qui ne détient pas le scope ne peut pas l'exercer, quoi qu'il arrive
ensuite au code.

| Le partenaire peut toujours rôder en `test` | Il ne peut plus |
|---|---|
| tester sa clé, ses en-têtes, son parsing d'erreurs | obtenir un `200 applique` |
| lire le catalogue | |
| exercer les six refus : statut inconnu, date absente, date ambiguë, note trop longue, colis inconnu, lot trop grand | |

**La répétition du chemin de succès se fait sur de vrais colis d'un marchand de démonstration**, en
`live`, sous notre contrôle — c'est ce que fait `npm run simuler:prestataire`.

L'alternative écartée était un mode simulation : une clé `test` traverse tout le chemin mais la
transaction n'écrit rien, la réponse portant `"simulation": true`. Séduisant, mais il introduit un
**no-op silencieux** — une clé `test` oubliée en production ferait disparaître des statuts pendant
des jours sans qu'aucune erreur ne se déclenche. Un refus bruyant vaut mieux qu'une réussite
creuse.

Conséquences pratiques : la collection Postman utilise `cleLive`, et le simulateur travaille avec
une clé `live` qu'il révoque en fin d'exécution. Côté écran, le scope apparaît **grisé** et non
masqué quand l'environnement est `test` — il redevient cochable en passant la clé en `live`, et
c'est précisément le geste qu'on veut rendre visible.

---

## 12. Ce que le déploiement exige

Rien de ce qui suit n'est du développement : c'est la liste que doit avoir sous les yeux la
personne qui déploie.

### Les trois variables

| | |
|---|---|
| `HOST_API` | l'hôte de l'API machine, ex. `api.mathio.ma`. **Non renseignée, toute la surface `/api/v1/**` est injoignable — et c'est silencieux.** Une intégration s'ouvre en posant cette variable, pas en déployant du code |
| — | **redémarrer le serveur** après l'avoir posée : elle est lue au démarrage du processus |
| TLS | le certificat doit couvrir le sous-domaine d'API, souvent oublié quand il est émis pour le seul domaine métier |

### Le point critique : le reverse proxy

**Il doit répercuter `X-Forwarded-Host` sur `Host`.** S'il ne le fait pas, l'application voit le
même hôte pour toutes les requêtes, et les trois espaces se confondent — le cloisonnement décrit au
§3 ne tient plus. C'est le risque de déploiement le plus sérieux du module.

### La vérification qui tranche

```bash
AUDIT_BASE_URL=https://preprod.votre-domaine.ma \
HOST_API=api.votre-domaine.ma \
npm run audit:plateformes
```

L'audit annonce explicitement son `Host` à chaque requête et vérifie le cloisonnement **dans les
deux sens** : `/api/v1/**` doit répondre 404 sur les hôtes d'espace, et l'hôte d'API ne doit
atteindre rien d'autre. Si le reverse proxy ne répercute pas `Host`, tous les hôtes se confondent
pour l'application et **l'une des deux assertions tombe forcément**. Un audit vert prouve donc que
`Host` arrive intact — c'est exactement ce qu'aucune inspection de configuration ne garantit.

### Après la mise en service

- planifier `npm run purger:journal -- 30 --oui` (§8) ;
- n'émettre que des clés `live` pour les transporteurs — l'écran l'impose déjà (§11).

---

## 13. La documentation destinée aux prestataires

**Décidé** : une page publique au style landing page, sur un lien séparé et difficile à deviner,
envoyée au partenaire. **Les clés ne passent jamais par cette page** : elles sont transmises en
privé, une par partenaire.

### Un lien difficile à deviner n'est pas un contrôle d'accès

Acceptable ici — une documentation d'API n'est pas un secret, la clé l'est — mais la règle porte
alors sur le **contenu** : la page publique est un sous-ensemble réduit de ce document.

| Va dans la page publique | Reste interne |
|---|---|
| les 4 endpoints, en-têtes, corps, réponses | la carte des fichiers |
| le catalogue des 12 statuts et sa correspondance | la liste des statuts internes exclus |
| les codes d'erreur et ce qu'ils veulent dire | le mécanisme exact du périmètre et la liste de ses villes |
| les jeux de données d'essai | les arbitrages, les points ouverts, le déploiement |

Le mécanisme du périmètre en particulier : dire *comment* le 404 est calculé apprend à sonder. Il
suffit de dire *quand* il survient.

Deux balises pour que le lien reste difficile à atteindre :

- `<meta name="robots" content="noindex">` — si le lien fuit, la page n'est pas indexée ;
- `<meta name="referrer" content="no-referrer">` — sans elle, chaque ressource externe chargée par
  la page (une police, par exemple) reçoit l'URL complète, jeton compris, dans l'en-tête `Referer`.

### Où l'héberger

Le `matcher` de `proxy.ts` exclut les images, polices, `.txt` et `.xml`, **pas le `.html`**. D'après
la lecture du proxy — non vérifié par une requête —, un fichier `.html` placé dans `public/` passerait
par lui et serait servi sur les hôtes admin, marchand et terrain (étape « pages publiques »), mais
répondrait 404 sur l'hôte d'API.

1. **Hors application** (page statique hébergée ailleurs) — aucun impact sur le proxy. Recommandé.
2. **`public/<jeton>/index.html`** — fonctionne sans toucher au proxy, joignable sur les trois hôtes
   d'espace. Le jeton est versionné dans git : le changer demande un commit.
3. **Une exception de chemin dans le proxy** — à écarter : c'est le raisonnement par exception que
   le cloisonnement d'hôte a été écrit pour éviter.
