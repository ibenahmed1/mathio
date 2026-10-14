# Recette Shipeh en production

**À l'attention du responsable du déploiement.** Après le déploiement, ce script crée en production
une boutique Shipeh de test. Elle contient trois produits de stock avec leurs photos et six colis.
Tout est déposé comme Shipeh le ferait. L'équipe peut ainsi suivre un vrai colis Shipeh de bout en
bout, avec la facture et le règlement du transporteur, sans attendre un vrai colis de Shipeh.

## 1. Avant de lancer le script

- Le code du commit qui ajoute `scripts/recette-shipeh-prod.ts` est déployé.
- Les migrations sont appliquées : `npx prisma migrate deploy`. Les deux migrations du 14/10 sont
  nécessaires : `20261014100820_fil_reponses_reclamations` et
  `20261014114230_frais_preparation_boutiques_plateforme`.
- La plateforme **Shipeh** existe et est active dans Admin → Intégrations, avec le code `shipeh`.
- Le référentiel des villes du 10/10 est en place. Le script vérifie les six villes utilisées.

## 2. Lancer le script

Depuis le dossier de l'application, sur le serveur qui a accès à la base de production :

```
npx tsx scripts/recette-shipeh-prod.ts                 # à blanc : vérifie tout, n'écrit rien
npx tsx scripts/recette-shipeh-prod.ts --oui           # crée le jeu de recette
```

- `--admin=email@domaine` : l'admin au nom duquel la réception du stock est enregistrée. Par défaut,
  le plus ancien admin actif qui a un email.
- `--lot=2`, `--lot=3`… : six nouveaux colis pour la même boutique, si l'équipe veut refaire un
  passage.

Le script peut être relancé sans risque : ce qui existe déjà est retrouvé et rien n'est créé en
double. Il s'arrête sans rien écrire si un compte de la production utilise déjà l'email ou le
téléphone de la boutique de recette. Sans cet arrêt, ce compte serait rattaché à Shipeh.

**À transmettre à l'équipe qui teste** : la fin du script affiche les six codes de suivi et le mot
de passe de la boutique. **Ce mot de passe ne s'affiche qu'une seule fois**, à la première
exécution.

## 3. Ce qui est créé

| | |
|---|---|
| Boutique | **Boutique Recette Shipeh**, active, liée à Shipeh. Connexion : `recette.shipeh@mathio.test` |
| Tarif | 30 DH de livraison partout, 3 DH de préparation par colis (tarif des boutiques Shipeh) |
| Produits | Sérum Recette (40), Crème Recette (40), T-shirt Recette en Noir / M (20) et Blanc / L (20), chacun avec sa photo, stock déjà reçu |
| Colis | Casablanca 150, Rabat 200, Marrakech 250, Tanger 300, Fès 350, Agadir 400 DH, au statut « nouveau colis », annotés « COLIS DE RECETTE — ne pas expédier » |

## 4. Parcours de test

1. **Stock → Nouveaux** : valider les six colis.
2. **Stock → Prêts** : scanner les colis. Ils passent au statut « reçu au hub » au Hub Central.
3. **Colis prêts à envoyer** : faire un bon d'envoi par transporteur.
4. Sur chaque bon : **« Colis remis »**, puis **« Bon bien reçu »**, puis **« Mettre en
   distribution »**. Ces étapes se font sur la fiche du bon, avec un compte admin.
5. Passer les colis à **livré** ou **refusé** depuis l'admin.
6. **Factures & règlements → Règlements transporteurs** : vérifier le montant attendu de chaque
   transporteur (COD moins ses frais). Enregistrer un versement, le modifier, puis l'annuler.
7. **Factures → Nouvelle facture** pour la Boutique Recette Shipeh. Vérifier les lignes : 30 DH de
   livraison par colis livré et 3 DH de préparation par colis. Créer un brouillon, l'émettre, puis
   l'annuler avec un motif.

## 5. Ce qu'il ne faut PAS faire

- **Ne jamais utiliser les boutons de remise par API d'un bon d'envoi** (Power Delivery, Meta,
  Colivraison, EST). Ils créeraient un vrai envoi chez le transporteur. Utiliser seulement
  « Colis remis ».
- **Ne remettre physiquement aucun colis à un transporteur.** Ces colis n'existent pas.
- **Ne pas payer la facture de recette.** Le paiement inscrit une vraie dépense au journal
  comptable. Si c'est arrivé quand même, l'annuler par une écriture de compensation dans la
  comptabilité.
- Un versement transporteur de recette inscrit une recette au journal : l'annuler une fois le
  test terminé (bouton « Annuler » du versement). L'annulation passe une compensation.

## 6. Après la recette

- **Annuler** les colis de recette encore en circulation (menu du colis → « Annuler le colis »).
  Le stock est réintégré.
- Annuler les factures et les versements de recette qui ne l'ont pas été.
- **Suspendre la boutique** : Admin → Marchands → Boutique Recette Shipeh → « Suspendre ».

Les données de recette restent en base, sous les noms « Recette ». Le script ne supprime rien.
