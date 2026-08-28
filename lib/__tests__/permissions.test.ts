import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  ROLE_PERMISSIONS,
  effectivePermissions,
  sanitizePermissions,
} from '../permissions';
import { API_PERMISSIONS, PAGE_PERMISSIONS, apiPermissionFor, pagePermissionFor } from '../permission-routes';
import { permissionAutorise } from '../api-utils';

// ------------------------------------------------------------
// Cohérence interne du catalogue
// ------------------------------------------------------------

test('aucune clé du catalogue n’est déclarée deux fois', () => {
  assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
});

test('toute clé suit la forme "module:action"', () => {
  for (const cle of ALL_PERMISSIONS) {
    assert.match(cle, /^[a-z_]+:[a-z_]+$/, `clé mal formée : ${cle}`);
  }
});

// Un renvoi vers une clé disparue laisserait un écran inaccessible à tout le
// monde, en silence : c'est le genre d'erreur qu'on ne voit qu'en production.
test('toutes les règles de routage désignent une permission qui existe', () => {
  for (const regle of [...PAGE_PERMISSIONS, ...API_PERMISSIONS]) {
    // `null` est une valeur légitime : le chemin est explicitement laissé à sa
    // garde par rôle (cf. PermissionRoute).
    if (regle.permission === null) continue;
    assert.ok(ALL_PERMISSIONS.includes(regle.permission), `permission inconnue : ${regle.permission}`);
  }
});

test('tous les jeux par défaut ne contiennent que des clés du catalogue', () => {
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const cle of perms) {
      assert.ok(ALL_PERMISSIONS.includes(cle), `${role} détient une clé inconnue : ${cle}`);
    }
  }
});

test('l’admin détient le catalogue entier', () => {
  assert.deepEqual([...ROLE_PERMISSIONS.admin].sort(), [...ALL_PERMISSIONS].sort());
});

// Les espaces marchand et terrain ne sont pas gouvernés par le catalogue : leur
// donner des permissions laisserait croire l'inverse.
test('les rôles hors back-office n’ont aucune permission', () => {
  for (const role of ['marchand', 'livreur', 'ramasseur'] as const) {
    assert.deepEqual(ROLE_PERMISSIONS[role], []);
  }
});

// ------------------------------------------------------------
// Résolution des permissions effectives
// ------------------------------------------------------------

test('la liste stockée fait foi pour un non-admin', () => {
  assert.deepEqual(effectivePermissions('superviseur', ['colis:read']), ['colis:read']);
});

// Le décochage doit pouvoir tout retirer : un repli sur le jeu par défaut du
// rôle rendrait le retrait du dernier accès impossible.
test('une liste vide ne retombe pas sur le jeu par défaut du rôle', () => {
  assert.deepEqual(effectivePermissions('superviseur', []), []);
  assert.deepEqual(effectivePermissions('planner', null), []);
});

// Sans cette exception, ajouter une clé au catalogue rendrait le module
// inaccessible à tout le monde jusqu'à ce qu'un admin se la coche — impossible
// pour `users:manage`, qui est justement la clé de cet écran.
test('l’admin détient tout, quoi que contienne sa colonne', () => {
  assert.deepEqual(effectivePermissions('admin', []).sort(), [...ALL_PERMISSIONS].sort());
  assert.deepEqual(effectivePermissions('admin', ['colis:read']).sort(), [...ALL_PERMISSIONS].sort());
});

test('sanitizePermissions écarte les clés inconnues, les doublons et le non-texte', () => {
  assert.deepEqual(sanitizePermissions(['colis:read', 'colis:read', 'inexistant:x', 42, null]), ['colis:read']);
  assert.deepEqual(sanitizePermissions('colis:read'), []);
  assert.deepEqual(sanitizePermissions(undefined), []);
});

// ------------------------------------------------------------
// Résolution chemin → permission
// ------------------------------------------------------------

test('un sous-chemin nommé gagne sur la règle générique du module', () => {
  assert.equal(pagePermissionFor('/admin/colis/nouveau'), 'colis:create');
  assert.equal(pagePermissionFor('/admin/colis/import'), 'colis:import');
  assert.equal(pagePermissionFor('/admin/colis/confirmation'), 'colis:confirm');
  // …et le reste du module retombe sur la lecture.
  assert.equal(pagePermissionFor('/admin/colis/abc-123/ticket'), 'colis:read');
});

test('l’accueil n’attrape que lui-même', () => {
  assert.equal(pagePermissionFor('/admin'), 'dashboard:view');
  assert.equal(pagePermissionFor('/admin/comptabilite'), 'comptabilite:read');
});

