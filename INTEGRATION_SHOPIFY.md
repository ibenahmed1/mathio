# Intégration Shopify — flux ENTRANT

Un marchand connecte **sa** boutique Shopify depuis `/marchand/integrations`. Ensuite :

- chaque commande passée sur sa boutique arrive par webhook et devient un colis `nouveau_colis`
  dans son espace ;
- le catalogue de la boutique est importé dans ses **Marchandises** (le catalogue du formulaire
  colis), une marchandise par variante.

Les colis et marchandises importés portent un tag **Shopify** (`components/ShopifyTag.tsx`). Ce
tag se déduit de l'existence du lien en base : aucun champ saisi ne le porte.

À ne pas confondre avec `INTEGRATION_PLATEFORMES_PARTENAIRES.md` (Shipeh). Dans ce cas-là, une
plateforme nous appelle avec **nos** clés d'API. Ici, c'est la boutique du marchand qui nous
appelle, et c'est le marchand, pas un admin, qui branche l'intégration.

## Parcours

1. **Test** : `POST /api/integrations/shopify/tester`. On interroge la boutique avec le jeton et on
   vérifie les accès `read_orders` et `read_products`. Rien n'est écrit en base.
2. **Connexion** : `POST /api/integrations/shopify`. On refait le test, puis on enregistre la
   boutique avec le jeton et la clé secrète **chiffrés** (AES-256-GCM). On abonne ensuite le
   webhook `ORDERS_CREATE` et on importe les produits. Si l'une de ces deux étapes échoue, la
   connexion est quand même conservée : l'écran affiche l'erreur et propose « Réessayer » ou
   « Synchroniser les produits ».
3. **Réception** : `POST /api/v1/webhooks/shopify`, uniquement sur l'hôte `HOST_API`.
   - On retrouve la boutique par `X-Shopify-Shop-Domain`.
   - On vérifie `X-Shopify-Hmac-Sha256` avec la clé secrète **de cette boutique** : HMAC-SHA256
     du corps brut, en base64, comparé en temps constant.
   - On lit la commande et on crée le colis.
4. **Déconnexion** : `DELETE /api/integrations/shopify`. Le webhook est supprimé chez Shopify
   (au mieux), la ligne est conservée et marquée déconnectée, et les tags restent.

Codes renvoyés à Shopify : `401` pour une boutique inconnue ou déconnectée, ou une signature
fausse ; `200` pour tout ce qui a été lu, y compris un rejeu, une commande ignorée ou un corps
illisible ; `500` pour une panne chez nous, afin que Shopify réessaie.

## Ce qui est lu d'une commande

