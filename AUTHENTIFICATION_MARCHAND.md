# Authentification marchand — inscription progressive

## Le principe

Un marchand s'inscrit avec **trois champs** — adresse électronique, mot de passe, nom de boutique —
et entre immédiatement dans son espace. Il y fait ce qui n'engage rien : consulter son dashboard,
saisir ses colis, gérer son catalogue, inviter les membres de son équipe.

Tout ce qui fait circuler de la **marchandise** ou de l'**argent** reste fermé tant que son dossier
n'est pas complet **et** approuvé : bons de livraison, bons de retour, demandes de ramassage
(ponctuelles comme récurrentes), factures.

```
Formulaire (email, mot de passe, nom de boutique)
        ↓
POST /api/marchands/inscription → Utilisateur(actif=TRUE) + Marchand(en_attente_validation)
        ↓
POST /api/auth/login → session → /marchand   ← accès immédiat, écrans verrouillés floutés
        ↓                                        │
/marchand/profil : téléphone, CIN, ville,        │ VERROU 1 — dossier complet
adresse, RIB, justificatif RIB                   │
        ↓                                        │
PATCH /api/marchands/[id]/statut (admin)         │ VERROU 2 — approbation (RF-22)
        ↓
marchand opérationnel : bons, ramassages, factures
```

Les deux verrous sont **indépendants et cumulatifs** : un dossier complet n'approuve pas, une
approbation ne complète pas.

## Ce qui a changé par rapport au flux précédent

| | Avant | Maintenant |
|---|---|---|
| Champs exigés à l'inscription | 10, dont CIN, adresse, RIB et photo du RIB | 3 : email, mot de passe, nom de boutique |
| `Utilisateur.actif` à la création | `false` — **aucune connexion** avant approbation | `true` — connexion immédiate |
| Ce que l'approbation admin ouvre | la porte | les bons, les ramassages, les factures |
| `Utilisateur.actif` après PATCH statut | `statut === 'actif'` | `statut !== 'suspendu'` |

La dernière ligne est la conséquence directe des autres : sans elle, repasser un marchand en
`en_attente_validation` le déconnecterait de l'espace qu'on vient de lui ouvrir.

## La règle, en un seul endroit

`lib/marchand-activation.ts` — module **pur** (ni Prisma, ni `next/*`), testé par
`lib/__tests__/marchand-activation.test.ts`.

- `CHAMPS_A_FINALISER` : `telephone`, `cin`, `ville`, `adresse`, `rib`, `ribPhotoUrl`.
  Le téléphone vit sur `Utilisateur` (titulaire), les cinq autres sur `Marchand`.
  Restent **facultatifs et non bloquants** : site web, banque, registre de commerce, ville de
  ramassage, raison sociale, ICE/RC, type d'entreprise.
- `champsProfilManquants(profil)` — une valeur vide ou faite d'espaces compte comme manquante.
- `etatActivationMarchand({ profil, statut })` → `{ profilComplet, champsManquants, blocage,
  operationnel }`. `blocage` vaut `compte_suspendu`, `profil_incomplet`, `validation_en_attente`
  ou `null`, dans cet ordre de priorité.
- `RESUME_BLOCAGE` / `messageBlocage(etat)` — une seule formulation, servie à la fois dans le 403
  de l'API et dans le panneau de l'écran verrouillé.

`Utilisateur.nomComplet` est `NOT NULL` : quand le nom n'est pas saisi à l'inscription, le nom de
boutique y est recopié. Il n'est donc **pas** un champ bloquant — une valeur de repli ne se
distingue pas d'une saisie.

## Où le verrou est réellement posé (serveur)

