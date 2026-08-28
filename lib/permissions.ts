import type { Role } from '@/app/generated/prisma/enums';

// Catalogue des permissions du BACK-OFFICE (espace `admin`, § lib/spaces.ts).
//
// Module volontairement PUR — aucun import de `next/*`, de Prisma runtime ni
// de crypto : il est chargé aussi bien par le proxy (edge) que par les route
// handlers, la navigation côté client et l'écran de gestion des utilisateurs.
// Y ajouter une dépendance runtime casserait ces usages d'un coup, exactement
// comme pour lib/spaces.ts.
//
// --- Ce que ce fichier gouverne, et ce qu'il ne gouverne pas ---------------
//
// Une permission répond à « CE COMPTE PEUT-IL OUVRIR CE MODULE ? ». Elle ne
// répond PAS à « SUR QUELLES DONNÉES ? ». Le cantonnement par les données
// reste entier et INDÉPENDANT :
//   - le planner et l'agent_hub restent bornés à leur hub de rattachement
//     (`Utilisateur.hubId`, forcé côté API — cf. resolveHubPlanification) ;
//   - le marchand reste borné à sa boutique (lib/marchand-scope.ts) ;
//   - le livreur/ramasseur restent bornés à leurs propres bons.
// Accorder `bon_distribution:manage` à un planner ne lui ouvre donc pas les
// tournées d'un autre hub — seulement l'écran.
//
// Les espaces `marchand` et `terrain` NE SONT PAS gouvernés par ces
// permissions : leurs rôles (marchand, livreur, ramasseur) n'ont qu'une seule
// interface chacun, entièrement définie par leur rôle, et leur cloisonnement
// se joue au niveau du domaine (§ lib/spaces.ts). Leur jeu de permissions par
// défaut est donc vide, et ce n'est pas un oubli (cf. ROLE_PERMISSIONS).

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
}

export interface PermissionCategory {
  category: string;
  permissions: PermissionDef[];
}

