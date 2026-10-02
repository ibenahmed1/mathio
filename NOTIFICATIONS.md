# Notifications internes

Cloche dans les trois espaces (admin, marchand, terrain) + push navigateur par Firebase Cloud
Messaging. Le destinataire **final** du colis n'est pas concerné : c'est le chantier SMS.

## Décisions (28/09/2026)

- **La cloche fait foi**, le push n'est qu'un canal de plus. Push refusé, iPhone non installé,
  Firebase absent : la cloche reçoit tout, toujours.
- **Firebase Cloud Messaging**, pour qu'une future app mobile livreurs réutilise le même canal.
  Appelé en HTTP v1 signé par `jose` — pas de `firebase-admin`.
- **Push aux marchands seulement pour ce qui demande une réaction.** « Colis livré » = cloche seule
  (des centaines par jour noieraient les alertes) ; refusé, retourné, injoignable/numéro erroné =
  push immédiat.
- Préférences : chacun peut **couper le push** d'un type ; la cloche, elle, ne se règle pas.

## Qui reçoit quoi

| Type | Déclencheur | Destinataires | Push |
|---|---|---|---|
| `colis.livre` | statut → livré | boutique, permission `colis.voir` | non |
| `colis.refuse` / `colis.retourne` / `colis.injoignable` | statut → refusé / retourné / injoignable ou numéro erroné | boutique, `colis.voir` | oui |
| `ramassage.effectue` | ramassage → effectué | boutique, `ramassages.voir` | oui |
| `facture.emise` / `facture.reglee` | facture émise / réglée | boutique, `factures.voir` | oui |
| `reclamation.repondue` | réponse écrite du back-office | boutique `reclamations.voir` + l'auteur | oui |
| `tournee.affectee` | bon de distribution créé | le livreur | oui |
| `paiement.regle` | bon de paiement payé | le livreur | oui |
| `ramassage.affecte` | ramasseur affecté | le ramasseur | oui |
| `reclamation.nouvelle` | réclamation d'un marchand | back-office `reclamations:manage` | oui |
| `ramassage.demande` | demande de ramassage | back-office `demande_ramassage:manage` | oui |
| `transporteur.erreur` | remise Power Delivery avec colis non remis | back-office `bon_envoi:manage` | oui |
| `hub.colis_recus` | bon d'envoi interne réceptionné | planners du hub d'arrivée | oui |
| `tache.assignee` / `tache.mention` / `tache.commentaire` | Kanban | assigné, mentionnés, créateur — **s'ils peuvent lire la tâche** | oui |

« Boutique » = le titulaire + les membres actifs dont le rôle donne la permission
(`destinatairesBoutique`). L'auteur d'un geste n'est jamais notifié de ce qu'il vient de faire.

Colis : les points d'écriture appellent `notifierStatutsColis()` avec le nouveau statut ; le tri
se fait dans le helper. Un lot de colis au même statut d'une même boutique = **une** notification.
`ecrireTransition` (lib/livraison-statut.ts) couvre à lui seul l'API v1 et Power Delivery.

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `lib/notifications-catalogue.ts` | catalogue des types, textes des colis — **pur**, testé, lu aussi par le navigateur |
| `lib/notifications.ts` | `notifier()` (ne lève jamais, à appeler **après** la transaction), résolveurs de destinataires |
| `lib/push-firebase.ts` | envoi FCM, purge des jetons morts, repli console |
| `lib/push-client.ts` | abonnement du navigateur (SDK Firebase chargé à la demande) |
| `public/sw-notifications.js` | service worker : affiche le push, ouvre le lien |
| `app/api/notifications/**` | cloche, lues, appareils, préférences, config push |
| `components/notifications/*` | provider (un par coquille) et cloche |
| `app/manifest.webmanifest/route.ts` | manifeste par domaine — condition du push sur iPhone |

## Mise en service

1. Créer un projet Firebase, y ajouter une application **Web**.
2. Remplir les `FIREBASE_*` de `.env.example` (compte de service = secret ; config web et clé VAPID
   = publiques, servies à l'exécution — **pas** en `NEXT_PUBLIC_*`).
3. Redémarrer le serveur. Dans la cloche, le bandeau « Activer » apparaît.

Sans ces variables : pas de bouton, pas d'erreur, un avertissement `[push]` dans le journal.

## Pièges

- **Trois domaines = trois service workers et trois autorisations.** Un compte qui utilise deux
  espaces active le push dans chacun. Un appareil ne reçoit que les notifications dont le lien
  appartient à son espace (`AppareilPush.espace`).
- **iPhone** : push seulement si le site est ajouté à l'écran d'accueil et ouvert de là.
- **Déconnexion** : le navigateur est retiré du compte avant la fermeture de session
  (`lib/deconnexion.ts`) — sur un téléphone partagé, le suivant ne reçoit rien du précédent.
- **Impersonation** : ni abonnement ni bouton, sinon le support recevrait les alertes du marchand.
- La table `notifications` grossit avec les « livré » : pas encore de purge (à brancher, sur le
  modèle de `npm run purger:journal`).

## Reste à faire

- Écran de préférences (l'API `GET|PUT /api/notifications/preferences` existe).
- Purge des notifications anciennes.
- Erreurs du suivi Power Delivery (webhooks refusés, colis introuvable) : journalisées dans
  `EvenementPrestataire`, pas encore notifiées — volume à mesurer d'abord.
- Test sur un vrai projet Firebase : le circuit FCM (jeton, envoi, réception par le service worker
  sans SDK) n'a été validé que jusqu'au repli sans configuration.
