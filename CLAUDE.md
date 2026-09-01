# Mathio Delivery — plateforme de livraison COD (Maroc)

## Comment travailler sur ce dépôt

**Avant d'écrire la moindre ligne**

1. Lire la partie de `prisma/schema.prisma` concernée. Ses commentaires portent les **règles
   métier**, ils ne sont pas décoratifs — plusieurs invariants d'argent n'existent que là.
2. Lire la doc markdown du domaine touché (liste en bas de ce fichier).
3. Chercher le helper existant dans `lib/` avant d'en écrire un nouveau.

**Sur une tâche non triviale** — nouveau modèle, migration, route qui touche l'argent, les
permissions ou les frontières d'espace — **exposer le plan avant de modifier le code** : modèle,
migration, endpoints, points d'insertion dans les flux existants, impacts. Attendre le feu vert.

**Interdits.** Un manquement ici est un défaut de sécurité, pas une question de style :

- Aucune requête Prisma sur `Facture` / `LigneFacture` servant un marchand sans
  `FACTURE_OMIT_COUTS` / `LIGNE_OMIT_COUTS` **dans la requête** (pas de filtrage après coup).
- Aucune route API sans `requireUser([...])` ou `requirePermission(...)`.
- Aucune nouvelle route `/admin/**` ou `/api/**` sans entrée correspondante dans
  `lib/permission-routes.ts` — ou une entrée `null` explicite et **commentée sur place**.
- Aucune migration Prisma générée ou appliquée sans l'annoncer d'abord.

**Après modification** : `npm run lint` puis `npm test`. Signaler les échecs tels quels, ne jamais
les contourner ni désactiver une règle pour faire passer le build.

## Commandes