`exigerMarchandOperationnel(utilisateurId)` dans `lib/marchand-scope.ts` : résout le marchand
(titulaire **ou** membre d'équipe invité), calcule l'état, lève `ApiError(403, messageBlocage(…))`.

| Fichier | Ce qui est refusé |
|---|---|
| `app/api/ramassages/route.ts` | GET (liste) et POST (demande ponctuelle) |
| `app/api/bons-livraison/route.ts`, `[id]/route.ts` | lecture des BL du marchand |
| `app/marchand/bons-livraison/actions.ts` | **Server Action** de génération d'un BL |
| `app/api/bons-retour/route.ts`, `[id]/route.ts` | lecture des bons de retour |
| `app/api/factures/route.ts`, `[id]/route.ts` | lecture des factures |
| `app/api/marchands/me/route.ts` (PATCH) | **activation** du ramassage récurrent (la désactivation reste toujours permise) |

La Server Action ne passe ni par le proxy ni par `requireUser` : elle pose le garde-fou elle-même.
C'est la porte qu'on oublie le plus facilement.

## Où le verrou est expliqué (client)

- `app/marchand/layout.tsx` calcule l'état **une fois par rendu**, côté serveur, et le distribue
  par `ActivationMarchandProvider` (`components/marchand/activation-context.tsx`). Le charger par
  page ferait clignoter chaque écran déverrouillé le temps d'une requête.
- `components/marchand/VerrouProfil.tsx` : contenu réel flouté, `inert` et `aria-hidden`, panneau
  par-dessus qui nomme les champs manquants et renvoie vers `/marchand/profil`.
- Posé par un `layout.tsx` dans chacune des quatre sections verrouillées (`ramassages`,
  `bons-livraison`, `bons-retour`, `factures`) : **toute page ajoutée dans ces dossiers hérite du
  verrou sans qu'on ait à y penser.**
- `components/marchand/BandeauFinalisation.tsx` : rappel en haut de l'espace, masqué sur les écrans
  déjà verrouillés (le panneau y dit déjà la même chose).
- `components/marchand/MarchandSidebar.tsx` : cadenas sur les entrées listées dans
  `CHEMINS_VERROUILLES` (`components/marchand/nav.ts`). Les entrées restent **visibles et
  cliquables** — les masquer priverait le marchand de la raison de compléter son dossier.
- `app/marchand/profil/page.tsx` : récapitulatif des champs restants, et `router.refresh()` après
  enregistrement — sans lui, le marchand qui vient de saisir son RIB verrait ses écrans encore
  floutés jusqu'au prochain rechargement complet.
- `app/admin/marchands/page.tsx` : pastille « dossier incomplet (N) » à côté du statut, pour que
  l'admin ne valide pas à l'aveugle un compte sans adresse ni RIB.

Le floutage n'est **qu'un affichage**. Ce qui refuse, c'est le serveur.

## Ce qui n'a pas changé

- **Aucune migration** : tous les champs concernés étaient déjà nullable (`Marchand.cin`, `ville`,
  `adresse`, `rib`, `ribPhotoUrl`, `Utilisateur.telephone`). Seuls les commentaires de
  `prisma/schema.prisma` ont été mis à jour — ils portent la règle.
- **Connexion** : `POST /api/auth/login` acceptait déjà un email **ou** un téléphone comme
  identifiant (les membres d'équipe invités n'ont pas de téléphone). Rien à y toucher.
- **Politique de mot de passe** et **rate limit** (5/min/IP) de l'inscription : inchangés.
- **`POST /api/marchands/inscription` accepte toujours les champs du dossier** quand ils sont
  fournis : un appelant qui a déjà tout sous la main crée un dossier complet d'un coup.
- **Flux plateformes partenaires** (`lib/plateforme-marchands.ts`, Shipeh) : **non touché**. Un
  marchand créé par une clé hors scope `marchands:creation_validee` reste `actif = false` et ne se
  connecte pas. C'est une décision distincte de l'auto-inscription.

## Comment tester

1. `http://localhost:3000/inscription` → email + mot de passe + nom de boutique → « Compte créé ».
2. Se connecter avec cet email : on atterrit sur `/marchand`, bandeau ambre en haut, cadenas sur
   « Ramassages » et « Bons & Documents ».
3. Ouvrir `/marchand/colis/nouveau` : **fonctionne**. Ouvrir `/marchand/profil` → onglet Équipe :
   l'invitation d'un membre **fonctionne**.
4. Ouvrir `/marchand/bons-livraison` : contenu flouté, panneau « Finalisez votre inscription »
   listant les six champs. Idem `/marchand/ramassages`, `/marchand/factures`,
   `/marchand/bons-retour`.
5. `curl` direct sur `GET /api/bons-livraison` avec le cookie de session : **403**, message
   nommant les champs manquants. Même chose pour `/api/ramassages`, `/api/factures`,
   `/api/bons-retour`.
6. Compléter le profil (téléphone, CIN, ville, adresse, RIB 24 chiffres, justificatif) →
   enregistrer. Le bandeau devient « dossier complet », mais les écrans restent verrouillés :
   « Dossier en cours de validation ».
7. Côté admin `/admin/marchands` : la pastille « dossier incomplet » a disparu → **Approuver**.
8. Recharger l'espace marchand : tout est ouvert.
9. Suspendre le marchand depuis l'admin → il ne peut plus se connecter du tout (`actif = false`).

## Limites connues

- Pas de relance (email ou notification) vers les marchands qui laissent leur dossier incomplet :
  le rappel n'existe que dans l'interface.
- L'approbation admin reste manuelle et n'est signalée nulle part au marchand une fois obtenue —
  il le découvre en revenant sur un écran déverrouillé.
- Le nom du responsable (`Utilisateur.nomComplet`) peut rester le nom de la boutique si le marchand
  ne le corrige jamais : aucun écran ne l'y invite explicitement.
