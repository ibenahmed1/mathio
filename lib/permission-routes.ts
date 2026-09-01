// Correspondance CHEMIN → PERMISSION REQUISE, pour les pages du back-office
// (/admin/**) comme pour les routes API qui les servent (/api/**).
//
// Module PUR (mêmes contraintes que lib/permissions.ts et lib/spaces.ts) : il
// est lu par le proxy, en edge runtime.
//
// --- Pourquoi une table centrale plutôt qu'un appel dans chaque handler ----
//
// Le contrôle d'accès existant est déjà appliqué en DEUX endroits indépendants
// (proxy.ts pour les pages, `requireUser([...])` dans chacune des ~170 routes)
// et c'est volontaire. Les permissions s'ajoutent comme une TROISIÈME couche,
// appliquée au seul endroit qui voit le chemin de CHAQUE requête : le proxy.
// Une table unique se relit et s'audite ; 170 appels dispersés, non. Les
// gardes par rôle existants ne sont pas remplacés — ils restent en place et
// continuent de s'appliquer (cf. requireUser dans lib/api-utils.ts).
//
// --- Deux règles qui gouvernent tout ce fichier ---------------------------
//
//  1. AUCUNE PERTE. Pour chaque chemin mappé ci-dessous, tous les rôles qui y
//     accèdent aujourd'hui détiennent la permission exigée dans leur jeu par
//     défaut (cf. ROLE_PERMISSIONS). Le jour du déploiement, personne ne perd
//     un écran.
//  2. AUCUN ÉLARGISSEMENT SILENCIEUX. Un chemin dont la permission naturelle
//     serait détenue par plus de monde que les rôles autorisés aujourd'hui
//     reçoit sa PROPRE clé — c'est ce qui a fait naître `colis:payment`,
//     `bon_envoi:create`, `poles:manage`, `villes:manage`, `societe:manage` —
//     ou reste explicitement non gouverné. Chaque cas est commenté sur place.
//
// Les chemins non mappés ne sont pas « ouverts » : ils sont simplement
// gouvernés par la couche rôle seule, comme avant.

// Motif de chemin découpé en segments. `*` remplace UN segment (typiquement un
// identifiant dynamique : /api/commandes/<uuid>/statut), `**` la fin du
// chemin. L'ORDRE du tableau fait foi : la première règle qui matche gagne,
// donc du plus spécifique au plus générique.
export interface PermissionRoute {
  pattern: string;
  // `null` = chemin EXPLICITEMENT non gouverné par le catalogue. Ce n'est pas
  // la même chose qu'une absence de règle : posée avant une règle générique,
  // une entrée `null` empêche celle-ci de happer un chemin qui doit rester à
  // sa garde par rôle. Sans elle, /api/commandes/scan-reception tomberait sous
  // la règle d'écriture de /api/commandes/* et exigerait `colis:update` — ce
  // qui fermerait le quai à l'agent hub, dont c'est l'unique écran.
  permission: string | null;
  // Méthodes HTTP concernées. Absent = toutes. Sert à distinguer la lecture de
  // l'écriture sur un même chemin (ex. /api/factures).
  methods?: string[];
}

const SAFE_METHODS = ['GET', 'HEAD'];

