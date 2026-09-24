# Sous-traitance — décisions appliquées et questions ouvertes

Ce document accompagne le module de sous-traitance (`/admin/hubs`, modèles `Prestataire`,
`Hub.prestataireId`, `TarifPrestataireVille`). Il existe pour une raison précise : **le référentiel
a été chargé depuis des fichiers incomplets ou ambigus, et il a fallu interpréter.** Chaque
interprétation est listée ici, avec ce qu'elle vaut et ce qui l'invalidera.

Il ne décrit pas le modèle de données — ça, c'est dans `prisma/schema.prisma`, abondamment
commenté. Il décrit ce qui a été *décidé* faute de réponse.

---

## 1. Ce qui est en base

**6 prestataires · 17 agences · 338 villes · 235 tarifs**, chargés par `npm run db:reseau`.

| Prestataire | Région | Agences | Villes | Tarifs | Tarif de retour |
|---|---|---|---|---|---|
| Power Delivery | Centre | 4 | 77 | 90 | aucun |
| Meta Livraison | Nord-Est | 9 | 103 | **0** | aucun |
| EST Livraison | Oriental | 1 | 63 | 63 | **0 DH partout** |
| Leader Colis | Souss | 1 | 51 | 51 | aucun |
| Amir Livraison | Nord-Ouest | 1 | 17 | 17 | aucun |
| Sahario Express | Sud | 1 | 14 | 14 | aucun |

Plus le `Hub Casablanca`, interne et central, avec ses 13 villes livrées par nos propres livreurs.

Leader Colis est le dernier arrivé du tableau et n'a pourtant rien chargé de neuf : ses 51 villes
étaient déjà en base, sous Sahario Express, qui ne les dessert pas (§2.11).

Sources : `ville Power.pdf`, `metalivraison.csv`, trois grilles reçues par message (Agadir pour
Leader Colis, Guelmim pour Sahario, Tanger pour Amir), `Code_Generated_Image.pdf` (EST). Les transcriptions vivent dans `scripts/import-prestataire-*.ts`
— **ce sont elles qui font foi**, pas la base : un environnement neuf est reconstruit à partir
d'elles.

---

## 2. Décisions appliquées sans validation métier

Classées par ce qu'elles coûtent si elles sont fausses.

### 2.1 Un nom de prestataire est inventé

**« Meta Livraison » n'apparaît dans aucun document.** Le fichier reçu s'appelle
`metalivraison.csv` et ne nomme aucune société. Le nom en a été déduit.

**9 agences et 103 villes en dépendent.** Correction : un seul champ à changer, tout suit.

### 2.2 Orthographes rendues au document

Une première passe avait « corrigé » des noms mal orthographiés. C'est l'inverse de ce qu'on veut
d'une grille fournisseur : elle se recopie, elle ne se corrige pas — sinon l'écran ne montre plus
ce que le transporteur a annoncé. Rétabli :

| Document | Avait été enregistré | Nature |
|---|---|---|
| `sidi 3llal lbahraoui kamoni` | `Sidi Allal Lbahraoui Kamoni` | le **3** développé en **A** |
| `SEBA AYOUN` | `Sebaa Ayoun` | un **a** ajouté |
| `meknes` | `Meknès` | un **accent** ajouté |
| `ait mlloul` | `Ait Melloul` | orthographe corrigée |
| `l jadida` | `El Jadida` | nom « rétabli » |
| `TNIN CHTOUKA - EL JADIDA` | `Tnin Chtouka` | suffixe retiré |
| `Sidi moussa - Marrakech` | `Sidi Moussa (Marrakech)` | reformaté |
| `Taza Ville`, `Guercif Ville`, `Nador Ville`… | `Taza`, `Guercif`, `Nador`… | alignés sur un autre réseau |

