// Catalogue des permissions de l'espace MARCHAND (§ Équipe & accès,
// /marchand/equipe) — le pendant, pour une boutique, de lib/permissions.ts
// côté back-office.
//
// Module volontairement PUR, pour les mêmes raisons que lib/permissions.ts :
// il est lu par le proxy, par les route handlers et par les écrans clients.
//
// --- Ce que ce fichier gouverne ---------------------------------------------
//
// « CE MEMBRE DE LA BOUTIQUE PEUT-IL OUVRIR CE MODULE ? » — rien de plus. Le
// cantonnement aux données de SA boutique reste celui de lib/marchand-scope.ts,
// inchangé : un droit accordé ici n'ouvre jamais les colis d'une autre boutique.
//
// Le TITULAIRE du compte (Marchand.utilisateurId) détient toujours le
// catalogue entier, y compris les clés ajoutées après coup — comme l'admin
// côté back-office. Sans cette exception, ajouter une clé laisserait le module
// fermé à tout le monde, titulaire compris.
//
// --- Pourquoi un espace de noms distinct (points, pas deux-points) ---------
//
// Les clés du back-office s'écrivent `module:action` (`colis:read`), celles-ci
// `module.action` (`colis.voir`). Les deux catalogues transitent par le même
// champ `SessionPayload.permissions` : des clés disjointes par construction
// garantissent qu'un droit de boutique ne pourra jamais être lu comme un droit
// du back-office, même si une future règle les confrontait par erreur.

export interface PermissionMarchandDef {
  key: string;
  label: string;
  description: string;
  // Clés que cette permission présuppose : créer un colis sans pouvoir voir la
  // liste des colis, ou sans pouvoir lire le catalogue où l'on choisit la
  // marchandise, donnerait un écran inutilisable. Les dépendances sont
  // ajoutées automatiquement (cf. completerDependances), côté serveur comme
  // dans le formulaire — la case cochée à l'écran est donc toujours celle
  // qui fait foi.
  requiert?: string[];
  // Droit qui ouvre des données financières ou engage la boutique : signalé
  // dans l'écran des rôles, pour que l'accorder soit un choix conscient.
  sensible?: boolean;
}

export interface PermissionMarchandCategorie {
  categorie: string;
  permissions: PermissionMarchandDef[];
}