// --- Pages du back-office ---------------------------------------------------
export const PAGE_PERMISSIONS: PermissionRoute[] = [
  // Colis — les sous-chemins nommés d'abord, la règle générique ensuite.
  { pattern: '/admin/colis/nouveau/**', permission: 'colis:create' },
  { pattern: '/admin/colis/import/**', permission: 'colis:import' },
  { pattern: '/admin/colis/confirmation/**', permission: 'colis:confirm' },
  { pattern: '/admin/colis/suivi/**', permission: 'colis:track' },
  { pattern: '/admin/colis/modification/**', permission: 'colis:update' },
  // Tickets et e-tickets d'un colis : de la consultation.
  { pattern: '/admin/colis/**', permission: 'colis:read' },
  { pattern: '/admin/commandes/**', permission: 'colis:read' },

  // Statistiques — une clé par écran, comme demandé.
  { pattern: '/admin/statistique/tout/**', permission: 'stats:all' },
  { pattern: '/admin/statistique/client/**', permission: 'stats:client' },
  { pattern: '/admin/statistique/livreur/**', permission: 'stats:livreur' },
  { pattern: '/admin/statistique/zone/**', permission: 'stats:zone' },
  { pattern: '/admin/statistique/ville/**', permission: 'stats:ville' },
  { pattern: '/admin/statistique/comparer/**', permission: 'stats:compare' },

  // Gestion de stock
  { pattern: '/admin/stock/nouveaux/**', permission: 'stock:nouveaux' },
  { pattern: '/admin/stock/prets/**', permission: 'stock:prets' },
  { pattern: '/admin/stock/bons-preparation/**', permission: 'stock:bons_preparation' },
  { pattern: '/admin/stock/inventaire/**', permission: 'stock:inventory' },

  // Opérations hub & tournées. Composer un bon d'envoi et le consulter ne sont
  // pas le même droit : l'agent de quai réceptionne, il ne compose pas.
  { pattern: '/admin/bon-livraison/**', permission: 'bon_livraison:manage' },
  { pattern: '/admin/bon-envoi/creer/**', permission: 'bon_envoi:create' },
  { pattern: '/admin/bon-envoi/*/modifier/**', permission: 'bon_envoi:create' },
  { pattern: '/admin/bon-envoi/**', permission: 'bon_envoi:manage' },
  { pattern: '/admin/planification/**', permission: 'planification:manage' },
  { pattern: '/admin/bon-distribution/**', permission: 'bon_distribution:manage' },
  { pattern: '/admin/scan/tournee/**', permission: 'scan:tournee' },
  { pattern: '/admin/scan/reception/**', permission: 'scan:reception_hub' },

  // Bons de paiement
  { pattern: '/admin/bon-paiement/livreur/**', permission: 'paiement_livreur:manage' },
  { pattern: '/admin/bon-paiement/zone/**', permission: 'paiement_zone:manage' },

  // Bons de retour — une seule clé pour les trois écrans (livreur/zone/client),
  // conformément au catalogue.
  { pattern: '/admin/bon-retour/**', permission: 'bon_retour:manage' },

  // Facturation & comptabilité. L'écran de modification d'une facture
  // (/admin/factures/<id>/modifier) tombe volontairement sous `facture:read` :
  // la page s'ouvre, mais l'enregistrement passe par PATCH /api/factures/<id>,
  // qui exige `facture:create`, et l'émission par `facture:issue`.
  { pattern: '/admin/factures/nouvelle/**', permission: 'facture:create' },
  { pattern: '/admin/factures/**', permission: 'facture:read' },
  { pattern: '/admin/comptabilite/**', permission: 'comptabilite:read' },
  { pattern: '/admin/depenses/**', permission: 'comptabilite:read' },

  // Relations & support
  { pattern: '/admin/reclamations/**', permission: 'reclamations:manage' },
  { pattern: '/admin/marchands/**', permission: 'marchands:manage' },
  { pattern: '/admin/clients/**', permission: 'marchands:manage' },
  { pattern: '/admin/ramassages/**', permission: 'demande_ramassage:manage' },

  // Organisation & administration
  { pattern: '/admin/equipe/**', permission: 'users:manage' },
  { pattern: '/admin/tasks/**', permission: 'tasks:manage' },
  { pattern: '/admin/hubs/**', permission: 'hubs:manage' },
  { pattern: '/admin/parametres/**', permission: 'settings:manage' },

  // L'accueil en dernier : `/admin` exactement, une fois que tous les
  // sous-chemins ci-dessus ont eu leur chance.
  { pattern: '/admin', permission: 'dashboard:view' },
];