// Source de vérité unique : l'ordre et le découpage en catégories ci-dessous
// sont ceux affichés tels quels dans l'écran de gestion des utilisateurs
// (cases à cocher groupées) — pas de second tableau à tenir à jour ailleurs.
export const PERMISSION_CATALOG: PermissionCategory[] = [
  {
    category: 'Accueil',
    permissions: [
      {
        key: 'dashboard:view',
        label: 'Tableau de bord',
        description: "Accéder à la page d'accueil / tableau de bord principal.",
      },
    ],
  },
  {
    category: 'Colis',
    permissions: [
      { key: 'colis:create', label: 'Nouveau colis', description: 'Créer un colis manuellement.' },
      { key: 'colis:import', label: 'Import Excel', description: 'Importer des colis en masse.' },
      { key: 'colis:read', label: 'Consulter la liste', description: "Voir la liste et le détail d'un colis." },
      { key: 'colis:track', label: 'Suivi des colis', description: 'Accéder au suivi des colis.' },
      {
        key: 'colis:confirm',
        label: 'Confirmation colis',
        description: 'Confirmer les colis et faire évoluer leur statut.',
      },
      { key: 'colis:update', label: 'Modifier un colis', description: "Modifier les données d'un colis existant." },
      {
        key: 'colis:delete',
        label: 'Supprimer un colis',
        description: 'Supprimer un colis, à l’unité ou par lot.',
      },
      {
        key: 'colis:payment',
        label: 'Encaissement COD',
        description: "Marquer l'encaissement du montant à la livraison d'un colis.",
      },
    ],
  },
  {
    category: 'Statistiques',
    permissions: [
      { key: 'stats:all', label: 'Tout', description: 'Voir les statistiques globales.' },
      { key: 'stats:client', label: 'Par client', description: 'Voir les statistiques par client.' },
      { key: 'stats:livreur', label: 'Par livreur', description: 'Voir les statistiques par livreur.' },
      { key: 'stats:zone', label: 'Par zone', description: 'Voir les statistiques par zone.' },
      { key: 'stats:ville', label: 'Par ville', description: 'Voir les statistiques par ville.' },
      { key: 'stats:compare', label: 'Comparer', description: "Accéder à l'outil de comparaison." },
    ],
  },
  {
    category: 'Gestion de stock',
    permissions: [
      { key: 'stock:nouveaux', label: 'Nouveaux colis stock', description: 'Accéder aux nouveaux colis en stock.' },
      {
        key: 'stock:prets',
        label: 'Prêts pour préparation',
        description: 'Accéder aux colis prêts pour préparation.',
      },
      { key: 'stock:bons_preparation', label: 'Bons de préparation', description: 'Gérer les bons de préparation.' },
      { key: 'stock:inventory', label: 'Inventaire', description: "Accéder et effectuer l'inventaire du stock." },
    ],
  },
  {
    category: 'Opérations Hub & Tournées',
    permissions: [
      { key: 'bon_livraison:manage', label: 'Bons de livraison', description: 'Gérer les bons de livraison.' },
      // Deux clés là où le catalogue d'origine n'en avait qu'une : l'agent de
      // quai doit pouvoir consulter et réceptionner un bon d'envoi sans jamais
      // pouvoir en composer un. `manage` couvre la réception, `create` la
      // composition (colis éligibles, destinations, vérification, export).
      {
        key: 'bon_envoi:manage',
        label: "Bons d'envoi — consulter et réceptionner",
        description: "Consulter les bons d'envoi et marquer leur réception.",
      },
      {
        key: 'bon_envoi:create',
        label: "Bons d'envoi — composer",
        description: "Créer, modifier et exporter un bon d'envoi.",
      },
      { key: 'planification:manage', label: 'Planification', description: 'Accéder à la planification des tournées.' },
      { key: 'bon_distribution:manage', label: 'Bons de distribution', description: 'Gérer les bons de distribution.' },
      { key: 'scan:tournee', label: 'Scan Tournée', description: 'Scanner les colis pour la tournée.' },
      { key: 'scan:reception_hub', label: 'Scan Réception Hub', description: "Scanner l'entrée des colis en hub." },
    ],
  },
  {
    category: 'Bon de paiement',
    permissions: [
      {
        key: 'paiement_livreur:manage',
        label: 'Paiements livreur',
        description: 'Gérer les bons de paiement pour livreur.',
      },
      { key: 'paiement_zone:manage', label: 'Paiements zone', description: 'Gérer les bons de paiement pour zone.' },
    ],
  },
  {
    category: 'Bon de retour',
    permissions: [
      { key: 'bon_retour:manage', label: 'Bons de retour', description: 'Gérer les bons de retour de marchandise.' },
    ],
  },
  {
    category: 'Facturation & Comptabilité',
    permissions: [
      { key: 'facture:create', label: 'Créer une facture', description: 'Rédiger et modifier une facture.' },
      { key: 'facture:read', label: 'Toutes les factures', description: 'Consulter les factures.' },
      // Séparée de `facture:create` : rédiger un brouillon n'engage rien,
      // l'émettre, l'encaisser ou l'annuler engage la société.
      {
        key: 'facture:issue',
        label: 'Émettre / encaisser une facture',
        description: 'Émettre, encaisser ou annuler une facture.',
      },
      {
        key: 'comptabilite:read',
        label: 'Comptabilité (consultation)',
        description: 'Consulter le module comptabilité et ses écritures.',
      },
      // Le catalogue d'origine ne prévoyait que `comptabilite:read`, alors que
      // le module écrit : saisie de dépenses, annulation d'écritures.
      {
        key: 'comptabilite:write',
        label: 'Comptabilité (écritures)',
        description: 'Saisir une écriture ou une dépense, et en annuler.',
      },
    ],
  },
  {
    category: 'Relations & Support',
    permissions: [
      { key: 'reclamations:manage', label: 'Réclamations', description: 'Consulter et traiter les réclamations.' },
      { key: 'marchands:manage', label: 'Marchands', description: 'Gérer les comptes marchands et leurs tarifs.' },
      // Détachée de `marchands:manage` : ouvrir une session SUR le compte d'un
      // client est le geste le plus sensible de l'application (il donne accès
      // à ses données réelles, et il est tracé dans AuditLog). Il ne doit pas
      // être un effet de bord du droit de modifier une fiche marchand.
      {
        key: 'marchands:impersonate',
        label: 'Accès support à un compte marchand',
        description: "Ouvrir une session sur le compte d'un marchand (dépannage).",
      },
      {
        key: 'demande_ramassage:manage',
        label: 'Demandes de ramassage',
        description: 'Gérer les demandes de ramassage.',
      },
    ],
  },
  {
    category: 'Organisation & Administration',
    permissions: [
      { key: 'users:manage', label: 'Utilisateurs', description: 'Créer et modifier les comptes agents/livreurs.' },
      { key: 'tasks:manage', label: 'Tâches (Kanban)', description: "Accéder à l'outil de gestion des tâches." },
      { key: 'hubs:manage', label: 'Hubs', description: 'Configurer et gérer les hubs régionaux.' },
      // Les pôles du Kanban : deux clés, parce que le cycle de vie d'un pôle
      // (le créer, le supprimer) et l'affectation de ses membres n'ont jamais
      // eu le même public.
      {
        key: 'poles:manage',
        label: 'Pôles (création)',
        description: 'Créer, renommer et supprimer un pôle du Kanban.',
      },
      {
        key: 'poles:members',
        label: 'Pôles (membres)',
        description: 'Consulter les pôles et y affecter des membres.',
      },
      // `settings:manage` n'ouvre que l'ÉCRAN des paramètres — tout le
      // back-office l'a. Les deux clés ci-dessous gouvernent ce qui s'y écrit,
      // et restent réservées.
      {
        key: 'settings:manage',
        label: 'Paramètres (accès)',
        description: "Ouvrir l'écran des paramètres généraux.",
      },
      {
        key: 'villes:manage',
        label: 'Zones & villes',
        description: 'Créer, modifier et supprimer les villes et leurs zones.',
      },
      {
        key: 'societe:manage',
        label: 'Données de la société',
        description: "Modifier les informations de la société (raison sociale, en-têtes de documents…).",
      },
    ],
  },
];