export const PERMISSIONS_MARCHAND: PermissionMarchandCategorie[] = [
  {
    categorie: 'Tableau de bord',
    permissions: [
      {
        key: 'tableau_de_bord.voir',
        label: 'Tableau de bord',
        description: "Voir l'accueil : volumes, taux de livraison et montants encaissés.",
        sensible: true,
      },
    ],
  },
  {
    categorie: 'Colis',
    permissions: [
      { key: 'colis.voir', label: 'Consulter les colis', description: 'Voir la liste, le détail et le suivi des colis.' },
      {
        key: 'colis.creer',
        label: 'Créer des colis',
        description: 'Saisir un colis, en importer par fichier Excel.',
        requiert: ['colis.voir', 'catalogue.voir'],
      },
      {
        key: 'colis.modifier',
        label: 'Modifier et relancer',
        description: 'Corriger un colis, le relancer ou le remettre en livraison.',
        requiert: ['colis.voir', 'catalogue.voir'],
      },
      {
        key: 'colis.supprimer',
        label: 'Supprimer des colis',
        description: 'Supprimer un colis, à l’unité ou par lot.',
        requiert: ['colis.voir'],
      },
      {
        key: 'colis.exporter',
        label: 'Exporter',
        description: 'Télécharger la liste des colis au format Excel.',
        requiert: ['colis.voir'],
      },
    ],
  },
  {
    categorie: 'Catalogue & inventaire',
    permissions: [
      {
        key: 'catalogue.voir',
        label: 'Consulter le catalogue',
        description: 'Voir les marchandises et l’inventaire du stock.',
      },
      {
        key: 'catalogue.gerer',
        label: 'Gérer le catalogue',
        description: 'Ajouter, modifier et supprimer des marchandises et des produits en stock.',
        requiert: ['catalogue.voir'],
      },
    ],
  },
  {
    categorie: 'Ramassages & documents',
    permissions: [
      { key: 'ramassages.voir', label: 'Consulter les ramassages', description: 'Voir les demandes de ramassage.' },
      {
        key: 'ramassages.demander',
        label: 'Demander un ramassage',
        description: 'Programmer le passage d’un ramasseur.',
        requiert: ['ramassages.voir'],
      },
      {
        key: 'bons.voir',
        label: 'Consulter les bons',
        description: 'Voir et imprimer les bons de livraison et de retour.',
      },
      {
        key: 'bons.creer',
        label: 'Générer des bons de livraison',
        description: 'Regrouper des colis dans un nouveau bon de livraison.',
        requiert: ['bons.voir', 'colis.voir'],
      },
    ],
  },
  {
    categorie: 'Finances',
    permissions: [
      {
        key: 'factures.voir',
        label: 'Factures',
        description: 'Consulter et télécharger les factures de la boutique.',
        sensible: true,
      },
      // § Comptabilité de la boutique : les quatre gestes du back-office
      // (comptabilite:read/write/edit/delete), avec la même séparation —
      // saisir et neutraliser laissent une trace DANS le journal, modifier et
      // supprimer réécrivent ce qu'il affiche.
      {
        key: 'comptabilite.voir',
        label: 'Consulter la comptabilité',
        description: 'Voir le journal des recettes et dépenses, la trésorerie, les commandes d’inventaire et leur historique.',
        sensible: true,
      },
      {
        key: 'comptabilite.saisir',
        label: 'Saisir en comptabilité',
        description: 'Ajouter des transactions et des commandes d’inventaire, neutraliser une écriture, suivre le statut d’une commande.',
        requiert: ['comptabilite.voir'],
        sensible: true,
      },
      {
        key: 'comptabilite.modifier',
        label: 'Modifier la comptabilité',
        description: 'Corriger une transaction ou une commande d’inventaire, gérer les catégories.',
        requiert: ['comptabilite.voir'],
        sensible: true,
      },
      {
        key: 'comptabilite.supprimer',
        label: 'Supprimer en comptabilité',
        description: 'Supprimer et restaurer des transactions, des commandes d’inventaire et des catégories.',
        requiert: ['comptabilite.voir'],
        sensible: true,
      },
    ],
  },
  {
    categorie: 'Outils',
    permissions: [
      // § Simulateur de rentabilité : calcul fait dans le navigateur, sans
      // aucune donnée de la boutique — d'où l'absence de `sensible`.
      {
        key: 'simulateur.utiliser',
        label: 'Simulateur de rentabilité',
        description: 'Simuler la rentabilité d’un produit avant de le lancer.',
      },
    ],
  },
  {
    categorie: 'Support',
    permissions: [
      { key: 'reclamations.voir', label: 'Consulter les réclamations', description: 'Voir les réclamations et leurs réponses.' },
      {
        key: 'reclamations.creer',
        label: 'Ouvrir une réclamation',
        description: 'Signaler un problème sur un colis.',
        requiert: ['reclamations.voir', 'colis.voir'],
      },
    ],
  },
  {
    categorie: 'Boutique & administration',
    permissions: [
      {
        key: 'integrations.gerer',
        label: 'Intégrations',
        description: 'Connecter ou déconnecter Shopify et YouCan, importer leurs commandes.',
        sensible: true,
      },
      {
        key: 'boutique.gerer',
        label: 'Profil de la boutique',
        description: 'Modifier les coordonnées, le RIB et les adresses de ramassage.',
        sensible: true,
      },
      {
        key: 'equipe.voir',
        label: 'Consulter l’équipe',
        description: 'Voir les membres, les rôles et le journal d’activité de l’équipe.',
      },
      {
        key: 'equipe.gerer',
        label: 'Gérer l’équipe',
        description: 'Ajouter, inviter, suspendre et retirer des membres ; créer et modifier des rôles.',
        requiert: ['equipe.voir'],
        sensible: true,
      },
    ],
  },
];