Le cas `sidi 3llal` est le plus révélateur : le **3** de l'alphabet de discussion (ع) avait été
développé sur ce seul nom, alors qu'il est conservé partout ailleurs — `marzou9a`, `sabt bou9lal`,
`lma3ziz`, `jm3at hodran`, `hjar ma3dan`, `ait ya3zem`, `lhaj 9adour`, `sidi 3edi`. Une convention
appliquée à un nom sur neuf n'en est pas une.

**La casse aussi est rendue au document.** Les noms s'affichent désormais comme les fichiers les
écrivent — `TIT MELIL`, `l jadida`, `khlalfa`, `SEBA AYOUN`, `sidi 3llal lbahraoui kamoni` — et non
en capitales initiales. L'audit sort 0 écart, graphie comprise.

Le rapprochement se fait sur le nom NORMALISÉ (casse et accents repliés, cf. `normaliserVille`) et
non via le `mode: 'insensitive'` de PostgreSQL, qui ignore la casse mais **pas les accents** :
chercher `Sale` n'y retrouvait pas `Salé`, et l'import créait un doublon — six d'un coup sur la
seule Agence Rabat. `resoudreVilleImport` (`lib/prestataires.ts`) rapproche donc en mémoire, et
**renomme** la ligne existante au lieu d'en créer une seconde. C'est ce qui rend les imports
auto-réparateurs : rejouer `npm run db:reseau` réaligne toujours la base sur les scripts, quel que
soit son état de départ.

### 2.3 Trois villes retirées : c'étaient des titres

Les messages Sahario écrivent `. Taroudant :`, `. Tiznit :` et `. Oulad teima :` — un point devant,
deux points derrière — suivis de leurs localités. Ce sont des **repères de lecture**. Ils avaient
été créés comme villes livrables à 23 DH, donc trois destinations que le fournisseur n'a jamais
annoncées. Retirés. L'Agence Agadir passe de 54 à **51 villes**, ce que dit le message.

⚠️ **À confirmer** : si Leader Colis livre réellement ces trois chefs-lieux, il faut les rajouter.
Ces messages ont longtemps été attribués à Sahario Express (cf. §2.11).

### 2.4 Une seule agence pour EST Livraison

Sa grille couvre **huit provinces** — Oujda, Berkane, Nador, Driouch, Al Hoceima, Taourirt/Guercif,
Taza, Jerada/Figuig — mais ne mentionne qu'un tarif préférentiel, celui d'Oujda. Un seul hub,
`Agence Oujda`, a donc été créé : en faire huit aurait inventé des quais que le document ne
mentionne pas.

### 2.5 Les secteurs Meta ont été éclatés en villes

Le tableur groupe les localités par ligne : `Rafsay /wrtzag / hajriya/sahla botahr/ mazraoua` est
**une** cellule. Elle est devenue **cinq** villes. Motif : `Commande.ville` est du texte libre
rapproché par normalisation — un secteur composé n'aurait jamais été reconnu à l'arrivée d'un
colis.

### 2.6 Deux lignes de fichier ne sont pas restituables

`ouargui` figure deux fois dans le bloc Marrakech de Power Delivery, `kantra asqar` deux fois dans
Taounate chez Meta. Même agence, même nom, même prix : la base ne peut pas les distinguer
(`@@unique([hubId, nom])`), et l'écran afficherait deux puces jumelles qu'aucune action ne saurait
viser séparément. **341 lignes en base pour 343 dans les fichiers** — c'est le seul écart.

### 2.7 Villes homonymes gardées distinctes

`Sidi Ifni` (Guelmim, 25 DH) et `Sidi Fini` (Agadir, 23 DH), `Mirleft` (25) et `Merleft` (23) : les
deux listes ont été conservées telles quelles, sur décision explicite. **Conséquence** : un colis
part chez Guelmim ou chez Agadir selon l'orthographe saisie par le marchand — et, depuis la
correction d'attribution du §2.11, ce n'est plus seulement une affaire d'agence mais de
**prestataire** : Guelmim est chez Sahario Express, Agadir chez Leader Colis. Une lettre décide
donc du transporteur, du prix d'achat et de la marge.

