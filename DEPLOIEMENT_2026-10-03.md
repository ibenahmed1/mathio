# Déploiement du 3 octobre 2026 — transporteurs et référentiel des villes

Branche : `feat/notifications`. Les commits suivants sont à déployer ensemble :

- `246ecce` — remise par API pour Meta Livraison et EST Livraison, rattachement des villes Power et Colivraison ;
- `0f5fd95` — décisions de référentiel (Casablanca passe à Power Delivery, villes retirées, tarifs) ;
- le commit du 5 octobre — villes laissées à un seul transporteur, retour à 0 dh partout, règle du moins cher pour une ville partagée (étape 5), et API `GET /api/v1/villes` pour Shipeh (étape 7) ; il apporte aussi le **simulateur de rentabilité** (`/admin/simulateur`, `/marchand/simulateur`).

## Étapes, dans l'ordre

### 1. Sauvegarder la base

L'étape 4 supprime des villes et des tarifs livreur. Il n'y a pas de retour arrière automatique : sauvegarder la base avant.

### 2. Déployer le code et appliquer la migration

```
npx prisma migrate deploy
```

Trois migrations nouvelles, toutes en ajout seul, sans perte de données :

| Migration | Effet |
|---|---|
| `20261003100000_remise_ville_par_nom` | rend `remises_prestataire.city_id` facultatif, ajoute `ville_envoyee` |
| `20261005100000_permission_simulateur` | donne le droit `simulateur:use` aux comptes `admin` |
| `20261005120000_simulations_rentabilite` | crée la table `simulations_rentabilite` (scénarios enregistrés du simulateur) |

Le serveur doit être redémarré après `prisma generate` / le build : un serveur lancé avec l'ancien client Prisma répond 500 sur les routes du simulateur.

### 3. Variables d'environnement (Meta Livraison)

À renseigner sur le serveur, voir `.env.example` :

| Variable | Rôle |
|---|---|
| `META_LIVRAISON_CLE` | clé de notre compte partenaire chez Meta |
| `META_LIVRAISON_SECRET` | secret associé |
| `META_LIVRAISON_WEBHOOK_SECRET` | signature de leur webhook. Sans elle, `POST /api/v1/webhooks/meta-livraison` refuse tout |

Ne pas définir `META_LIVRAISON_BASE_URL` en production : cette variable sert uniquement aux tests.

### 4. Appliquer les décisions de référentiel

**Condition préalable : aucune tournée interne contenant des colis de Casablanca ne doit être ouverte.** La paie du livreur lit son tarif par ville à la clôture, et ces tarifs sont supprimés. Le script vérifie ce point et refuse de s'appliquer tant qu'une telle tournée est ouverte.

```
npx tsx scripts/decisions-villes-octobre-2026.ts          # à blanc : affiche ce qui sera fait, n'écrit rien
npx tsx scripts/decisions-villes-octobre-2026.ts --oui    # applique
```

Lancer d'abord la version à blanc et lire le rapport. Tout s'applique en une seule transaction : en cas d'échec, rien n'est écrit. Le script peut être relancé sans effet une fois les décisions appliquées.

Ce qu'il fait :

| Décision | Effet en base |
|---|---|
| **Casablanca passe à Power Delivery** | Les villes du Hub Casablanca sont supprimées. Leurs colis sont rattachés à la ville du même nom de l'Agence Casablanca (Power). Les tarifs livreur de ces villes sont supprimés. **Le Hub Casablanca reste** : c'est le hub central. |
| Villes retirées de la grille Power | `moulay brahim` (Agence Marrakech), `SIDI HAJAJ` (Agence Casablanca) |
| Fusion | `l jadida` est fusionnée dans `El Jadida` (Agence El Jadida) |
| Tarifs | El Jadida (Power) : 20 dh. Oujda (EST) : 15 dh, retour 0 dh |
| Villes confiées à EST Livraison seul (5 octobre) | `TAOURIRT`, `TAHLA`, `bouhlou`, `AKNOUL`, `AJDIR TAZA`, `OUAD AMLIL` sont retirées de l'Agence Taza (Meta). Leurs colis sont rattachés à la ville EST correspondante. |
| Villes laissées à Sahario Express seul (5 octobre) | `sidi fini` et `merleft` sont retirées de l'Agence Agadir (Leader Colis). Leurs colis sont rattachés à Sidi ifni et Mirleft (Sahario). |
| Villes laissées à Meta Livraison seul (5 octobre) | `Missour`, `Bouleman`, `Guigou`, `Timahdite`, `Outat Lhaj` sont retirées de l'Agence Errachidia (Colivraison). Leurs colis sont rattachés à la ville Meta correspondante. |
| Tarif de retour (5 octobre) | Le retour est à **0 dh chez tous les transporteurs** : tout tarif de retour absent ou différent est mis à 0. |