test('les six écrans de statistiques ont chacun leur clé', () => {
  assert.equal(pagePermissionFor('/admin/statistique/tout'), 'stats:all');
  assert.equal(pagePermissionFor('/admin/statistique/client'), 'stats:client');
  assert.equal(pagePermissionFor('/admin/statistique/livreur'), 'stats:livreur');
  assert.equal(pagePermissionFor('/admin/statistique/zone'), 'stats:zone');
  assert.equal(pagePermissionFor('/admin/statistique/ville'), 'stats:ville');
  assert.equal(pagePermissionFor('/admin/statistique/comparer'), 'stats:compare');
});

test('un chemin hors catalogue ne réclame aucune permission', () => {
  assert.equal(pagePermissionFor('/login'), null);
  assert.equal(pagePermissionFor('/marchand/colis'), null);
  assert.equal(apiPermissionFor('/api/auth/me', 'GET'), null);
});

// Le segment dynamique d'un identifiant ne doit pas faire retomber la requête
// sur la règle du module : PATCH /api/commandes/<uuid> est une écriture.
test('la lecture et l’écriture d’un même chemin ne demandent pas la même clé', () => {
  assert.equal(apiPermissionFor('/api/commandes', 'GET'), 'colis:read');
  assert.equal(apiPermissionFor('/api/commandes', 'POST'), 'colis:create');
  assert.equal(apiPermissionFor('/api/commandes/abc-123', 'GET'), 'colis:read');
  assert.equal(apiPermissionFor('/api/commandes/abc-123', 'PATCH'), 'colis:update');
  assert.equal(apiPermissionFor('/api/commandes/abc-123', 'DELETE'), 'colis:delete');
  assert.equal(apiPermissionFor('/api/commandes/bulk-delete', 'POST'), 'colis:delete');
  assert.equal(apiPermissionFor('/api/factures/abc-123', 'GET'), 'facture:read');
  assert.equal(apiPermissionFor('/api/factures/abc-123', 'PATCH'), 'facture:create');
  // Émettre / encaisser / annuler : gestes engageants, clé à part.
  assert.equal(apiPermissionFor('/api/factures/abc-123/emettre', 'POST'), 'facture:issue');
  assert.equal(apiPermissionFor('/api/factures/abc-123/payer', 'POST'), 'facture:issue');
  assert.equal(apiPermissionFor('/api/factures/abc-123/annuler', 'POST'), 'facture:issue');
  // La comptabilité lit et écrit : deux clés.
  assert.equal(apiPermissionFor('/api/finance', 'GET'), 'comptabilite:read');
  assert.equal(apiPermissionFor('/api/finance', 'POST'), 'comptabilite:write');
  assert.equal(apiPermissionFor('/api/finance/abc-123/annuler', 'POST'), 'comptabilite:write');
});

test('l’encaissement COD a sa propre clé', () => {
  assert.equal(apiPermissionFor('/api/commandes/abc-123/paiement', 'PATCH'), 'colis:payment');
});

// Composer un bon d'envoi n'est pas le réceptionner : c'est toute la raison
// d'être de la scission bon_envoi:manage / bon_envoi:create. L'agent de quai
// ne détient que la première.
test('l’agent hub réceptionne un bon d’envoi mais n’en compose pas', () => {
  const agentHub = ROLE_PERMISSIONS.agent_hub;
  const reception: [string, string][] = [
    ['/api/bons-envoi', 'GET'],
    ['/api/bons-envoi/abc-123', 'GET'],
    ['/api/bons-envoi/abc-123/marquer-recu', 'POST'],
  ];
  for (const [chemin, methode] of reception) {
    const requise = apiPermissionFor(chemin, methode);
    assert.equal(requise, 'bon_envoi:manage', `${methode} ${chemin}`);
    assert.ok(agentHub.includes(requise), `l'agent hub perdrait ${methode} ${chemin}`);
  }

  const composition: [string, string][] = [
    ['/api/bons-envoi', 'POST'],
    ['/api/bons-envoi/abc-123', 'PATCH'],
    ['/api/bons-envoi/abc-123/export', 'GET'],
    ['/api/bons-envoi/colis-eligibles', 'GET'],
    ['/api/bons-envoi/destinations', 'GET'],
    ['/api/bons-envoi/verifier-colis', 'POST'],
  ];
  for (const [chemin, methode] of composition) {
    const requise = apiPermissionFor(chemin, methode);
    assert.equal(requise, 'bon_envoi:create', `${methode} ${chemin}`);
    assert.ok(!agentHub.includes(requise), `l'agent hub gagnerait ${methode} ${chemin}`);
  }
  assert.equal(pagePermissionFor('/admin/bon-envoi/creer'), 'bon_envoi:create');
  assert.equal(pagePermissionFor('/admin/bon-envoi/abc-123/modifier'), 'bon_envoi:create');
  assert.equal(pagePermissionFor('/admin/bon-envoi'), 'bon_envoi:manage');
});