Idem chez Power Delivery, où le même fichier écrit deux fois la même ville : `ait aourir` /
`Aït ourir`, `tamelelt` / `Tamallalt`, `TEMSENA` / `Tamssna`. Les six lignes existent.

### 2.8 Le PDF fait foi contre le CSV

Le `ville Power.csv` a perdu les accents à l'export (`El Kela des Sraghna`, `At ourir`) là où le PDF
les porte. La base suit le **PDF**, sur décision.

### 2.9 Quatre villes appartiennent à deux réseaux

`Aknoul`, `Bouhlou`, `Tahla` et `Taourirt` sont annoncées par Meta Livraison **et** par EST
Livraison. Le modèle l'accepte — chaque agence tient sa propre liste — mais `Commande.ville` étant
du texte libre, le routage doit en désigner **un**.

`getVilleHubIndex()` (`lib/hub-envoi.ts`) applique une règle **déterministe et documentée**, faute
d'arbitrage commercial en base : hub interne d'abord, central en priorité, puis ordre alphabétique
du nom de hub. Ces quatre villes partent donc chez **EST Livraison**. `villesPartagees()` liste les
cas où la règle a dû trancher.

### 2.10 Les villes d'implantation des agences — décision du 9 septembre 2026

**Le constat.** Les tableurs nomment l'agence par sa ville d'implantation, mais ne remettent jamais
cette ville dans sa propre liste de destinations. Cinq agences sur dix-sept étaient dans ce cas :

| Agence | Villes desservies | Sa ville d'implantation |
|---|---|---|
| Agence Oujda (EST) | 63 | `Oujda` absente |
| Agence Taounate (Meta) | 35 | `Taounate` absente |
| Agence El Jadida (Power) | 11 | `El Jadida` absente |
| Agence Fès (Meta) | 2 | `Fès` absente |
| Agence Boulmane (Meta) | 2 | `Boulmane` absente |

Agence Oujda desservait 63 villes de l'Oriental sans pouvoir recevoir un colis pour Oujda. Un tel
colis ne se rattachait à aucun hub, n'était éligible à aucun bon d'envoi, et rien à l'écran ne
disait pourquoi.

**La décision.** Ces cinq villes ont été créées, chacune sous son agence, par
`scripts/ajouter-villes-agences.ts` — désormais exécuté en fin de `npm run db:reseau`.

Cela renverse la position tenue jusqu'ici, qui était de **ne pas** les créer faute d'accord et de
prix. L'argument d'origine reste vrai et n'est pas levé : nous déclarons livrer ces villes sans que
les transporteurs l'aient confirmé.

**Ce que la décision ne règle pas.** Aucun tarif n'a été chargé : le coût de ces cinq villes reste
`null`, donc « inconnu » et signalé comme tel à la facturation
(`Facture.nbLignesCoutInconnu`) — jamais `0`, qui dirait « gratuit ». La question 3 du §3 ci-dessous
reste donc entière, et elle porte maintenant sur cinq villes et non deux.

**Pourquoi un script à part des imports.** `scripts/import-prestataire-*.ts` transcrivent les
fichiers sources à la lettre, et `scripts/auditer-conformite-sources.ts` le vérifie. Y glisser une
ville absente du CSV falsifierait la transcription : la décision est donc tenue dans son propre
script, où elle reste visible et réversible.

### 2.11 L'Agence Agadir était attribuée au mauvais prestataire — corrigé le 23 septembre 2026

**Le constat.** Les 51 villes du Souss rattachées à l'`Agence Agadir` avaient été importées sous
**Sahario Express**, dans le même fichier que l'`Agence Guelmim`. Elles sont servies par **Leader
Colis**. Sahario ne dessert que Guelmim et ses 14 villes sahariennes.