export const ALL_PERMISSIONS: string[] = PERMISSION_CATALOG.flatMap((c) => c.permissions.map((p) => p.key));

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): boolean {
  return PERMISSION_SET.has(value);
}

// Ne conserve que les clés du catalogue, dédoublonnées et remises dans l'ordre
// du catalogue : une clé supprimée du catalogue mais restée en base (ancienne
// version, faute de frappe dans un appel API) est ignorée silencieusement
// plutôt que d'accorder un droit fantôme.
export function sanitizePermissions(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const uniques = new Set<string>();
  for (const v of values) {
    if (typeof v === 'string' && PERMISSION_SET.has(v)) uniques.add(v);
  }
  return ALL_PERMISSIONS.filter((k) => uniques.has(k));
}

export function permissionLabel(key: string): string {
  for (const cat of PERMISSION_CATALOG) {
    const found = cat.permissions.find((p) => p.key === key);
    if (found) return found.label;
  }
  return key;
}

// --- Jeux de permissions par défaut, par rôle -------------------------------
//
// Reproduisent EXACTEMENT ce que chaque rôle voyait avant l'introduction des
// permissions (cf. components/admin/nav.ts et les listes `requireUser` des
// routes) : la migration qui remplit `Utilisateur.permissions` s'appuie
// dessus, de sorte qu'aucun compte existant ne gagne ni ne perd un accès le
// jour du déploiement.
//
// Ils servent ensuite de PROPOSITION à la création d'un compte (les cases
// pré-cochées du formulaire) — pas de plancher : une fois le compte créé,
// c'est sa liste stockée qui fait foi, et elle seule. Décocher une case
// retire réellement l'accès.
//
// Seul `admin` échappe à la règle : il détient toujours l'intégralité du
// catalogue, y compris les permissions ajoutées après la création de son
// compte (cf. effectivePermissions). Sans cette exception, ajouter une clé au
// catalogue laisserait le module inaccessible à tout le monde jusqu'à ce
// qu'un admin se la coche lui-même — impossible pour `users:manage`.
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  admin: [...ALL_PERMISSIONS],

  superviseur: [
    'dashboard:view',
    'colis:import',
    'colis:read',
    'colis:track',
    'colis:confirm',
    // PATCH /api/commandes/<id>/paiement autorise admin + superviseur +
    // responsable : les trois gardent l'encaissement.
    'colis:payment',
    'stats:all',
    'stats:client',
    'stats:livreur',
    'stats:zone',
    'stats:ville',
    'stats:compare',
    'reclamations:manage',
    'tasks:manage',
    'poles:members',
    'settings:manage',
  ],

  responsable: [
    'dashboard:view',
    'colis:import',
    'colis:read',
    'colis:track',
    'colis:payment',
    'stats:all',
    'stats:client',
    'stats:livreur',
    'stats:zone',
    'stats:ville',
    'stats:compare',
    'paiement_livreur:manage',
    'paiement_zone:manage',
    'facture:create',
    'facture:read',
    'facture:issue',
    'comptabilite:read',
    'comptabilite:write',
    'tasks:manage',
    'poles:members',
    'settings:manage',
  ],

  moderateur: [
    'dashboard:view',
    'colis:read',
    'colis:track',
    'colis:confirm',
    'reclamations:manage',
    'tasks:manage',
    'poles:members',
    'settings:manage',
  ],

  equipe_suivi: [
    'dashboard:view',
    'colis:read',
    'colis:track',
    'colis:confirm',
    'tasks:manage',
    'poles:members',
    'settings:manage',
  ],

  planner: [
    'dashboard:view',
    'colis:read',
    'colis:track',
    'planification:manage',
    'bon_distribution:manage',
    'scan:tournee',
    'bon_retour:manage',
    'tasks:manage',
    'settings:manage',
  ],

  // L'agent de quai : le scan de réception, et la consultation/réception des
  // Bons d'Envoi de son hub. La CRÉATION d'un bon d'envoi lui reste fermée —
  // `bon_envoi:manage` est plus grossier que ce besoin, le refus de
  // /admin/bon-envoi/creer continue donc d'être appliqué à part dans proxy.ts
  // et par `requireUser(['admin'])` sur le POST de la route.
  //
  // `colis:read` n'est pas un élargissement : l'écran de réception liste les
  // colis reçus du jour (GET /api/commandes), que ce rôle interroge déjà
  // aujourd'hui (ROLES_LECTURE_COMMANDES). Sans cette clé, la page se vide.
  // Elle ne lui ouvre pas la liste des colis pour autant : /admin/commandes
  // lui reste fermé par le confinement de chemin (ROLES_HUB_UNIQUEMENT).
  agent_hub: ['scan:reception_hub', 'bon_envoi:manage', 'colis:read'],

  design: ['tasks:manage', 'poles:members'],
  gestionnaire_hub: ['tasks:manage', 'poles:members'],

  // Espaces marchand et terrain : gouvernés par le rôle et le domaine, pas par
  // ce catalogue (cf. l'en-tête de ce fichier). Une liste vide n'y ferme donc
  // rien du tout.
  marchand: [],
  livreur: [],
  ramasseur: [],
};

// Permissions réellement détenues par un compte.
//
// La liste stockée fait foi — SAUF pour l'admin, à qui le catalogue entier est
// accordé quoi qu'il arrive (cf. le commentaire de ROLE_PERMISSIONS), et sauf
// pour les rôles hors back-office, dont l'accès ne passe pas par ce catalogue.
export function effectivePermissions(role: Role, stored: string[] | null | undefined): string[] {
  if (role === 'admin') return [...ALL_PERMISSIONS];
  return sanitizePermissions(stored ?? []);
}

export function hasPermission(permissions: string[], required: string): boolean {
  return permissions.includes(required);
}
