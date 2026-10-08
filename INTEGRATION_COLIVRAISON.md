# Intégration Colivraison

Septième réseau sous-traité, et le deuxième branché de bout en bout par API après Power Delivery. Colivraison couvre deux régions qu'aucun autre réseau ne desservait :

- **Béni Mellal-Khénifra** : agences Béni Mellal, Khouribga, Khénifra et Azilal ;
- **Drâa-Tafilalet** : agences Errachidia et Ouarzazate.

Cela fait 132 villes. Leur API est publique : `https://colivraison24h.ma`, plateforme « Colis Pack ».

## 1. Ce que fait l'intégration

| Étape | Comment | Où |
|---|---|---|
| Remise des colis | bouton **« Remettre à Colivraison »** sur le bon d'envoi (admin) | `lib/remise-colivraison.ts`, `POST /api/bons-envoi/[id]/remise-colivraison` |
| Suivi d'un colis | bouton **« Actualiser »** dans la fiche colis | `lib/suivi-colivraison.ts`, `POST /api/commandes/[id]/colivraison/actualiser` |
| Suivi automatique | `npx tsx scripts/suivre-colis-colivraison.ts --oui`, **à planifier toutes les 3 h** | même fonction que le bouton |
| Contrôle des villes | `npx tsx scripts/verifier-villes-colivraison.ts` (lecture seule) | compare `lib/colivraison-villes.ts` à leur `cities.php` |

Ils n'ont **ni webhook, ni modification, ni annulation, ni demande de retour** par API. Le suivi automatique n'est donc pas un rattrapage : c'est le **seul canal** par lequel un colis livré chez eux le devient chez nous.

Le reste suit la mécanique de Power Delivery, voir `INTEGRATION_POWER_DELIVERY.md` :

- **Réservation avant l'appel**, pour éviter les doublons : la remise est enregistrée en base avant d'appeler leur API.
- **Statut « Remis à un transporteur »** posé sur le colis une fois remis.
- **Règle de statuts partagée** : `deciderTransitionStatut` et `ecrireTransition`.
- **Journal** dans `EvenementPrestataire`.
- **Compte machine** comme auteur des statuts appliqués.

## 2. Ce que leur API a de particulier

Les points ci-dessous ont été relevés le 01/10/2026.

- **Les erreurs arrivent en HTTP 200.** Seul le texte du message tranche. Une création n'est réussie que si le message est « Package added succesfully » (avec leur faute) ; toute autre réponse est un refus.
- **Le format des réponses varie selon le script** : `{message}`, `{message, status}`, ou `["…"]`.
- **Les identifiants voyagent dans l'URL** (paramètres `tk` et `sk`). Aucune URL n'apparaît donc dans nos messages d'erreur.
- **`addcolis.php` exige un paramètre `code` absent de leur documentation.** Sans lui, toute création répond « Some parameter are missing ». Constaté lors de la première remise réelle, le 01/10/2026, puis isolé avec un faux token (aucun colis créé). On y envoie notre code, `MTH-<code de suivi>`, également recopié en tête de la note. Le suivi interroge avec leur code s'ils en ont renvoyé un, sinon avec le nôtre. Si leur suivi ne connaît pas le nôtre, on cherche leur code dans `colislist.php` grâce à la note.
- **Leur liste de villes est très redondante** : 926 villes, souvent présentes plusieurs fois (« Adouz », « Adouz-bm », « Adouz (béni mellal) »…). Règle retenue dans `lib/colivraison-villes.ts` :
  1. le nom exact s'il existe ;
  2. sinon la variante suffixée par l'agence ;
  3. jamais une ville voisine.

  Résultat : 105 villes en nom exact, 23 par orthographe proche, 4 rattachées à la ville de leur agence (Ahl Merbaa et Faryata sous Beni mellal #47, Boulanouare et Tachrafat sous Khouribga #1424, localité ajoutée à l'adresse — décidé le 03/10/2026, Colivraison les dessert). Aucune ville ne passe plus par l'Excel.

## 3. Vérifié avec le vrai compte (01/10/2026), et ce qui reste ouvert

Première remise réelle : colis PD-101720, bon BE-2026-1001-001, devenu chez eux `CLV24-01102026-3206613`.

**Vérifié :**

- **La création renvoie leur code** : `{"code": "CLV24-…", "message": "Package added succesfully"}`. Il est gardé dans `codeExterne`.
- **`colislist.php` est un tableau d'objets.** Champs : `Code` (leur code), `IDIntern` (le nôtre), `Fullname`, `Phone`, `Address`, `City`, `NumLivreur`, `Price`, `State`, `DateReported`, `Note`, `Product`, `DateAdd`, `DateUpdate`.
- **`track.php` ne suit PAS leur documentation.** Il renvoie un objet, `{"0": {"state", "eventdate"}, "nom_liveur", "telephone_liveur", "status"}`, et non un tableau `[{Etat, Date_Evenement}]`. Il accepte leur code comme le nôtre, avec ou sans identifiants.
- **Le premier état est « Ajouter »**, et non « Nouveau ». Il est mémorisé, sans toucher au colis.

**Encore ouvert :**

1. **La liste complète de leurs états.** On ne verra les suivants (livré, refusé, reporté…) qu'au fil des colis. Un libellé non reconnu est journalisé (`EvenementPrestataire`, issue `inconnu`) sans être appliqué ; il faut alors compléter `lib/colivraison-statuts.ts`.
2. **Les 4 villes absentes de leur API** (Faryata, Ahl Merbaa, Tachrafat, Boulanouare) : réglé le 03/10/2026, rattachées à la ville de leur agence. Boulanouare est probablement « Boulanoir » (#1425) : à basculer en `orthographe` si Colivraison le confirme.

## 4. Mise en service

1. Renseigner `COLIVRAISON_TOKEN` et `COLIVRAISON_SECRET` (voir `.env.example`).
2. Créer le **compte machine** de Colivraison depuis `/admin/integrations`, en le rattachant au transporteur Colivraison. Sans lui, le suivi ne peut pas poser de statut.
3. Faire **une remise de test** sur un bon d'un seul colis, prévenus côté Colivraison : le colis créé chez eux ne peut pas être annulé par l'API. Lire ensuite la réponse brute conservée dans la remise (`reponseCreation`) pour lever les points 1 et 2 du §3.
4. Planifier `scripts/suivre-colis-colivraison.ts --oui` toutes les 3 h.