**Pourquoi ce n'était pas cosmétique.** Le coût d'un colis est celui du prestataire qui **exploite
le hub de sa ville** (`getCoutsSousTraitance`, `lib/prestataires.ts`), et non le moins cher de la
grille. Ces 51 villes entraient donc dans la marge comme de l'achat Sahario, sur des colis qui
partaient en réalité chez Leader Colis.

**Ce qui a été fait.**

| | |
|---|---|
| `scripts/import-prestataire-leader-colis.ts` | la transcription du bloc Agadir, déplacée telle quelle — graphies, zones 15/20/23 DH et en-têtes de groupe compris |
| `scripts/import-prestataire-sahario-express.ts` | n'a plus que l'Agence Guelmim |
| `scripts/transferer-agadir-leader-colis.ts` | **à passer une fois** sur toute base déjà chargée |

**Pourquoi un script de transfert plutôt qu'une étape de `db:reseau`.** `resoudreHubImport` refuse
de reprendre un quai qui appartient à un autre prestataire, et `detecterBlocages()` arrête le
chargement avant sa première écriture pour la même raison : déplacer une agence emporte ses villes,
ses tarifs et le coût de ses colis. Les deux garde-fous ont été **laissés intacts**. Conséquence
assumée : sur une base chargée avant le 23 septembre 2026, `npm run db:reseau` **refuse de tourner**
tant que le transfert n'a pas été passé, et le message nomme le conflit.

**Ce que le transfert déplace.** Le hub n'est ni supprimé ni recréé — seul son `prestataireId`
change, son `id` ne bouge pas, donc `Utilisateur.hubId`, `Commande.hubActuelId`, les bons et
`HistoriqueStatutCommande.hubId` restent valides. Les villes suivent le hub. Les 51 lignes de
`TarifPrestataireVille`, elles, sont recopiées chez Leader Colis puis **supprimées chez Sahario** :
indexées sur (prestataire, ville), elles ne suivent pas le hub, et les laisser afficherait une
grille Sahario de 65 villes dont 51 qu'il ne dessert pas — une offre inventée, sur laquelle
quelqu'un finirait par arbitrer.

**Ce qu'il ne répare pas.** Les factures déjà émises gardent leur coût : `LigneFacture.coutLivraison`
est figé à l'émission, et le réécrire changerait des marges déjà arrêtées. Les colis livrés sous
l'ancienne attribution restent donc comptés comme du Sahario. C'est le seul résidu de l'erreur.

⚠️ **À confirmer** (§3, question 29) : les messages portant la grille d'Agadir avaient été classés
« Sahario » à la réception. L'attribution à Leader Colis vient du donneur d'ordre, pas d'un en-tête
du document. Si Sahario nous a transmis la grille **pour le compte de** Leader Colis, c'est une
relation commerciale à écrire, et elle peut changer qui nous facture.

### 2.12 Choix de modèle

- **Le mode de livraison se décide par ville, via son hub.** Un `Hub` sans `prestataireId` est
  interne (nos livreurs) ; avec, c'est une agence. Basculer une ville revient à la déplacer d'un
  hub à l'autre — aucune migration.
- **`Ville.nom` est unique par hub**, plus globalement (migration `ville_unique_par_hub`). Sans ça,
  le second réseau chargé se voyait refuser les villes du premier, en silence.
- **Un coût inconnu vaut `null`, jamais `0`.** Sauf chez EST, où **0 est une valeur** : la grille
  annonce le retour gratuit. « Gratuit » et « on ne sait pas » ne se confondent pas.
