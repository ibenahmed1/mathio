# Numéro de série, QR code et code-barres — documentation technique

Ce document liste **tous les fichiers** qui implémentent la génération du
numéro de série des colis, sa transformation en QR code et en code-barres, et
explique la logique de chacun.

## Fichiers concernés

| Fichier | Rôle |
|---|---|
| [`lib/parcel-serial.ts`](lib/parcel-serial.ts) | Moteur générique : génère/décode le numéro de série, calcule/vérifie le checksum HMAC. Aucune dépendance à Prisma ni à React — pur, testable en isolation. |
| [`lib/parcel-label.ts`](lib/parcel-label.ts) | Pont entre `parcel-serial.ts` et une vraie `Commande` (Prisma) : extrait l'ID depuis `codeSuivi`, génère le SVG du QR code et du code-barres. |
| [`lib/__tests__/parcel-serial.test.ts`](lib/__tests__/parcel-serial.test.ts) | Tests unitaires du moteur (round-trip, non-ressemblance des ID consécutifs, unicité, anti-falsification). |
| [`app/bons-livraison/[id]/page.tsx`](app/bons-livraison/%5Bid%5D/page.tsx) | Consommateur : affiche/imprime les étiquettes colis et le bon de livraison A4, avec QR + code-barres injectés en SVG. |

---

## 1. `lib/parcel-serial.ts` — le moteur

### Format produit

```
[CODE_VILLE]-[CODE_MASQUE]-[DATE]        ex: JAD-RBIEC9-310726
```

- `CODE_VILLE` : 3 lettres (`JAD`, `CAS`, …).
- `CODE_MASQUE` : 6 caractères alphanumériques, obtenus en chiffrant l'ID
  auto-incrémenté du colis — jamais l'ID en clair.
- `DATE` : `JJMMAA` (31/07/2026 → `310726`).

### Pourquoi un chiffrement plutôt qu'un simple encodage