| | |
|---|---|
| `npm run dev` | serveur de dev |
| `npm run build` | **lance `prisma generate` avant `next build`** |
| `npm test` | `tsx --test lib/__tests__/*.test.ts` — **pas Jest, pas Vitest**. Seul `lib/` est testé |
| `npm run lint` / `lint:fix` | eslint 9 (flat config) |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:seed` | `tsx prisma/seed.ts` (déclaré dans `prisma.config.ts`, pas dans `package.json`) — **le compte admin, et rien d'autre** |
| `npm run db:reseau` | charge le référentiel de sous-traitance (5 prestataires, 17 agences, 341 villes, 238 tarifs) depuis `scripts/import-prestataire-*.ts`. Idempotent : à rejouer sans risque. **Le seed ne le fait pas** — sans cette commande, une base fraîchement migrée n'a ni hub, ni ville, ni tarif |

## Stack

Next 16 (App Router) · React 19 · Prisma 7 + adapter `pg` · Tailwind 4 · TypeScript strict
Auth maison (`jose` + cookies), pas de NextAuth.

## Architecture

**Trois espaces, sur trois domaines RACINES distincts** — découpage par audience, pas par module :

- `admin` → tout le personnel interne (back-office, planificateur de hub, Kanban)
- `marchand` → les boutiques clientes
- `terrain` → livreurs et ramasseurs

L'espace d'une requête se déduit du `Host`, jamais d'un en-tête client. Un espace = un cookie.
Configuration dans `lib/spaces.ts` (module **pur** : aucun import `next/*`, Prisma ou crypto).
→ détail dans `ISOLATION_ROLES_COOKIES.md`

**Le contrôle d'accès est appliqué en trois couches indépendantes, et c'est volontaire :**

1. **Domaine** — `proxy.ts` : l'espace autorise-t-il ce rôle ?
2. **Rôle** — `requireUser([...])` dans chacune des ~130 routes API (`lib/api-utils.ts`)
3. **Permission** — `lib/permission-routes.ts` : table centrale chemin → permission, lue par le proxy

N'en retirer aucune en ajoutant une route. → `GESTION_UTILISATEURS_ROLES_PERMISSIONS.md`

**Où va le code :** la logique métier vit dans `lib/*.ts`. Les route handlers valident l'entrée,
appellent `lib/`, sérialisent la sortie. Ne pas écrire de règle métier dans un `route.ts`.

## Fichiers clés

Les points de passage obligés — y chercher avant d'écrire quoi que ce soit de transverse :

| Fichier | Ce qui y vit |
|---|---|
| `lib/api-utils.ts` | `requireUser`, `requirePermission`, `ApiError`, `jsonError` — l'entrée de toute route |
| `lib/auth.ts` | sessions, listes de rôles (`ROLES_BACKOFFICE`, `ROLES_KANBAN_UNIQUEMENT`, `ROLES_HUB_UNIQUEMENT`) |
| `lib/spaces.ts` | isolation espaces / hôtes / cookies — **module pur** |
| `lib/permissions.ts` | catalogue des permissions et jeux par rôle |
| `lib/permission-routes.ts` | matrice chemin → permission, lue par le proxy |
| `lib/facturation.ts` | facturation, marge, `arrondi()`, `*_OMIT_COUTS` |
| `lib/statuts.ts` | ordre et libellés d'affichage des statuts colis (indépendant de l'ordre de l'enum Prisma) |
| `lib/prisma.ts` | instance du client — ne jamais en instancier une autre |
| `proxy.ts` | aiguillage par hôte, confinement des rôles, résolution de la permission de route |
| `prisma/schema.prisma` | le modèle **et** ses règles métier, en commentaires |

## Conventions

- **Tout est en français** : modèles, champs, enums, variables, commentaires, messages de commit.
  Une contribution en anglais détonne — ne pas en introduire.
- **Prisma** : `camelCase` en TypeScript, `snake_case` en base via `@map` / `@@map`. Systématique.
- **Argent** : `Decimal(10,2)` en base ; converti en `number` à la frontière de `lib/` et arrondi
  par le helper local `arrondi()` (défini dans `facturation.ts`, `bon-distribution.ts`,
  `bon-paiement.ts`). Ne jamais laisser un `Decimal` brut remonter jusqu'à une réponse JSON.
- **Commentaires** : ce dépôt commente le *pourquoi*, longuement, au-dessus des choix non évidents
  (voir `prisma/schema.prisma`). Respecter ce style plutôt que de commenter le *quoi*.

## Validation et typage

**Aucune bibliothèque de schéma** — ni Zod, ni Yup, ni TypeBox, et ce n'est pas un oubli. La
validation se fait à la main depuis `unknown`, au début du handler. Ne pas en introduire une sans
en discuter d'abord.

Motif standard d'une route, à reproduire tel quel :

```ts
export async function POST(request: Request) {
  try {
    await requireUser(['admin']);
    const body = await request.json();

    const nom = typeof body.nom === 'string' ? body.nom.trim() : '';
    if (!nom) throw new ApiError(400, 'nom est requis');

    try {
      const cree = await prisma.modele.create({ data: { nom } });
      return NextResponse.json(cree, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Ce modèle existe déjà');
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
```

- Toute la route est enveloppée d'un `try` dont le `catch` retourne `jsonError(error)`. C'est ce
  qui garantit qu'aucune erreur interne ne fuit vers le client.
- Les erreurs Prisma connues sont traduites en `ApiError` avec un statut juste (`P2002` → 409).
- Les tableaux d'identifiants reçus en body passent par `parseStringIdArray`.
- **Typer explicitement le retour de toute fonction exportée de `lib/`** (`Promise<Facture[]>`,
  pas l'inférence). L'existant est inégal ; les nouvelles fonctions appliquent la règle, et une
  fonction déjà touchée pour autre chose en profite.

## Pièges

- **Client Prisma généré dans `app/generated/prisma/`** (pas dans `node_modules`). Ne jamais
  l'éditer, ni le lire pour comprendre le modèle : la source est `prisma/schema.prisma` (~2000
  lignes, abondamment commentées). Il est exclu d'eslint.
- **Un coût inconnu vaut `null`, jamais `0`.** Zéro dirait « gratuit » et gonflerait la marge d'un
  montant inventé. C'est la raison d'être de `Facture.nbLignesCoutInconnu`.
- **`LigneFacture.coutLivraison` et `coutSource` sont INTERNES.** Ils ne sortent jamais vers un
  marchand : écartés par `omit` **dans la requête** (`LIGNE_OMIT_COUTS` / `FACTURE_OMIT_COUTS`),
  pas filtrés après coup. Lui montrer notre prix d'achat, c'est lui donner notre marge.
- **`next dev` et `next build` se marchent dessus** : un build lancé pendant que le dev tourne peut
  faire renvoyer 404 à des routes qui existent. Ne pas conclure trop vite à une route manquante.
- **Les `NEXT_PUBLIC_*` sont figés au build** : corriger une variable au démarrage ne change rien
  si le build l'avait déjà inlinée. Rebuild obligatoire.

## Git

- Une branche par lot : `feat/…`, `chore/…`, `fix/…`. Base et cible : `dev`.
- Commits atomiques, message en français à l'impératif. Pas de « finalisation » ni de « fix ».
- Jamais de commit direct sur `dev`.

## Documentation de référence

Longue, à lire à la demande — ne pas en recopier le contenu ici :

- `SOUS_TRAITANCE.md` — prestataires, agences, villes et tarifs : ce qui a été **interprété** faute
  de réponse métier, et les questions qui restent. À lire avant de toucher au référentiel.
- `GESTION_UTILISATEURS_ROLES_PERMISSIONS.md` — les 12 rôles et le catalogue de permissions
- `ISOLATION_ROLES_COOKIES.md` — séparation des espaces, cookies, sessions
- `AUTHENTIFICATION_MARCHAND.md` — parcours d'inscription et de connexion marchand
- `API_PARTENAIRES.md` — API exposée aux partenaires
- `NUMERO_SERIE_QR_CODEBARRE.md` — numérotation des colis, QR et code-barres