| Colis | Source Shopify |
|---|---|
| destinataire | `shipping_address`, à défaut `billing_address`, à défaut `customer` |
| téléphone | adresse de livraison → `phone` → client → facturation, normalisé en `06…` si possible |
| ville | rapprochée du référentiel par `lib/shopify-villes.ts` (voir ci-dessous) |
| `montantCod` | `total_outstanding` : le montant **restant dû**, donc 0 si payée en ligne |
| `codeSuiviPartenaire` | `name` (« #1001 »), ou `shopify-<id>` si la référence est déjà prise |
| `produitDescription` / `quantite` | lignes à expédier (`requires_shipping`) |
| `marchandiseId` | variante importée, si la commande n'a qu'un seul article |
| `poidsKg` | `total_weight` / 1000 |

Commandes **ignorées** (accusées par un 200, journalisées) : commande déjà annulée, ou sans aucun
article à expédier (cartes cadeaux…).

Une commande dont il **manque** le téléphone, l'adresse ou la ville crée quand même son colis. La
note du colis et le journal indiquent quoi compléter : mieux vaut un colis à corriger qu'une
commande perdue.

**Ville.** Trois étages de rapprochement :

1. clé normalisée (casse, accents, ponctuation) ;
2. alias : Casa, Marrakesh, Tangier, noms arabes… ;
3. une ou deux fautes de frappe tolérées, uniquement si un seul candidat correspond.

Quand la ville est reconnue, `ville` reçoit le **nom du référentiel**, parce que le routage vers
les hubs lit ce texte (`lib/hub-envoi.ts`). La saisie d'origine est conservée dans la note. Quand
elle n'est pas reconnue, le colis est créé avec `villeId` nul et la note le signale.

## Décisions (2026-09-26)

- **Commande prépayée** : un colis à COD 0 est créé, la commande n'est pas écartée. La
  modification d'un colis accepte 0 **seulement s'il valait déjà 0**
  (`app/api/commandes/[id]/route.ts`).
- **Produits** : importés en `Marchandise`, pas en `Produit` (inventaire). `qteStock` n'est jamais
  modifié. Une marchandise saisie à la main **sous le même nom** est rattachée plutôt que doublée.
- **Devise ≠ MAD** : le montant est repris **tel quel**, sans conversion, et la devise est
  indiquée dans la note du colis. Les prix des marchandises aussi. La boutique de test est en
  USD.
- **Une boutique par marchand**, et une boutique n'appartient qu'à un seul marchand : son domaine
  sert à router les webhooks.
- Auteur de l'historique initial : le titulaire du compte marchand.

## Configuration

| Variable | Rôle |
|---|---|
| `CLE_CHIFFREMENT_INTEGRATIONS` | 32 octets en base64. **La changer rend les secrets stockés illisibles** : les marchands devront reconnecter leur boutique |
| `SHOPIFY_WEBHOOK_BASE_URL` | URL publique **HTTPS**, sans chemin. Son hôte doit être `HOST_API` |
| `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_SECRET_KEY` | uniquement pour `npm run simuler:shopify`. L'application lit les identifiants saisis par le marchand, jamais ceux-ci |

Version de l'Admin API figée à `2026-07` (`VERSION_API_SHOPIFY`). Dans cette version, le webhook se
déclare avec `uri` : `callbackUrl` n'existe plus (vérifié par introspection le 2026-09-26).

## Tester

- `npm test` : `shopify-commandes`, `shopify-villes` et `chiffrement` (lecture, signature, domaine,
  villes, chiffrement).
- `npm run simuler:shopify`, avec le serveur de dev lancé :
  - connexion **réelle** à la boutique du `.env` et import des produits ;
  - puis 13 scénarios de webhooks signés : nominal, rejeu, triple livraison simultanée,
    signatures fausses, commande prépayée, USD, ville inconnue, commande annulée, cloisonnement
    des hôtes.

  Le script travaille sous un marchand dédié (`shopify.simulation@mathio.test`) et purge tout à
  la fin, ce qui libère la boutique.
- **Commandes réelles en local** : Shopify n'appelle qu'une URL HTTPS publique.
  1. Lancer `ngrok http 3000`.
  2. Dans `.env`, mettre `HOST_API=<hôte ngrok>` et
     `SHOPIFY_WEBHOOK_BASE_URL=https://<hôte ngrok>`.
  3. Relancer `npm run dev`.
  4. Sur l'écran Intégrations, cliquer « Réessayer ».
  5. Passer une commande test sur la boutique.

## Limites connues

- Seule la **création** de commande est suivie. Une modification ou une annulation ultérieure
  côté Shopify ne change pas le colis.
- Aucun retour vers Shopify (numéro de suivi, expédition), bien que l'application ait
  `write_fulfillments`.
- Catalogue synchronisé à la connexion et à la demande, pas par webhook produit.
- Le tag est affiché dans l'espace marchand (liste des colis, Marchandises), pas encore dans la
  liste des colis du back-office.
- La clé secrète ne peut pas être vérifiée à la connexion : Shopify ne l'utilise que pour signer.
  Si elle est fausse, le premier webhook est rejeté avec « signature invalide » dans le journal.
- Le journal `webhooks_shopify_recus` n'est pas purgé.
- Données client protégées : il n'est pas vérifié si Shopify masque le nom, le téléphone ou
  l'adresse pour ce type d'application. Si c'est le cas, les colis arrivent « à compléter ».