- **Les 13 villes de Casablanca sont annoncées DEUX FOIS** — par `Hub Casablanca`, interne, et par
  `Agence Casablanca`, rattachée à Power Delivery. Ce n'est pas un doublon accidentel :
  - le **routage ne bouge pas** — `meilleurHub()` fait primer l'interne, nos livreurs continuent de
    desservir la zone, et les tarifs Power restent une **comparaison**, pas un coût ;
  - mais Power **peut déclarer le statut** de ces colis par l'API partenaires, son périmètre étant
    la ville de destination (§ `API_SUIVI_PRESTATAIRES.md` §5.1).

  C'est le régime déjà appliqué aux quatre villes revendiquées par deux réseaux (§2.9) : `Ville`
  étant unique par `(hub, nom)`, les deux lignes cohabitent et `villesPartagees()` expose
  l'arbitrage sur `/admin/hubs`. Conséquence assumée : Power porte deux tarifs identiques par
  ville, et le second n'est jamais lu tant que le routage reste interne.

  ⚠️ **Le déplacer** — retirer ces villes du hub interne — basculerait tout Casablanca en
  sous-traitance : les 15 et 20 DH deviendraient une charge réelle et la marge changerait d'autant.
  C'est une autre décision, qui n'a pas été prise.
- **Les programmes hebdomadaires (Meta) et les délais (EST) ne sont pas stockés** — le modèle n'a
  pas de calendrier de desserte. Ils sont transcrits dans les scripts pour ne pas être perdus.
- **Marge** : brouillons de facture exclus (montants encore modifiables) et frais annexes exclus
  (portés par la facture, pas par un colis). La marge est donc légèrement **sous-estimée** — sauf
  quand un coût est inconnu, où elle est **surestimée** et signalée comme telle.

### 2.13 Un bon d'envoi peut viser un transporteur, sans passer par le référentiel — 23 septembre 2026

Jusqu'ici, confier des colis à un prestataire n'était possible **qu'indirectement** : on créait un
bon d'envoi vers une de ses agences, et la liste des colis proposés était imposée par le routage
ville → hub. L'opérateur ne choisissait donc jamais le transporteur, il choisissait un quai.

Deux conséquences, mesurées sur la base du 23 septembre 2026 :

- les **13 villes de Casablanca** (§2.12) routent vers le hub interne, donc les colis de Casa ne
  pouvaient **pas** être confiés à un sous-traitant — précisément le cas qu'on voulait tester ;
- un colis dont la ville était couverte par deux réseaux partait chez celui que `meilleurHub()`
  désignait, sans recours.

**`BonEnvoi` porte désormais deux destinations exclusives** — `hubDestinationId` (transit interne,
inchangé) ou `prestataireId` (remise sous-traitée) — l'exclusivité étant tenue par un `CHECK` en
base, migration `bon_envoi_transporteur`. Le second mode ignore complètement la ville : c'est
l'opérateur qui décide.

**Aucun contrôle de couverture n'y est appliqué, et c'est délibéré.** Tant que la répartition
« quelle région pour quel prestataire » n'est pas arrêtée (§3, questions bloquantes), un contrôle
ne protégerait rien : il masquerait des colis sans le dire. Une ville absente de la grille du
transporteur est **signalée à l'écran**, le bon se crée, et le coût d'achat reste `null` — jamais
`0`. Deux garde-fous seulement subsistent, parce qu'ils protègent les données et non le confort :
un colis déjà pris dans un bon, et un colis à statut terminal (`livre`, `retourne`, `annule`,
`annule_par_vendeur`).

**Ce que « Marquer comme reçu » veut dire sur un tel bon** : le transporteur a pris les colis en
charge. Le bon passe `recu`, mais les colis **restent `en_transit`** — les basculer à `recu_au_hub`
dirait qu'ils sont arrivés sur un quai à nous, ce qui serait faux.

⚠️ **À revoir quand la carte des villes sera figée.** Ce mode est un outil de structuration. Une
fois la répartition validée et les tarifs saisis, la question se posera de réintroduire un
avertissement bloquant — ou pas.

---

## 3. Questions à poser au métier

### Bloquant — sans ces réponses, la marge est fausse

1. Quel est le prix de livraison des **103 villes de Meta Livraison** ? Un prix unique suffit s'il
   n'y a pas de zones.
