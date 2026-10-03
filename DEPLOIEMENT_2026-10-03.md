# Déploiement du 3 octobre 2026 — transporteurs et référentiel des villes

Branche : `feat/notifications`. Deux commits à déployer ensemble :

- `246ecce` — remise par API pour Meta Livraison et EST Livraison, rattachement des villes Power et Colivraison ;
- le commit qui ajoute ce fichier — décisions de référentiel (Casablanca passe à Power Delivery, villes retirées, tarifs).

## Étapes, dans l'ordre

### 1. Sauvegarder la base

L'étape 4 supprime des villes et des tarifs livreur. Il n'y a pas de retour arrière automatique : sauvegarder la base avant.

### 2. Déployer le code et appliquer la migration

```
npx prisma migrate deploy
```

Une seule migration nouvelle : `20261003100000_remise_ville_par_nom`. Elle rend `remises_prestataire.city_id` facultatif et ajoute la colonne `ville_envoyee`. Ajout seul, sans perte de données.

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

Si une ville à retirer porte encore des colis sans ville d'accueil, le script s'arrête sans rien écrire et nomme la ville concernée. Il faut alors réaffecter ces colis à la main avant de relancer.

### 5. Vérifier

Ces contrôles ne font que lire. Ils interrogent les API des transporteurs.

```
npx tsx scripts/verifier-villes-power-delivery.ts     # attendu : « Aucun écart. », 88 villes
npx tsx scripts/verifier-villes-colivraison.ts        # attendu : « Aucun écart. », 132 villes
```

## Conséquences pour l'exploitation

- Les nouveaux colis de Casablanca et de sa région partent chez **Power Delivery**, et non plus chez nos livreurs.
- La marge compte désormais un coût d'achat de 15 dh pour Casablanca et de 20 dh pour les 11 autres villes, par colis livré.
- Toutes les villes de Power (88), Colivraison (132) et Meta (106) sont remettables par API. Les localités absentes de leurs API partent sous la ville de leur agence, avec le nom de la localité ajouté à l'adresse.

## À ne pas faire

- **Ne pas lancer `npm run db:reseau` sur la production.** Cette commande réaligne tous les tarifs sur les grilles d'origine et écrase les corrections faites depuis l'application.