export const TOUTES_PERMISSIONS_MARCHAND: string[] = PERMISSIONS_MARCHAND.flatMap((c) =>
  c.permissions.map((p) => p.key)
);

const DEFS = new Map<string, PermissionMarchandDef>(
  PERMISSIONS_MARCHAND.flatMap((c) => c.permissions.map((p) => [p.key, p] as const))
);

export function definitionPermissionMarchand(key: string): PermissionMarchandDef | undefined {
  return DEFS.get(key);
}

export function libellePermissionMarchand(key: string): string {
  return DEFS.get(key)?.label ?? key;
}

// Ajoute, de proche en proche, les permissions que les clés fournies
// présupposent (cf. `requiert`).
export function completerDependances(keys: Iterable<string>): Set<string> {
  const resultat = new Set<string>();
  const pile = [...keys];
  while (pile.length > 0) {
    const k = pile.pop() as string;
    if (resultat.has(k) || !DEFS.has(k)) continue;
    resultat.add(k);
    for (const dep of DEFS.get(k)?.requiert ?? []) pile.push(dep);
  }
  return resultat;
}

// Clés dont la présence DÉPEND de `key` : décocher `key` doit les décocher
// aussi, faute de quoi la dépendance serait aussitôt réajoutée à
// l'enregistrement.
export function dependantsDe(key: string): string[] {
  const dependants = new Set<string>();
  let frontiere = [key];
  while (frontiere.length > 0) {
    const suivante: string[] = [];
    for (const def of DEFS.values()) {
      if (dependants.has(def.key)) continue;
      if (def.requiert?.some((r) => frontiere.includes(r))) {
        dependants.add(def.key);
        suivante.push(def.key);
      }
    }
    frontiere = suivante;
  }
  return [...dependants];
}

// Ne garde que les clés connues, complète les dépendances et remet le tout
// dans l'ordre du catalogue. Une clé retirée du catalogue mais restée en base
// n'accorde donc rien — même règle que sanitizePermissions côté back-office.
export function nettoyerPermissionsMarchand(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const connues = values.filter((v): v is string => typeof v === 'string' && DEFS.has(v));
  const completes = completerDependances(connues);
  return TOUTES_PERMISSIONS_MARCHAND.filter((k) => completes.has(k));
}

// --- Rôles prédéfinis ----------------------------------------------------
//
// Proposés à chaque boutique dès l'ouverture de l'écran Équipe (créés à la
// volée, cf. assurerRolesSysteme dans lib/equipe-marchand.ts). Leurs
// permissions sont lues ICI, jamais en base : un rôle prédéfini suit donc le
// catalogue quand il évolue, sans migration. Ils ne se modifient ni ne se
// suppriment — on les DUPLIQUE pour en faire un rôle personnalisé, comme dans
// la plupart des consoles d'administration.

export interface RoleSystemeDef {
  cle: string;
  nom: string;
  description: string;
  permissions: string[];
}

const LECTURE = TOUTES_PERMISSIONS_MARCHAND.filter((k) => k.endsWith('.voir'));

