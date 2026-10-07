# Déploiement du 7 octobre 2026 — centre de notifications et push Firebase

Branche : `dev`. À déployer **après** `DEPLOIEMENT_2026-10-07.md` (11 hubs et référentiel des villes), ou dans le même déploiement.

Ce déploiement apporte :

- **un centre de notifications** dans chaque espace (`/admin`, `/marchand`, `/livreur`, `/ramasseur` → `/notifications`). Il contient l'historique, et chaque compte y règle séparément, type par type, la **cloche** et le **push** ;
- **une nouvelle alerte pour le back-office** : « Écriture comptable ». Les rôles admin et responsable sont prévenus de chaque écriture au journal de la plateforme : saisie, neutralisation, remise de caisse, paie, règlement de facture ;
- **la mise en service du push** (alertes sur le téléphone ou l'ordinateur, application fermée) par Firebase Cloud Messaging.

Sans Firebase configuré, tout fonctionne quand même : la cloche reçoit tout, mais aucun push ne part et le bouton « Activer » n'apparaît pas.

## Étapes, dans l'ordre

### 1. Sauvegarder la base

### 2. Déployer le code et appliquer la migration

```
npx prisma migrate deploy
```

| Migration | Effet |
|---|---|
| `20261006120000_notifications_cloche_coupes` | ajoute `utilisateurs.cloche_coupes` (types coupés dans la cloche). Ajout seul, vide par défaut : tout le monde continue de tout recevoir. |

Si `migrate deploy` annonce aussi `20260928140000_notifications` et `20260929100000_comptabilite_marchand`, la production n'avait pas encore le déploiement du 1er octobre. C'est normal : ces migrations sont, elles aussi, en ajout seul.

### 3. Configurer Firebase (variables d'environnement du serveur)

Toutes les valeurs viennent de la console Firebase du projet (https://console.firebase.google.com → le projet → ⚙ **Paramètres du projet**).

**Secrets.** Les transmettre par un canal sûr, jamais par e-mail ni messagerie en clair, et jamais dans le dépôt :

| Variable | Où la trouver |
|---|---|
| `FIREBASE_PROJECT_ID` | Paramètres du projet → Général → « ID du projet » |
| `FIREBASE_CLIENT_EMAIL` | Comptes de service → « Générer une nouvelle clé privée » → fichier JSON, champ `client_email` |
| `FIREBASE_PRIVATE_KEY` | même fichier JSON, champ `private_key`, recopié **entier** (`-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----`). Les `\n` littéraux peuvent rester tels quels. |

**Valeurs publiques**, servies au navigateur :

| Variable | Où la trouver |
|---|---|
| `FIREBASE_API_KEY` | Général → « Vos applications » → application Web → `apiKey` |
| `FIREBASE_MESSAGING_SENDER_ID` | même endroit → `messagingSenderId` |
| `FIREBASE_APP_ID` | même endroit → `appId` |
| `FIREBASE_VAPID_KEY` | Cloud Messaging → « Certificats Web push » → paire de clés (la générer si elle n'existe pas) |

**Ne pas** les déclarer en `NEXT_PUBLIC_*`. Elles sont lues au démarrage du serveur : **pas besoin de rebuild**, un redémarrage suffit.

Le site doit être servi en **HTTPS** sur ses trois domaines (admin, marchand, terrain) : le navigateur refuse le push ailleurs.

### 4. Redémarrer le serveur

### 5. Vérifier

1. Dans le journal du serveur, **aucune** ligne `[push] Firebase non configuré`.
2. Se connecter en admin, ouvrir la cloche : le bandeau « Recevez ces alertes sur cet appareil… **Activer** » apparaît. Cliquer, puis accepter l'autorisation du navigateur.
3. Ouvrir le centre de notifications depuis la cloche (lien en pied du panneau). La page s'affiche avec la section « Comptabilité → Écriture comptable » et ses deux cases, cloche et push.
4. Avec **un autre** compte admin ou responsable, saisir une écriture dans `/admin/comptabilite`. Le premier compte reçoit le push « Entrée de … DH » ou « Sortie de … DH ». L'auteur d'un geste n'est jamais notifié de son propre geste.

## À savoir pour l'exploitation

- **Chaque appareil s'active une fois par espace.** Un compte qui utilise l'admin et l'espace marchand clique « Activer » dans chacun.
- **iPhone** : le push ne fonctionne que si le site est ajouté à l'écran d'accueil (Partager → « Sur l'écran d'accueil ») et ouvert depuis là.
- **Réglages** : chacun peut couper la cloche ou le push de chaque type dans son centre de notifications. « Colis livré » n'existe qu'en cloche, sans push, parce qu'il arrive par centaines chaque jour.
- **Quand quelqu'un se déconnecte**, son navigateur cesse de recevoir les alertes de ce compte.
