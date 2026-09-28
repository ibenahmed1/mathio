# Intégration YouCan — flux ENTRANT

Même service que Shopify (`INTEGRATION_SHOPIFY.md`) pour les boutiques YouCan. Un marchand connecte
**sa** boutique depuis `/marchand/integrations`. Ensuite :

- chaque commande passée sur sa boutique arrive par webhook et devient un colis `nouveau_colis` ;
- le catalogue est importé dans ses **Marchandises**, à raison d'une marchandise par variante.

Les colis et marchandises importés portent un tag **YouCan** (`components/YoucanTag.tsx`), déduit du
lien en base (`CommandeYoucan`, `MarchandiseYoucan`).

Source : developer.youcan.shop (OAuth, Orders, entités Order, Customer et Address, REST Hooks), lue
le 2026-09-26. **Aucune vraie boutique n'a encore été branchée** : tout ce qui suit est conforme à
la doc et testé contre un faux serveur, pas contre YouCan.

## Ce qui change par rapport à Shopify

| | Shopify | YouCan |
|---|---|---|
| Saisie | domaine + jeton + clé secrète | **Client ID + Client Secret** de l'application YouCan du marchand |
| Connexion | directe après le test | après le test, **une** autorisation sur YouCan (redirection imposée par YouCan pour délivrer le jeton) |
| Identifiants | propres à chaque boutique | propres à chaque boutique aussi (décision du 2026-09-28 : même formulaire que Shopify) |
| Jeton | permanent | renouvelable ; celui obtenu en vrai expire en 2126 |
| Signature des webhooks | HMAC base64, clé de la boutique | HMAC **hex**, Client Secret de la boutique |
| Routage d'un webhook | en-tête `X-Shopify-Shop-Domain` | `data.store_id` du corps |
| Corps du webhook | commande complète | commande « abrégée » → **relue** par `GET /orders/{id}` |

## Parcours

1. **Saisie** : le marchand crée son application dans le Partner Dashboard YouCan (option
   « Embedded » à False), y déclare l'URL de retour que l'écran lui affiche, puis colle son Client ID
   et son Client Secret.
2. **Test** : `POST /api/integrations/youcan/tester`. On présente à YouCan un code volontairement
   faux. Avec de bons identifiants, YouCan répond `invalid_grant` ; avec de mauvais, `invalid_client`.
   Ce comportement a été vérifié contre le vrai YouCan le 2026-09-28. Rien n'est écrit.
3. **Connexion** : `POST /api/integrations/youcan/connecter`. On refait le test, puis on scelle
   l'aléa et les identifiants, **chiffrés**, dans un cookie httpOnly (`youcan_oauth_etat`, 30 min).
   L'écran reçoit l'URL `seller-area.youcan.shop/admin/oauth/authorize` avec les 7 scopes
   (`SCOPES_YOUCAN`) et y navigue. Rien n'est écrit en base.
4. **Retour** : `GET /api/integrations/youcan/callback`.
   - On vérifie que le retour fait suite à notre demande. **YouCan ne renvoie pas `state`**
     (constaté le 2026-09-26). Il signe en revanche son retour :
     `?timestamp&code&store&seller&locale&embedded&hmac`. Le `hmac` est un HMAC-SHA256 hex avec
     le Client Secret (lu dans le cookie), calculé sur la chaîne de requête sans `hmac`, dans
     l'ordre reçu.
     Ce calcul a été vérifié sur un vrai retour ; la doc n'en parle pas. On exige ce `hmac`, un
     `timestamp` de moins de 10 min, et le cookie posé à l'aller.
   - On échange le code contre des jetons, puis on lit `GET /me`, qui donne `store_id`, le nom et
     la devise.
   - On enregistre la boutique : Client ID, puis Client Secret et jetons **chiffrés**.
   - On s'abonne à `order.created` et `app.uninstalled`, puis on importe les produits.
   - On redirige vers l'écran avec `?youcan=connectee|erreur&message=…`.
5. **Réception** : `POST /api/v1/webhooks/youcan`, sur l'hôte `HOST_API` uniquement.
   - On retrouve la boutique par `store_id` (lu avant toute autre chose), puis on vérifie la
     signature avec **son** Client Secret.
   - On relit la commande avec `include=customer,variants,payment,shipping`.
   - On crée le colis.
6. **Déconnexion** : depuis l'écran (`DELETE`), les deux abonnements sont supprimés chez YouCan au
   mieux. Désinstaller l'application côté YouCan (`app.uninstalled`) marque aussi la boutique
   déconnectée.

Codes renvoyés à YouCan :

| Code | Cas | Effet chez YouCan |
|---|---|---|
| `401` | signature fausse | pas de nouvelle tentative |
| `410` | boutique inconnue ou déconnectée | l'abonnement est **désactivé** ; une reconnexion le réactive |
| `200` | tout ce qui a été lu, y compris un rejeu ou une commande ignorée | livraison terminée |
| `500` | panne chez nous, ou YouCan injoignable pendant la relecture | jusqu'à 5 nouvelles tentatives sur ~4 h |