// --- Routes API du back-office ----------------------------------------------
//
// Ces règles ne s'appliquent QUE sur l'hôte de l'espace `admin` (cf. proxy.ts).
// Les mêmes routes appelées depuis le domaine marchand ou terrain ne
// consultent jamais ce tableau : leur cloisonnement est celui du domaine et de
// `requireUser`, inchangé.
export const API_PERMISSIONS: PermissionRoute[] = [
  // --- Colis ---------------------------------------------------------------
  { pattern: '/api/commandes/import/**', permission: 'colis:import' },
  { pattern: '/api/commandes/export', permission: 'colis:read' },

  // NON MAPPÉ — /api/commandes/scan-reception : le MÊME endpoint sert deux
  // postes distincts, l'agent de quai (entrée en hub) et le planner pendant le
  // scan de tournée (§ /admin/scan/tournee, cf. ses appels). L'exiger sous
  // `scan:reception_hub` retirerait le scan de tournée au planner ; le donner
  // au planner lui afficherait l'entrée « Scan Réception Hub » qu'il n'a pas
  // aujourd'hui. Reste gouverné par ses rôles (agent_hub, planner, admin) — la
  // permission `scan:reception_hub` ne garde alors que l'ÉCRAN.
  { pattern: '/api/commandes/scan-reception', permission: null },
  // NON MAPPÉ — /api/commandes/scan : c'est le scan de RAMASSAGE chez le
  // marchand (requireUser(['ramasseur','admin'])), un geste terrain que le
  // catalogue ne décrit pas. `scan:tournee` désignerait le mauvais poste.
  { pattern: '/api/commandes/scan', permission: null },

  { pattern: '/api/commandes/bulk-delete', permission: 'colis:delete' },
  { pattern: '/api/commandes/*/statut', permission: 'colis:confirm' },
  // Encaissement COD : sa propre clé, parce que le trio qui l'exerce
  // aujourd'hui (admin, superviseur, responsable) ne correspond ni à la
  // confirmation ni à la comptabilité.
  { pattern: '/api/commandes/*/paiement', permission: 'colis:payment' },
  // NON MAPPÉ — /api/commandes/*/relancer : réservé au marchand.
  { pattern: '/api/commandes/*/relancer', permission: null },
  { pattern: '/api/commandes/*/commentaires', permission: 'colis:read' },
  { pattern: '/api/commandes/*', permission: 'colis:read', methods: SAFE_METHODS },
  { pattern: '/api/commandes/*', permission: 'colis:delete', methods: ['DELETE'] },
  { pattern: '/api/commandes/*', permission: 'colis:update' },
  { pattern: '/api/commandes', permission: 'colis:read', methods: SAFE_METHODS },
  { pattern: '/api/commandes', permission: 'colis:create' },

  // --- Gestion de stock ----------------------------------------------------
  { pattern: '/api/stock/pret-pour-preparation/**', permission: 'stock:prets' },
  { pattern: '/api/bons-preparation/**', permission: 'stock:bons_preparation' },
  { pattern: '/api/produits/**', permission: 'stock:inventory' },
  { pattern: '/api/marchandises/**', permission: 'stock:inventory' },
  // Colis en stock au hub : servi par la comptabilité (admin + responsable),
  // pas par le module stock — on garde ce périmètre.
  { pattern: '/api/commandes-stock-hub/**', permission: 'comptabilite:read', methods: SAFE_METHODS },
  { pattern: '/api/commandes-stock-hub/**', permission: 'comptabilite:write' },

  // --- Opérations hub & tournées -------------------------------------------
  { pattern: '/api/bons-livraison/**', permission: 'bon_livraison:manage' },
  // L'ordre porte ici toute la distinction consulter/réceptionner (agent de
  // quai) vs composer (admin) : les trois endpoints de composition d'abord,
  // puis la réception et les lectures, puis tout le reste en composition.
  { pattern: '/api/bons-envoi/colis-eligibles', permission: 'bon_envoi:create' },
  { pattern: '/api/bons-envoi/destinations', permission: 'bon_envoi:create' },
  { pattern: '/api/bons-envoi/verifier-colis', permission: 'bon_envoi:create' },
  { pattern: '/api/bons-envoi/*/marquer-recu', permission: 'bon_envoi:manage' },
  { pattern: '/api/bons-envoi/*', permission: 'bon_envoi:manage', methods: SAFE_METHODS },
  { pattern: '/api/bons-envoi', permission: 'bon_envoi:manage', methods: SAFE_METHODS },
  { pattern: '/api/bons-envoi/**', permission: 'bon_envoi:create' },
  { pattern: '/api/bons-distribution/**', permission: 'bon_distribution:manage' },
  { pattern: '/api/bons-retour/**', permission: 'bon_retour:manage' },

  // --- Bons de paiement ----------------------------------------------------
  // Une seule règle pour les deux clés : côté API, rien ne distingue un bon
  // « pour livreur » d'un bon « pour zone » — c'est le même endpoint. La
  // distinction n'existe qu'à l'écran (cf. PAGE_PERMISSIONS).
  { pattern: '/api/bons-paiement/**', permission: 'paiement_livreur:manage' },

  // --- Facturation & comptabilité ------------------------------------------
  // Émettre, encaisser et annuler engagent la société : clé distincte de la
  // rédaction d'un brouillon.
  { pattern: '/api/factures/*/emettre', permission: 'facture:issue' },
  { pattern: '/api/factures/*/payer', permission: 'facture:issue' },
  { pattern: '/api/factures/*/annuler', permission: 'facture:issue' },
  { pattern: '/api/factures/**', permission: 'facture:read', methods: SAFE_METHODS },
  { pattern: '/api/factures/**', permission: 'facture:create' },
  { pattern: '/api/finance/**', permission: 'comptabilite:read', methods: SAFE_METHODS },
  { pattern: '/api/finance/**', permission: 'comptabilite:write' },

  // --- Relations & support -------------------------------------------------
  { pattern: '/api/reclamations/**', permission: 'reclamations:manage' },
  { pattern: '/api/ramassages/**', permission: 'demande_ramassage:manage' },
  // L'impersonation a sa propre clé : elle ouvre les données réelles d'un
  // client, ce que « gérer les marchands » ne dit pas.
  { pattern: '/api/marchands/*/impersonation', permission: 'marchands:impersonate' },
  { pattern: '/api/marchands/**', permission: 'marchands:manage' },

  // --- Organisation & administration ---------------------------------------
  { pattern: '/api/utilisateurs/**', permission: 'users:manage' },
  { pattern: '/api/hubs/**', permission: 'hubs:manage' },
  // § Sous-traitance : un prestataire n'est que l'autre face du réseau de hubs
  // (ses agences SONT des hubs, cf. Hub.prestataireId) et se gère sur le même
  // écran — même clé, donc, plutôt qu'une permission de plus à cocher.
  { pattern: '/api/prestataires/**', permission: 'hubs:manage' },
  // Pôles du Kanban : le cycle de vie d'un pôle (créer, renommer, supprimer)
  // et l'affectation de ses membres n'ont jamais eu le même public — d'où deux
  // clés. Les deux règles nommées passent AVANT la règle générique des pôles,
  // elle-même avant celle des tâches.
  { pattern: '/api/taches/equipes/*/membres/**', permission: 'poles:members' },
  { pattern: '/api/taches/equipes', permission: 'poles:members', methods: SAFE_METHODS },
  { pattern: '/api/taches/equipes/**', permission: 'poles:manage' },
  { pattern: '/api/taches/**', permission: 'tasks:manage' },
  // `settings:manage` n'ouvre que l'ÉCRAN des paramètres, que tout le
  // back-office possède : ce qui s'y écrit a ses propres clés, réservées.
  { pattern: '/api/villes/**', permission: 'villes:manage' },
  { pattern: '/api/parametres/societe', permission: 'societe:manage', methods: ['PUT', 'POST', 'PATCH'] },
  // NON MAPPÉ — GET /api/parametres/societe : lu par toutes les vues
  // d'impression (en-tête des bons et des factures) et ouvert à toute session
  // authentifiée. Le gouverner fermerait l'impression à la moitié des rôles.
  { pattern: '/api/parametres/societe', permission: null },
];

function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function patternMatches(pattern: string, segments: string[]): boolean {
  const parts = segmentsOf(pattern);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === '**') return true;
    if (i >= segments.length) return false;
    if (part === '*') continue;
    if (part !== segments[i]) return false;
  }
  return parts.length === segments.length;
}

function lookup(rules: PermissionRoute[], pathname: string, method: string): string | null {
  const segments = segmentsOf(pathname);
  const verb = method.toUpperCase();
  for (const rule of rules) {
    if (rule.methods && !rule.methods.includes(verb)) continue;
    if (patternMatches(rule.pattern, segments)) return rule.permission;
  }
  return null;
}

// Permission exigée par une PAGE du back-office, ou `null` si le chemin n'est
// pas gouverné par le catalogue (il reste alors protégé par le garde de rôle
// du proxy et par le layout).
export function pagePermissionFor(pathname: string): string | null {
  return lookup(PAGE_PERMISSIONS, pathname, 'GET');
}

// Permission exigée par une ROUTE API appelée depuis l'espace `admin`, ou
// `null` (cf. les blocs « NON MAPPÉ » ci-dessus).
export function apiPermissionFor(pathname: string, method: string): string | null {
  return lookup(API_PERMISSIONS, pathname, method);
}