// L'impersonation ouvre les données réelles d'un client : elle ne doit pas
// être un effet de bord du droit de modifier une fiche marchand.
test('l’impersonation a sa propre clé', () => {
  assert.equal(apiPermissionFor('/api/marchands/abc-123/impersonation', 'POST'), 'marchands:impersonate');
  assert.equal(apiPermissionFor('/api/marchands/abc-123', 'PATCH'), 'marchands:manage');
});

// Le cycle de vie d'un pôle est réservé à l'admin (ROLE_GESTION_POLES) ;
// l'affectation des membres est ouverte à ROLES_GESTION_EQUIPES, qui exclut
// planner et agent_hub. Une clé unique aurait ouvert la première au second.
test('les pôles du Kanban distinguent le cycle de vie de l’affectation', () => {
  assert.equal(apiPermissionFor('/api/taches/equipes', 'POST'), 'poles:manage');
  assert.equal(apiPermissionFor('/api/taches/equipes/abc-123', 'PATCH'), 'poles:manage');
  assert.equal(apiPermissionFor('/api/taches/equipes/abc-123', 'DELETE'), 'poles:manage');
  assert.equal(apiPermissionFor('/api/taches/equipes', 'GET'), 'poles:members');
  assert.equal(apiPermissionFor('/api/taches/equipes/abc-123/membres', 'PUT'), 'poles:members');
  assert.equal(apiPermissionFor('/api/taches/equipes/abc-123/membres/xyz', 'DELETE'), 'poles:members');
  // Les tâches elles-mêmes restent sous tasks:manage.
  assert.equal(apiPermissionFor('/api/taches', 'GET'), 'tasks:manage');
  assert.equal(apiPermissionFor('/api/taches/abc-123', 'PATCH'), 'tasks:manage');

  for (const role of ['superviseur', 'moderateur', 'equipe_suivi', 'responsable', 'design', 'gestionnaire_hub'] as const) {
    assert.ok(ROLE_PERMISSIONS[role].includes('poles:members'), `${role} perdrait l'affectation des membres`);
    assert.ok(!ROLE_PERMISSIONS[role].includes('poles:manage'), `${role} gagnerait la création de pôles`);
  }
  assert.ok(!ROLE_PERMISSIONS.planner.includes('poles:members'));
});

// `settings:manage` n'ouvre que l'écran, que tout le back-office possède : ce
// qui s'y écrit doit rester réservé.
test('ouvrir les paramètres et y écrire ne sont pas la même clé', () => {
  assert.equal(pagePermissionFor('/admin/parametres'), 'settings:manage');
  assert.equal(apiPermissionFor('/api/villes', 'POST'), 'villes:manage');
  assert.equal(apiPermissionFor('/api/villes/abc-123', 'DELETE'), 'villes:manage');
  assert.equal(apiPermissionFor('/api/parametres/societe', 'PUT'), 'societe:manage');
  // La lecture reste ouverte : les vues d'impression en dépendent.
  assert.equal(apiPermissionFor('/api/parametres/societe', 'GET'), null);

  for (const role of ['superviseur', 'responsable', 'moderateur', 'equipe_suivi', 'planner'] as const) {
    assert.ok(ROLE_PERMISSIONS[role].includes('settings:manage'), `${role} perdrait l'écran des paramètres`);
    assert.ok(!ROLE_PERMISSIONS[role].includes('villes:manage'), `${role} gagnerait la gestion des villes`);
    assert.ok(!ROLE_PERMISSIONS[role].includes('societe:manage'), `${role} gagnerait les données de société`);
  }
});

test('le changement de statut d’un colis relève de la confirmation', () => {
  assert.equal(apiPermissionFor('/api/commandes/abc-123/statut', 'PATCH'), 'colis:confirm');
});