export const ROLES_SYSTEME_MARCHAND: RoleSystemeDef[] = [
  {
    cle: 'administrateur',
    nom: 'Administrateur',
    description: 'Tous les droits, y compris la gestion de l’équipe et du profil de la boutique.',
    permissions: [...TOUTES_PERMISSIONS_MARCHAND],
  },
  {
    // Le rôle que recevaient, sans le dire, les membres invités avant
    // l'introduction des rôles : accès complet aux données de la boutique,
    // mais pas à la gestion de l'équipe (réservée alors au titulaire). La
    // migration 20260928100000 le leur attribue — personne ne gagne ni ne
    // perd un accès le jour du déploiement.
    cle: 'gestionnaire',
    nom: 'Gestionnaire',
    description: 'Toute l’activité de la boutique, sans la gestion de l’équipe.',
    permissions: TOUTES_PERMISSIONS_MARCHAND.filter((k) => !k.startsWith('equipe.')),
  },
  {
    cle: 'operateur',
    nom: 'Opérateur colis',
    description: 'Saisie et suivi des colis, ramassages et réclamations. Aucune donnée financière.',
    permissions: nettoyerPermissionsMarchand([
      'colis.voir',
      'colis.creer',
      'colis.modifier',
      'catalogue.voir',
      'ramassages.demander',
      'bons.creer',
      'reclamations.creer',
    ]),
  },
  {
    cle: 'comptable',
    nom: 'Comptable',
    description: 'Tient la comptabilité de la boutique ; tableau de bord, factures, bons et export des colis en lecture.',
    permissions: nettoyerPermissionsMarchand([
      'tableau_de_bord.voir',
      'colis.exporter',
      'bons.voir',
      'factures.voir',
      'comptabilite.saisir',
      'comptabilite.modifier',
      'comptabilite.supprimer',
      'simulateur.utiliser',
    ]),
  },
  {
    cle: 'lecture',
    nom: 'Lecture seule',
    description: 'Consulte tout ce qui n’est pas financier, sans rien pouvoir modifier.',
    permissions: LECTURE.filter((k) => !definitionPermissionMarchand(k)?.sensible),
  },
];

export function roleSystemeMarchand(cle: string | null | undefined): RoleSystemeDef | undefined {
  if (!cle) return undefined;
  return ROLES_SYSTEME_MARCHAND.find((r) => r.cle === cle);
}

// Permissions réelles d'un rôle de boutique : le catalogue du code pour un
// rôle prédéfini, la liste stockée (nettoyée) pour un rôle personnalisé.
export function permissionsDuRole(role: { cle: string | null; permissions: string[] }): string[] {
  const systeme = roleSystemeMarchand(role.cle);
  return systeme ? [...systeme.permissions] : nettoyerPermissionsMarchand(role.permissions);
}

// --- Correspondance CHEMIN → PERMISSION, sur l'hôte marchand ---------------
//
// Même mécanique que lib/permission-routes.ts (motifs, première règle qui
// gagne, `null` = explicitement non gouverné), appliquée par le proxy sur le
// SEUL hôte marchand. Un chemin absent reste gouverné par `requireUser` et
// par le périmètre boutique, comme avant — ce qui convient aux lectures
// communes (session, villes, en-tête société, profil en lecture).

export interface RouteMarchand {
  pattern: string;
  permission: string | null;
  methods?: string[];
}

const LECTURES = ['GET', 'HEAD'];

export const PAGES_MARCHAND: RouteMarchand[] = [
  { pattern: '/marchand/colis/nouveau/**', permission: 'colis.creer' },
  { pattern: '/marchand/colis/import/**', permission: 'colis.creer' },
  { pattern: '/marchand/colis/relance/**', permission: 'colis.modifier' },
  { pattern: '/marchand/colis/marchandises/**', permission: 'catalogue.voir' },
  { pattern: '/marchand/colis/ramassage/**', permission: 'ramassages.demander' },
  { pattern: '/marchand/colis/**', permission: 'colis.voir' },
  { pattern: '/marchand/inventaire/nouveau/**', permission: 'catalogue.gerer' },
  { pattern: '/marchand/inventaire/**', permission: 'catalogue.voir' },
  { pattern: '/marchand/ramassages/**', permission: 'ramassages.voir' },
  { pattern: '/marchand/bons-livraison/nouveau/**', permission: 'bons.creer' },
  { pattern: '/marchand/bons-livraison/**', permission: 'bons.voir' },
  { pattern: '/marchand/bons-retour/**', permission: 'bons.voir' },
  { pattern: '/marchand/factures/**', permission: 'factures.voir' },
  { pattern: '/marchand/comptabilite/**', permission: 'comptabilite.voir' },
  { pattern: '/marchand/simulateur/**', permission: 'simulateur.utiliser' },
  { pattern: '/marchand/reclamations/**', permission: 'reclamations.voir' },
  { pattern: '/marchand/integrations/**', permission: 'integrations.gerer' },
  { pattern: '/marchand/equipe/**', permission: 'equipe.voir' },
  // Profil : ouvert à tous — chacun y gère son propre mot de passe. Les
  // sections de la boutique (coordonnées, RIB, adresses) s'y verrouillent à
  // l'écran, et leurs écritures sont gardées ci-dessous côté API.
  { pattern: '/marchand/profil/**', permission: null },
  { pattern: '/marchand/acces-refuse', permission: null },
  // Centre de notifications : celles du membre connecté et ses préférences,
  // jamais celles de la boutique. Ouvert à tous, comme le profil.
  { pattern: '/marchand/notifications/**', permission: null },
  { pattern: '/marchand', permission: 'tableau_de_bord.voir' },
];