2. Combien coûte un colis **retourné** chez Power Delivery, Meta, Sahario et Amir ? Seul EST
   l'annonce (0 DH).
3. **À quel prix livrons-nous les cinq villes d'implantation d'agence** — Oujda, Taounate,
   El Jadida, Fès, Boulmane ? Elles sont désormais déclarées livrables (§2.10) mais leur coût est
   `null` : chaque colis qui y part fausse la marge tant que les transporteurs n'ont pas donné
   leur prix — et n'ont pas confirmé qu'ils les livrent.
4. Comment s'appelle **exactement** le transporteur du Nord-Est ? Le fichier ne le nomme pas.
5. EST Livraison a-t-il un seul dépôt à Oujda, ou aussi à Nador, Al Hoceima, Driouch, Figuig ?

### Bloquant — le circuit du colis n'existe pas dans l'outil

6. Le transporteur vient chercher les colis, ou on les dépose chez lui ?
7. Qu'est-ce qui est signé ou scanné à la remise ?
8. Qui nous dit qu'un colis est livré ou refusé, sous quelle forme, et sous quel délai ?
9. Le transporteur encaisse-t-il le COD ? Sous combien de jours le reverse-t-il ?
10. Un colis refusé revient chez nous ou reste chez lui ? Qui paie ce retour ?
11. Il facture au colis ou au mois ? Qui contrôle sa facture avant paiement ?

### Arbitrage — villes ambiguës

12. `Sidi Ifni` (25 DH) et `Sidi Fini` (23 DH) : même ville ?
13. `Mirleft` (25 DH) et `Merleft` (23 DH) : même ville ? Si oui, qui la livre ?
14. Chez Power : `ait aourir`/`Aït ourir`, `tamelelt`/`Tamallalt`, `TEMSENA`/`Tamssna` — une ville
    chacune, ou deux ?
15. `Mzouda` et `Mzoudia` : deux communes, ou une faute de frappe ?
16. `ouargui` (×2) et `kantra asqar` (×2) : erreur de saisie, ou deux endroits distincts ?
17. **Leader Colis livre-t-il Taroudant, Tiznit et Oulad Teima ?** (retirées, cf. § 2.3)

### Arbitrage — villes revendiquées par deux réseaux

18. `Aknoul`, `Bouhlou`, `Tahla`, `Taourirt` : Meta ou EST ?
19. Règle générale quand deux transporteurs couvrent une ville : qui décide, sur quel critère —
    prix, délai, engagement de volume ?

### Arbitrage — délais et jours

20. Le programme hebdomadaire de Meta est-il contractuel ou indicatif ?
21. Que veut dire `kolnhar machi fnharha` en délai ? (Ouad Amlil, Outat El Haj, Guigo, Ain Sbiit)
22. Chez EST : `3× / semaine`, `J+2`, `Mer et Sam` — que promet-on au client final ?
23. Un colis arrivé un jour non desservi attend, ou repart ?

### Arbitrage — facturation

24. Le prix facturé au marchand est-il calculé depuis le coût du transporteur (marge fixe,
    pourcentage), ou négocié séparément ?
25. Le marchand doit-il voir le nom du transporteur qui livre son colis ?

### Confort

26. Casablanca reste livrée en interne — définitif ? D'autres zones à reprendre ?
27. Les noms de villes s'affichent **exactement** comme dans les fichiers (`l jadida`, `TIT MELIL`,
    `sidi 3llal lbahraoui kamoni`). C'est la règle retenue. Faut-il un libellé « propre » distinct
    pour ce que voit le marchand, la graphie du fichier restant celle du back-office ?
28. Les hubs internes `Hub Marrakech` et `Hub Tanger` sont vides depuis que leurs villes sont
    passées aux agences. On les supprime ?