// Ces chemins sont délibérément laissés à leur garde par rôle (cf. les blocs
// « NON MAPPÉ » de lib/permission-routes.ts) : le scan de réception sert deux
// postes à la fois, le scan de ramassage est un geste terrain, la relance
// appartient au marchand, et l'en-tête de société est lu par toutes les vues
// d'impression. Les mapper retirerait le scan de tournée au planner, ou
// fermerait l'impression à la moitié des rôles.
test('les chemins volontairement non mappés le restent', () => {
  assert.equal(apiPermissionFor('/api/commandes/scan-reception', 'POST'), null);
  assert.equal(apiPermissionFor('/api/commandes/scan-reception', 'GET'), null);
  assert.equal(apiPermissionFor('/api/commandes/scan', 'POST'), null);
  assert.equal(apiPermissionFor('/api/commandes/abc-123/relancer', 'POST'), null);
  assert.equal(apiPermissionFor('/api/parametres/societe', 'GET'), null);
});

// ------------------------------------------------------------
// Aucune perte d'accès pour les comptes existants
// ------------------------------------------------------------
//
// Chaque paire ci-dessous rejoue un écran qu'un rôle ouvrait AVANT
// l'introduction des permissions (cf. l'ancienne navigation par rôle) : la
// migration ne doit fermer aucune porte le jour du déploiement.
const ACCES_HISTORIQUES: [string, string][] = [
  ['superviseur', '/admin/colis/import'],
  ['superviseur', '/admin/colis/confirmation'],
  ['superviseur', '/admin/statistique/tout'],
  ['superviseur', '/admin/reclamations'],
  ['responsable', '/admin/comptabilite'],
  ['responsable', '/admin/factures/toutes'],
  ['responsable', '/admin/bon-paiement/livreur'],
  ['responsable', '/admin/bon-paiement/zone'],
  ['moderateur', '/admin/colis/confirmation'],
  ['moderateur', '/admin/reclamations'],
  ['equipe_suivi', '/admin/commandes'],
  ['planner', '/admin/planification'],
  ['planner', '/admin/bon-distribution'],
  ['planner', '/admin/scan/tournee'],
  ['planner', '/admin/bon-retour/livreur'],
  ['agent_hub', '/admin/scan/reception'],
  ['agent_hub', '/admin/bon-envoi'],
  ['design', '/admin/tasks'],
  ['gestionnaire_hub', '/admin/tasks'],
];

test('aucun rôle ne perd un écran qu’il ouvrait avant les permissions', () => {
  for (const [role, chemin] of ACCES_HISTORIQUES) {
    const requise = pagePermissionFor(chemin);
    assert.ok(requise, `${chemin} devrait être gouverné par une permission`);
    assert.ok(
      ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS].includes(requise),
      `${role} perdrait l'accès à ${chemin} (il lui manque ${requise})`
    );
  }
});

// L'écran de réception liste les colis reçus du jour (GET /api/commandes) :
// sans `colis:read`, la page s'ouvre mais reste vide.
test('l’agent hub garde la lecture des colis dont son écran a besoin', () => {
  const requise = apiPermissionFor('/api/commandes', 'GET');
  assert.ok(requise && ROLE_PERMISSIONS.agent_hub.includes(requise));
});

// ------------------------------------------------------------
// La migration et le code doivent rester d'accord
// ------------------------------------------------------------
//
// Le remplissage initial est écrit en SQL, donc hors de portée du typage : si
// ROLE_PERMISSIONS évolue sans que la migration suive, les comptes déjà en base
// gardent l'ancien jeu, en silence. Ce test compare les deux.
// Les migrations sont rejouées dans l'ordre, comme le ferait Postgres : la
// première AFFECTE (`= ARRAY[...]`), les suivantes CONCATÈNENT (`= permissions
// || ARRAY[...]`). L'état reconstitué doit être celui de ROLE_PERMISSIONS.
const MIGRATIONS_PERMISSIONS = [
  '20260828120000_permissions_back_office',
  '20260828140000_permissions_complements',
];

test('le remplissage SQL des migrations correspond à ROLE_PERMISSIONS', () => {
  const etat = new Map<string, string[]>();

  for (const dossier of MIGRATIONS_PERMISSIONS) {
    const sql = readFileSync(join(__dirname, '..', '..', 'prisma', 'migrations', dossier, 'migration.sql'), 'utf8');
    const blocs = [...sql.matchAll(/SET "permissions" = ("permissions" \|\| )?ARRAY\[([\s\S]*?)\]\s*WHERE ([^;]+);/g)];
    assert.ok(blocs.length > 0, `aucun bloc de remplissage dans ${dossier}`);

    for (const [, concatene, liste, condition] of blocs) {
      const cles = liste
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
      const roles = [...condition.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      assert.ok(roles.length > 0, `condition sans rôle : ${condition}`);
      for (const role of roles) {
        etat.set(role, concatene ? [...(etat.get(role) ?? []), ...cles] : cles);
      }
    }
  }

  for (const [role, cles] of etat) {
    assert.deepEqual(
      [...cles].sort(),
      [...ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]].sort(),
      `le remplissage SQL de "${role}" diverge de ROLE_PERMISSIONS`
    );
  }

  // Tout rôle back-office ayant un jeu par défaut non vide doit être couvert
  // par les migrations : en oublier un le laisserait sans aucun accès en base.
  for (const [role, cles] of Object.entries(ROLE_PERMISSIONS)) {
    if (cles.length === 0) continue;
    assert.ok(etat.has(role), `le rôle "${role}" n'est rempli par aucune migration`);
  }
});