export const API_MARCHAND: RouteMarchand[] = [
  { pattern: '/api/marchands/dashboard', permission: 'tableau_de_bord.voir' },
  // Lecture du profil : utilisée par tous les écrans (nom de boutique, état
  // d'activation). Seule l'écriture engage la boutique.
  { pattern: '/api/marchands/me', permission: null, methods: LECTURES },
  { pattern: '/api/marchands/me', permission: 'boutique.gerer' },
  { pattern: '/api/marchands/equipe/**', permission: 'equipe.gerer', methods: ['POST', 'PATCH', 'PUT', 'DELETE'] },
  { pattern: '/api/marchands/equipe/**', permission: 'equipe.voir' },
  // Adresses de ramassage : lues par l'écran de ramassage, gérées depuis le
  // profil de la boutique.
  { pattern: '/api/adresses/**', permission: null, methods: LECTURES },
  { pattern: '/api/adresses/**', permission: 'boutique.gerer' },

  { pattern: '/api/commandes/export', permission: 'colis.exporter' },
  { pattern: '/api/commandes/bulk-delete', permission: 'colis.supprimer' },
  { pattern: '/api/commandes/*/relancer', permission: 'colis.modifier' },
  { pattern: '/api/commandes/**', permission: 'colis.voir', methods: LECTURES },
  { pattern: '/api/commandes/*', permission: 'colis.supprimer', methods: ['DELETE'] },
  { pattern: '/api/commandes/*', permission: 'colis.modifier' },
  { pattern: '/api/commandes', permission: 'colis.creer' },

  { pattern: '/api/marchandises/**', permission: 'catalogue.voir', methods: LECTURES },
  { pattern: '/api/marchandises/**', permission: 'catalogue.gerer' },
  { pattern: '/api/produits/**', permission: 'catalogue.voir', methods: LECTURES },
  { pattern: '/api/produits/**', permission: 'catalogue.gerer' },

  { pattern: '/api/ramassages/**', permission: 'ramassages.voir', methods: LECTURES },
  { pattern: '/api/ramassages/**', permission: 'ramassages.demander' },
  { pattern: '/api/bons-livraison/**', permission: 'bons.voir', methods: LECTURES },
  { pattern: '/api/bons-livraison/**', permission: 'bons.creer' },
  { pattern: '/api/bons-retour/**', permission: 'bons.voir' },
  { pattern: '/api/factures/**', permission: 'factures.voir' },

  // § Comptabilité de la boutique : les routes du back-office, le livre de la
  // boutique étant choisi côté serveur (lib/comptabilite-perimetre.ts). Même
  // découpage que lib/permission-routes.ts, sous-routes nommées d'abord.
  { pattern: '/api/finance/categories', permission: 'comptabilite.modifier', methods: ['POST'] },
  { pattern: '/api/finance/categories/*', permission: 'comptabilite.modifier', methods: ['PATCH'] },
  { pattern: '/api/finance/categories/*', permission: 'comptabilite.supprimer', methods: ['DELETE'] },
  { pattern: '/api/finance/*/restaurer', permission: 'comptabilite.supprimer' },
  { pattern: '/api/finance/*', permission: 'comptabilite.modifier', methods: ['PATCH'] },
  { pattern: '/api/finance/*', permission: 'comptabilite.supprimer', methods: ['DELETE'] },
  { pattern: '/api/finance/**', permission: 'comptabilite.voir', methods: LECTURES },
  { pattern: '/api/finance/**', permission: 'comptabilite.saisir' },
  { pattern: '/api/simulations/**', permission: 'simulateur.utiliser' },
  { pattern: '/api/commandes-stock-hub/*/statut', permission: 'comptabilite.saisir' },
  { pattern: '/api/commandes-stock-hub/*/restaurer', permission: 'comptabilite.supprimer' },
  { pattern: '/api/commandes-stock-hub/*', permission: 'comptabilite.modifier', methods: ['PATCH'] },
  { pattern: '/api/commandes-stock-hub/*', permission: 'comptabilite.supprimer', methods: ['DELETE'] },
  { pattern: '/api/commandes-stock-hub/**', permission: 'comptabilite.voir', methods: LECTURES },
  { pattern: '/api/commandes-stock-hub/**', permission: 'comptabilite.saisir' },

  { pattern: '/api/reclamations/**', permission: 'reclamations.voir', methods: LECTURES },
  { pattern: '/api/reclamations/**', permission: 'reclamations.creer' },

  { pattern: '/api/integrations/**', permission: 'integrations.gerer' },

  // Cloche et préférences de push : celles du membre connecté, jamais celles
  // de la boutique. Ouvertes à tous, comme le profil — le tri de ce qu'il
  // reçoit est fait à l'envoi (destinatairesBoutique, lib/notifications.ts).
  { pattern: '/api/notifications/**', permission: null },

  // Liste des villes des champs de saisie (noms seuls) : tout membre qui
  // saisit un colis ou son profil en a besoin.
  { pattern: '/api/referentiel/**', permission: null },
];

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function correspond(pattern: string, segs: string[]): boolean {
  const parts = segments(pattern);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === '**') return true;
    if (i >= segs.length) return false;
    if (part === '*') continue;
    if (part !== segs[i]) return false;
  }
  return parts.length === segs.length;
}