## Ce qui est lu d'une commande

| Colis | Source YouCan |
|---|---|
| destinataire, téléphone, adresse | `shipping.address`, sinon `customer.address[]` (celle marquée `default` d'abord), sinon `payment.address`, sinon `customer` |
| ville | même ordre, rapprochée du référentiel par `lib/shopify-villes.ts` |
| `montantCod` | `total`, ou **0** si le paiement est `paid` / `refunded` (lu sur `payment.status_object.slug`, sinon `payment_status_new`) |
| `codeSuiviPartenaire` | `ref` (« 021 »), ou `youcan-<uuid>` si la référence est déjà prise |
| `produitDescription` / `quantite` | `variants[]`, avec nom du produit et valeurs de déclinaison (hors `default`) |
| `marchandiseId` | variante importée, si la commande n'a qu'un article |

Une commande annulée (`status_object.slug` = `canceled`) est **ignorée**. Une commande incomplète
crée quand même son colis ; la note indique ce qu'il faut compléter (même règle que Shopify).

Le poids n'est pas repris : l'unité de `variant.weight` n'est pas documentée.

## Décisions

Celles de Shopify (2026-09-26) s'appliquent telles quelles :

- une commande prépayée donne un COD à 0 ;
- les produits deviennent des `Marchandise`, jamais des `Produit` ;
- une devise autre que MAD est reprise sans conversion ;
- une boutique par marchand.

Choix propres à YouCan, pris sans consultation, à valider :

- **Colis créé dès `order.created`**, avant la confirmation téléphonique que font beaucoup de
  marchands YouCan. Même comportement que Shopify. Si les marchands confirment d'abord, il faudra
  plutôt écouter `order.updated` et filtrer sur `confirmation_status`.
- Scope `edit-orders` demandé dès maintenant, alors qu'il ne sert encore à rien. Il est prévu pour
  renvoyer l'expédition vers YouCan : l'ajouter plus tard ferait repasser chaque marchand par
  l'écran d'autorisation.

## Configuration

| Variable | Rôle |
|---|---|
| `YOUCAN_REDIRECT_URI` | facultative. Par défaut `https://<hôte marchand>/api/integrations/youcan/callback`. Doit être déclarée **à l'identique** dans l'application YouCan |
| `YOUCAN_WEBHOOK_BASE_URL` | même rôle que `SHOPIFY_WEBHOOK_BASE_URL` (HTTPS public, hôte = `HOST_API`) |
| `CLE_CHIFFREMENT_INTEGRATIONS` | partagée avec Shopify |
| `YOUCAN_API_BASE_URL` | tests uniquement (faux serveur) |

## Espace de démonstration

Le marchand **« Démo Intégrations »** (`demo.integrations@mathio.test`) porte les deux boutiques
réelles de test : Shopify `shopifi-store-basma` et YouCan `mathiotest`, avec leurs colis et
marchandises. Elles y ont été regroupées le 2026-09-28. Les scripts de simulation purgent leurs
propres comptes (`*.simulation@mathio.test`) et ne touchent pas celui-ci. Les autres marchands
partent de formulaires vides.

## Tester

- `npm test` : `youcan-commandes` (signature, lecture des commandes, permissions).
- `npm run simuler:youcan` : 30 contrôles contre un **faux YouCan** local, sans serveur de dev.
  Couvre la connexion OAuth, l'import, la réception, le rejeu, les livraisons simultanées, le COD
  à 0, l'annulation, les codes 401 et 410, le renouvellement du jeton, le rattrapage, la
  désinstallation et la déconnexion.
- **En vrai** : il faut un compte Partner, une boutique de développement, l'application créée avec
  l'URL de retour déclarée, et un tunnel (ngrok) pour les webhooks comme pour Shopify.

## Limites connues

- Jamais testé contre la vraie API. Points à surveiller au premier branchement :
  - la forme réelle de `shipping.address` ;
  - le paramètre `include` à plusieurs valeurs séparées par des virgules ;
  - la présence de `store_id` dans les webhooks ;
  - l'acceptation d'une URL de retour en `http` en local.
- Le jeton n'est renouvelé **qu'à l'usage** (webhook, écran, synchro). Une boutique restée
  inactive plus longtemps que la durée de vie du jeton de rafraîchissement (non documentée) devra
  être reconnectée. Une tâche planifiée réglerait ce cas.
- Les renouvellements simultanés sont fusionnés **au sein d'un processus**. Entre deux processus,
  celui qui perd relit la base, ce qui n'est pas testé.
- Seule la création de commande est suivie. Rien n'est renvoyé vers YouCan (suivi, expédition).
- Le tag n'est pas affiché dans la liste des colis du back-office. Le journal
  `webhooks_youcan_recus` n'est pas purgé.