// ------------------------------------------------------------
// Le catalogue affiché et les clés réelles ne doivent pas diverger
// ------------------------------------------------------------

test('chaque permission porte un libellé et une description non vides', () => {
  for (const cat of PERMISSION_CATALOG) {
    assert.ok(cat.category.length > 0);
    assert.ok(cat.permissions.length > 0, `catégorie vide : ${cat.category}`);
    for (const p of cat.permissions) {
      assert.ok(p.label.length > 0, `libellé manquant : ${p.key}`);
      assert.ok(p.description.length > 0, `description manquante : ${p.key}`);
    }
  }
});

// ------------------------------------------------------------
// L'octroi par permission dans requireUser
// ------------------------------------------------------------
//
// C'est la règle qui donne son sens aux cases à cocher : sans elle, cocher
// « Comptabilité » ouvrirait l'écran mais toutes ses données répondraient 403,
// puisque les ~170 routes gardent leur liste de rôles d'origine.

test('la permission du chemin ouvre une route back-office que le rôle ne couvre pas', () => {
  // GET /api/finance : requireUser(['admin','responsable']). Un superviseur à
  // qui on a coché « Comptabilité » doit passer.
  assert.equal(
    permissionAutorise({ permissions: ['comptabilite:read'] }, ['admin', 'responsable'], 'comptabilite:read'),
    true
  );
});

test('sans la permission du chemin, rien ne s’ouvre', () => {
  assert.equal(permissionAutorise({ permissions: ['colis:read'] }, ['admin'], 'comptabilite:read'), false);
});

// Le header est posé par le proxy à partir du chemin courant : une permission
// détenue par ailleurs ne doit pas servir de passe-partout.
test('un chemin non gouverné n’ouvre rien, même avec le catalogue entier', () => {
  assert.equal(permissionAutorise({ permissions: [...ALL_PERMISSIONS] }, ['admin'], null), false);
});

// Le garde-fou décisif : une route réservée au marchand ou au terrain suppose
// une session de cet espace (périmètre boutique, tournée du jour). L'ouvrir à
// un compte back-office la ferait s'effondrer — et ferait franchir à une
// permission une frontière d'espace.
test('aucune permission n’ouvre une route réservée au marchand ou au terrain', () => {
  const tout = { permissions: [...ALL_PERMISSIONS] };
  assert.equal(permissionAutorise(tout, ['marchand'], 'stock:inventory'), false);
  assert.equal(permissionAutorise(tout, ['livreur'], 'colis:read'), false);
  assert.equal(permissionAutorise(tout, ['ramasseur', 'marchand'], 'colis:read'), false);
  // Dès qu'un rôle back-office figure dans la liste, la route est bien du
  // ressort du catalogue — même si elle est aussi ouverte au marchand.
  assert.equal(permissionAutorise(tout, ['admin', 'marchand'], 'colis:read'), true);
});

// Un compte à qui l'on coche TOUT doit atteindre chaque module gouverné par le
// catalogue — c'est l'exigence de départ.
test('toutes les permissions ouvrent tous les chemins gouvernés', () => {
  const tout = { permissions: [...ALL_PERMISSIONS] };
  const chemins: [string, string][] = [
    ['/api/commandes', 'GET'],
    ['/api/factures', 'GET'],
    ['/api/finance', 'GET'],
    ['/api/bons-paiement', 'GET'],
    ['/api/produits/abc-123', 'PATCH'],
    ['/api/utilisateurs', 'GET'],
    ['/api/hubs', 'GET'],
    ['/api/marchands', 'GET'],
  ];
  for (const [chemin, methode] of chemins) {
    const requise = apiPermissionFor(chemin, methode);
    assert.ok(requise, `${methode} ${chemin} devrait être gouverné`);
    assert.ok(tout.permissions.includes(requise), `${requise} manque au catalogue`);
    // Toutes ces routes autorisent l'admin, donc contiennent un rôle back-office.
    assert.equal(permissionAutorise(tout, ['admin'], requise), true);
  }
});