function chercher(regles: RouteMarchand[], pathname: string, method: string): string | null {
  const segs = segments(pathname);
  const verbe = method.toUpperCase();
  for (const r of regles) {
    if (r.methods && !r.methods.includes(verbe)) continue;
    if (correspond(r.pattern, segs)) return r.permission;
  }
  return null;
}

export function permissionPageMarchand(pathname: string): string | null {
  return chercher(PAGES_MARCHAND, pathname, 'GET');
}

export function permissionApiMarchand(pathname: string, method: string): string | null {
  return chercher(API_MARCHAND, pathname, method);
}

// Première destination ouverte à ce membre, dans l'ordre de la navigation :
// là où le renvoyer quand il ouvre un écran qui lui est fermé (typiquement
// l'accueil, juste après la connexion, pour un rôle sans tableau de bord).
const DESTINATIONS: { href: string; permission: string }[] = [
  { href: '/marchand', permission: 'tableau_de_bord.voir' },
  { href: '/marchand/colis', permission: 'colis.voir' },
  { href: '/marchand/colis/marchandises', permission: 'catalogue.voir' },
  { href: '/marchand/ramassages', permission: 'ramassages.voir' },
  { href: '/marchand/bons-livraison', permission: 'bons.voir' },
  { href: '/marchand/factures', permission: 'factures.voir' },
  { href: '/marchand/comptabilite', permission: 'comptabilite.voir' },
  { href: '/marchand/reclamations', permission: 'reclamations.voir' },
  { href: '/marchand/integrations', permission: 'integrations.gerer' },
  { href: '/marchand/equipe', permission: 'equipe.voir' },
];

export function premiereDestinationMarchand(permissions: string[]): string {
  return DESTINATIONS.find((d) => permissions.includes(d.permission))?.href ?? '/marchand/acces-refuse';
}