Si une ville à retirer porte encore des colis sans ville d'accueil, le script s'arrête sans rien écrire et nomme la ville concernée. Il faut alors réaffecter ces colis à la main avant de relancer.

### 5. Contrôler la règle « le moins cher » et réaligner les colis en attente

Depuis le 5 octobre, une ville desservie par plusieurs transporteurs part chez le moins cher. La règle est dans le code et s'applique dès le déploiement. Le choix dépend toutefois des tarifs présents **en base de production**. Ce script vérifie qu'après l'étape 4 aucune ville n'est plus desservie par deux transporteurs :

```
npx tsx scripts/appliquer-routage-moins-cher.ts          # à blanc : contrôle + liste des colis à réaligner
npx tsx scripts/appliquer-routage-moins-cher.ts --oui    # réaligne les colis en attente
```

À lancer **après l'étape 4**.

- Le script liste les villes partagées éventuelles. Au moindre écart (tarif manquant ou différent en production), il s'arrête sans rien écrire, sort en erreur et détaille l'écart. **Ne pas forcer : prévenir l'équipe.**
- Si tout est ✔, il liste les colis créés avant le déploiement qui ne sont pas encore partis : sans bon d'envoi, sans remise à un transporteur, et dans un statut d'avant la remise. Avec `--oui`, il rattache ces colis à la ville du transporteur retenu, pour que leur coût d'achat suive le bon transporteur.
- Un colis déjà confié à un transporteur n'est jamais modifié.

Résultat attendu : « ✔ Aucune ville n'est desservie par plusieurs transporteurs. » Les 13 villes autrefois partagées n'ont plus qu'un transporteur : EST Livraison (Taourirt, Tahla, Aknoul, Bouhlou, Ajdir Taza, Oued Amlil), Sahario Express (Mirleft, Sidi Ifni) et Meta Livraison (Missour, Boulmane, Guigou, Timahdit, Outat el haj).

### 6. Vérifier

Ces contrôles ne font que lire. Ils interrogent les API des transporteurs.

```
npx tsx scripts/verifier-villes-power-delivery.ts     # attendu : « Aucun écart. », 88 villes
npx tsx scripts/verifier-villes-colivraison.ts        # attendu : « Aucun écart. », 127 villes
```

### 7. API des villes pour Shipeh

Nouvel endpoint `GET /api/v1/villes`, servi sur le domaine d'API (`HOST_API`). Il renvoie nos villes avec leur nom, leur code et le tarif de livraison. Il n'y a rien à lancer côté serveur.

Il demande le nouveau droit `villes:lecture`. Les droits d'une clé existante ne se modifient pas. Il faut donc :

1. dans `/admin/integrations`, sur la plateforme Shipeh, **créer une nouvelle clé `live`** avec leurs droits actuels plus `villes:lecture` ;
2. la transmettre à Shipeh ;
3. une fois qu'ils l'utilisent, **mettre l'ancienne clé en expiration**.

Vérification avec la nouvelle clé :

```
curl -H "Authorization: Bearer <nouvelle clé>" https://<HOST_API>/api/v1/villes
# attendu : 200, { "devise": "MAD", "nombre": …, "villes": [ { "nom", "code", "tarifLivraison" }, … ] }
```

## Conséquences pour l'exploitation

- Les nouveaux colis de Casablanca et de sa région partent chez **Power Delivery**, et non plus chez nos livreurs.
- La marge compte désormais un coût d'achat de 15 dh pour Casablanca et de 20 dh pour les 11 autres villes, par colis livré.
- Chaque ville n'a plus qu'un transporteur, quelle que soit l'orthographe saisie par le marchand (« Bouleman » part chez Meta comme « Boulmane »). Si une ville venait à être desservie par deux transporteurs, elle partirait chez le moins cher.
- Toutes les villes de Power (88), Colivraison (132) et Meta (106) sont remettables par API. Les localités absentes de leurs API partent sous la ville de leur agence, avec le nom de la localité ajouté à l'adresse.

## À ne pas faire

- **Ne pas lancer `npm run db:reseau` sur la production.** Cette commande réaligne tous les tarifs sur les grilles d'origine et écrase les corrections faites depuis l'application.