Un simple encodage (base36 direct de l'ID, par exemple) laisserait les ID 1,
2, 3 produire des codes qui se ressemblent (`000001`, `000002`, `000003`) et
serait trivialement devinable/énumérable par un tiers. Il faut donc une
**bijection qui ressemble à du bruit** : chaque ID doit tomber sur un code
totalement différent de celui de son voisin, sans jamais entrer en collision,
et sans avoir besoin d'interroger la base de données pour vérifier l'unicité.

### Comment : réseau de Feistel + cycle-walking

1. **Réseau de Feistel** (`feistelPermute`) : l'ID est traité comme un entier
   32 bits, coupé en deux moitiés de 16 bits (`left`, `right`). Sur 6 tours,
   chaque tour mélange une moitié avec le résultat d'une fonction de tour
   (`roundFunction`) appliquée à l'autre moitié, puis les inverse. C'est un
   chiffrement par bloc classique (le même principe que DES ou Skip32) :
   **bijectif** (aucune collision possible) et à fort effet d'avalanche (un
   ID qui change d'une unité produit une sortie totalement différente).
2. **Fonction de tour** (`roundFunction`) : `HMAC-SHA256(SALT_KEY, ronde ∥ moitié)`,
   tronqué à 16 bits. C'est ce qui rend le résultat imprévisible sans
   connaître `SALT_KEY` — sans la clé secrète, impossible de deviner à
   l'avance le code masqué d'un ID donné.
3. **Cycle-walking** (`maskId` / `unmaskId`) : le domaine utile est `36^6`
   (2 176 782 336), qui n'est pas une puissance de 2, alors que le bloc
   Feistel opère sur `2^32` valeurs. On rechiffre en boucle tant que le
   résultat tombe hors du domaine `[0, 36^6)`. Comme le chiffrement est une
   bijection sur les `2^32` valeurs, cette boucle retombe toujours dans le
   domaine (en moyenne ~2 itérations) : le coût reste **O(1)**, sans jamais
   toucher la base de données.
4. **Encodage final** : la valeur numérique obtenue est simplement convertie
   en base36 (`0-9A-Z`), complétée par des zéros à gauche sur 6 caractères.

### Fonctions exportées

```ts
generateParcelSerial(cityCode, parcelId, date?) → "JAD-RBIEC9-310726"
decodeParcelSerial(serial) → { cityCode, parcelId, date }   // opération inverse
resolveVilleCode(ville) → "JAD"                              // ville libre → code 3 lettres
```

(`generate_parcel_serial` / `validate_qr_payload` existent aussi en alias
snake_case, pour coller littéralement à la nomenclature demandée à
l'origine.)

### Checksum HMAC anti-falsification

Le contenu du QR code est `SERIAL.CHECKSUM` (ex: `JAD-RBIEC9-310726.7G`).

```ts
computeChecksum(serial) = HMAC-SHA256(SALT_KEY, serial) tronqué et ramené à
                           2 caractères base36 (1296 valeurs possibles)
```

**Différence importante avec un checksum classique (Luhn, etc.)** : un
checksum public peut être recalculé par n'importe qui, y compris un
faussaire — il ne détecte que les erreurs de saisie, pas la fraude
délibérée. Ici, comme `SALT_KEY` est secrète et ne quitte jamais le serveur,
un numéro de série inventé de toutes pièces ne peut pas être accompagné d'un
checksum valide : c'est ce qui rend le QR **infalsifiable** sans accès au
serveur.

```ts
buildQrPayload(serial) → "JAD-RBIEC9-310726.7G"      // ce qu'on encode dans le QR
validateQrPayload(qrString) → { valid, cityCode?, parcelId?, date?, reason? }
```

`validateQrPayload` vérifie le checksum en temps constant
(`crypto.timingSafeEqual`) pour éviter les attaques par mesure de temps, puis
décode l'ID d'origine si tout est correct.

### Configuration

`SALT_KEY` vient de la variable d'environnement `PARCEL_SERIAL_SALT_KEY`
(≥ 16 caractères). En production, son absence fait lever une erreur
explicite ; en développement, un repli non sécurisé est utilisé avec un
avertissement console.

---

## 2. `lib/parcel-label.ts` — pont vers les vraies données

Le moteur ci-dessus est générique (`cityCode` + `parcelId` + `date`). Ce
fichier fait le lien avec une vraie `Commande` de la base, **sans ajouter
aucune colonne** :

```ts
parcelIdFromCodeSuivi("PD-001042") → 1042
```

L'ID séquentiel existe déjà : c'est la partie numérique de `codeSuivi`
(généré par la séquence Postgres `commande_code_seq`, voir `lib/codes.ts`).
Tout est donc recalculé **à la volée** à chaque impression, à partir de
champs déjà stockés (`codeSuivi`, `ville`, `dateCreation`) :

```ts
buildParcelLabel({ codeSuivi, ville, date }) → {
  serial,      // "JAD-RBIEC9-310726"
  qrPayload,   // "JAD-RBIEC9-310726.7G"
  qrSvg,       // "<svg>...</svg>" — QR scannable, généré par le package `qrcode`
  barcodeSvg,  // "<svg>...</svg>" — Code128, généré par le package `bwip-js`
}

buildParcelLabels(commandes) → Map<codeSuivi, ParcelLabel>   // en parallèle, pour un bon entier
```

### Pourquoi deux codes différents (QR **et** code-barres) ?

| Code | Contenu encodé | Usage |
|---|---|---|
| **QR code** | `qrPayload` = numéro de série **signé** (HMAC) | Vérification anti-fraude : confirme que le colis n'a pas été relabellisé/inventé. |
| **Code-barres (Code128)** | `codeSuivi` (ex: `PD-001042`) | Scan rapide en entrepôt/livraison : c'est l'identifiant déjà utilisé partout ailleurs dans l'app pour la recherche et le rapprochement de colis. |

Le code-barres intègre son texte lisible directement sous les barres
(`includetext: true`), comme un vrai colis transporteur.

---

## 3. `lib/__tests__/parcel-serial.test.ts` — preuve par les tests

Lance avec `./node_modules/.bin/tsx --test lib/__tests__/parcel-serial.test.ts`.

- **Round-trip** : `decodeParcelSerial(generateParcelSerial(...))` retrouve
  l'ID d'origine, sur des ID limites (0, 1, 2, jusqu'à `36^6 - 1`).
- **Non-ressemblance des ID consécutifs** : les ID 1 à 5 produisent des codes
  masqués sans préfixe commun et avec au moins 4 caractères différents sur 6
  entre voisins (effet d'avalanche du réseau de Feistel).
- **Unicité empirique** : 20 000 ID consécutifs → 20 000 codes distincts.
- **Anti-falsification** : un checksum altéré, ou un numéro de série inventé
  sans connaître `SALT_KEY`, est rejeté par `validateQrPayload`.
- **Robustesse** : les entrées malformées ne lèvent jamais d'exception,
  elles renvoient `{ valid: false, reason }`.

---

## 4. `app/bons-livraison/[id]/page.tsx` — affichage & impression

Page serveur Next.js (composants async, aucun JS client requis pour le
rendu). Deux vues, choisies par `?format=` :

- **`VueRecapA4`** (`?format=a4`) : le bon de livraison complet du marchand,
  une ligne par colis, avec `codeSuivi` + numéro de série affiché en petit
  dessous.
- **`VueEtiquettes` / `Etiquette`** (`?format=etiquettes`) : une étiquette
  par colis (format 90×140 mm, une page d'impression par colis), avec bloc
  expéditeur/destinataire, badges (Ouvrir/Fragile/Échange), QR + numéro de
  série, code-barres, et montant COD mis en évidence.

Le SVG du QR et du code-barres est injecté via `dangerouslySetInnerHTML` —
sans risque ici car ce markup est **entièrement généré côté serveur par nos
soins** (jamais à partir d'une entrée utilisateur).

---

## Flux complet, de bout en bout

```
1. Création du colis
   → INSERT Commande, codeSuivi = "PD-001042" (séquence Postgres, lib/codes.ts)

2. Impression de l'étiquette / du BL (à la demande, jamais stocké)
   → parcelId  = 1042                          (extrait de codeSuivi)
   → cityCode  = resolveVilleCode(commande.ville)
   → date      = commande.dateCreation
   → serial    = generateParcelSerial(cityCode, parcelId, date)
               = "JAD-RBIEC9-310726"

3. Sécurisation pour le QR
   → qrPayload = buildQrPayload(serial) = "JAD-RBIEC9-310726.7G"
   → qrSvg     = QRCode.toString(qrPayload)      (package `qrcode`)
   → barcodeSvg= bwipjs.toSVG({ bcid: 'code128', text: codeSuivi })

4. Impression : les deux SVG sont injectés sur l'étiquette

5. Scan / vérification (au ramassage, à la livraison, en cas de litige)
   → validateQrPayload(texte lu dans le QR)
   → vérifie le HMAC (rejette toute falsification)
   → décode parcelId → retrouve la Commande via codeSuivi = "PD-001042"
```

Aucune étape ne fait de `SELECT COUNT(*)` ni de vérification d'unicité en
base : l'unicité est structurellement garantie par la bijection du
chiffrement Feistel sur l'ID déjà unique.