29. **Qui nous a transmis la grille d'Agadir, et qui nous facture ?** Ces messages avaient été
    classés « Sahario » à la réception ; l'Agence Agadir est désormais chez Leader Colis (§2.11).
    Sahario a-t-il relayé la grille d'un exécutant, ou n'a-t-il jamais eu de rôle sur le Souss ?

---

## 4. Vérifier et déployer

```bash
npm run db:migrate                              # tables
npm run db:seed                                 # compte admin, et rien d'autre
npx tsx scripts/verifier-avant-reseau.ts        # ← LECTURE SEULE : ce que l'import ferait
npm run db:reseau                               # le référentiel — idempotent
```

`db:reseau` n'est **pas** appelé par `db:deploy` : sur une base fraîchement migrée, sans lui, il n'y
a ni prestataire, ni hub, ni ville, ni tarif. Il enchaîne un script d'alignement (sans effet sur une
base neuve) puis les six imports.

**Sur un environnement qui contient déjà des hubs**, lancer d'abord `verifier-avant-reseau.ts` : il
n'écrit rien et dit, hub par hub, ce qui sera créé, réutilisé, ou laissé de côté. Il signale en
particulier les hubs qui portent le même nom **à la casse près** — `hub casablanca` saisi à la main
contre `Hub Casablanca` attendu par l'import. `Hub.nom` est unique au sens de PostgreSQL, donc les
deux graphies y cohabitent sans erreur : un import qui ne les rapproche pas crée un second hub pour
la même ville, l'un recevant les villes et les tarifs, l'autre gardant les colis et les
utilisateurs déjà rattachés. `resoudreHubImport` compare donc sans tenir compte de la casse, et
réutilise le hub existant sans jamais réécrire son adresse ni son téléphone.

### Ce que l'import touche sur un hub existant

Exactement deux choses :

- **son nom**, aligné sur la graphie du script quand seule la casse diffère — `hub casablanca`
  saisi à la main devient `Hub Casablanca`. C'est un libellé : **aucune clé étrangère ne porte le
  nom d'un hub**, seulement son `id` ;
- les **villes** qu'il lui rattache, avec leurs tarifs et leur prestataire.

Tout le reste est laissé intact : ville-siège, adresse, téléphone, rattachement à un prestataire.
Le hub n'est **jamais supprimé** et son `id` ne bouge pas, si bien que tout ce qui pointe dessus
reste valide — `Utilisateur.hubId`, `Commande.hubActuelId`, les bons de distribution, d'envoi, de
paiement et de retour, `HistoriqueStatutCommande.hubId`.

Vérifié en rejouant le cas réel : un hub renommé `hub casablanca`, porteur de 3 utilisateurs, 8
colis et 3 bons de distribution, ressort de l'import avec le même `id`, les mêmes rattachements,
les mêmes coordonnées — et son nom corrigé.

Le drapeau `isCentral` n'est posé **que sur un hub que l'import vient de créer**. Sur un hub déjà en
service — qui porte des utilisateurs, des colis, des bons — le marquer central changerait le
comportement du système sur la seule foi d'un script : l'import s'en abstient et l'écrit en clair
dans son rapport, à cocher depuis `/admin/hubs`. Sans hub central, les colis de stock préparés
partent en `en_transit` au lieu de rester au quai (cf. `lib/hub-stock.ts`).

Deux outils de contrôle :

```bash
npx tsx scripts/auditer-conformite-sources.ts      # base ↔ seconde transcription des documents
npx tsx scripts/exporter-grilles-prestataires.ts   # un CSV par prestataire, à ouvrir près du fichier reçu
```

L'audit attrape les fautes de recopie : ville dans la mauvaise agence, tarif décalé, ligne sautée.
Il ne prouve **pas** que la transcription est fidèle au document — deux transcriptions de la même
main partagent leurs erreurs de lecture. Seul l'export le prouve, parce que celui qui le relit a
l'original sous les yeux.

`tsx` est en `devDependencies` : une installation `--omit=dev` empêche `db:seed` comme `db:reseau`
de tourner.
