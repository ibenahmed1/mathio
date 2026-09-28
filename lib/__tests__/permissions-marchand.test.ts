import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ALL_PERMISSIONS } from '../permissions';
import {
  API_MARCHAND,
  PAGES_MARCHAND,
  PERMISSIONS_MARCHAND,
  ROLES_SYSTEME_MARCHAND,
  TOUTES_PERMISSIONS_MARCHAND,
  completerDependances,
  dependantsDe,
  nettoyerPermissionsMarchand,
  permissionApiMarchand,
  permissionPageMarchand,
  permissionsDuRole,
  premiereDestinationMarchand,
} from '../permissions-marchand';

// ------------------------------------------------------------
// Cohérence du catalogue
// ------------------------------------------------------------

test('aucune clé marchande n’est déclarée deux fois', () => {
  assert.equal(new Set(TOUTES_PERMISSIONS_MARCHAND).size, TOUTES_PERMISSIONS_MARCHAND.length);
});

test('les clés marchandes et celles du back-office sont disjointes', () => {
  // Les deux catalogues transitent par SessionPayload.permissions : une clé
  // commune ferait lire un droit de boutique comme un droit du back-office.
  const admin = new Set(ALL_PERMISSIONS);
  for (const k of TOUTES_PERMISSIONS_MARCHAND) {
    assert.ok(!admin.has(k), `${k} existe aussi côté back-office`);
    assert.ok(!k.includes(':'), `${k} emprunte la syntaxe du back-office`);
  }
});

test('chaque dépendance déclarée existe au catalogue', () => {
  for (const cat of PERMISSIONS_MARCHAND) {
    for (const p of cat.permissions) {
      for (const dep of p.requiert ?? []) {
        assert.ok(TOUTES_PERMISSIONS_MARCHAND.includes(dep), `${p.key} requiert ${dep}, inconnue`);
      }
    }
  }
});

test('chaque permission citée dans les tables de routes existe au catalogue', () => {
  for (const r of [...PAGES_MARCHAND, ...API_MARCHAND]) {
    if (r.permission) assert.ok(TOUTES_PERMISSIONS_MARCHAND.includes(r.permission), `${r.pattern} → ${r.permission}`);
  }
});

// ------------------------------------------------------------
// Dépendances
// ------------------------------------------------------------

test('créer un colis entraîne la consultation des colis et du catalogue', () => {
  const s = completerDependances(['colis.creer']);
  assert.ok(s.has('colis.voir'));
  assert.ok(s.has('catalogue.voir'));
});

test('retirer une permission retire ce qui en dépend', () => {
  const d = dependantsDe('colis.voir');
  assert.ok(d.includes('colis.creer'));
  assert.ok(d.includes('bons.creer'));
  assert.ok(d.includes('reclamations.creer'));
  assert.ok(!d.includes('factures.voir'));
});

test('nettoyer : clés inconnues ignorées, dépendances ajoutées, ordre du catalogue', () => {
  const r = nettoyerPermissionsMarchand(['equipe.gerer', 'n.importe.quoi', 42, 'colis:read']);
  assert.deepEqual(r, ['equipe.voir', 'equipe.gerer']);
  assert.deepEqual(nettoyerPermissionsMarchand('pas un tableau'), []);
});

// ------------------------------------------------------------
// Rôles prédéfinis
// ------------------------------------------------------------

test('les rôles prédéfinis sont stables et cohérents', () => {
  const cles = ROLES_SYSTEME_MARCHAND.map((r) => r.cle);
  assert.equal(new Set(cles).size, cles.length);
  for (const r of ROLES_SYSTEME_MARCHAND) {
    assert.deepEqual(r.permissions, nettoyerPermissionsMarchand(r.permissions), `${r.cle} n’est pas « propre »`);
    assert.ok(r.permissions.length > 0, `${r.cle} n’accorde rien`);
  }
});

test('« Gestionnaire » reproduit l’accès des membres d’avant les rôles : tout sauf l’équipe', () => {
  const g = ROLES_SYSTEME_MARCHAND.find((r) => r.cle === 'gestionnaire');
  assert.ok(g);
  assert.ok(!g.permissions.some((k) => k.startsWith('equipe.')));
  assert.equal(g.permissions.length, TOUTES_PERMISSIONS_MARCHAND.length - 2);
});

test('« Lecture seule » n’accorde ni écriture ni droit sensible', () => {
  const l = ROLES_SYSTEME_MARCHAND.find((r) => r.cle === 'lecture');
  assert.ok(l);
  for (const k of l.permissions) assert.ok(k.endsWith('.voir'), k);
  assert.ok(!l.permissions.includes('factures.voir'));
  assert.ok(!l.permissions.includes('tableau_de_bord.voir'));
});

test('un rôle prédéfini lit ses droits dans le code, pas en base', () => {
  const lu = permissionsDuRole({ cle: 'administrateur', permissions: [] });
  assert.deepEqual(lu, TOUTES_PERMISSIONS_MARCHAND);
  const perso = permissionsDuRole({ cle: null, permissions: ['colis.creer', 'inconnue'] });
  assert.deepEqual(perso, ['colis.voir', 'colis.creer', 'catalogue.voir']);
});

// ------------------------------------------------------------
// Table des routes
// ------------------------------------------------------------

test('pages : chaque module a sa clé, le profil reste ouvert', () => {
  assert.equal(permissionPageMarchand('/marchand'), 'tableau_de_bord.voir');
  assert.equal(permissionPageMarchand('/marchand/colis'), 'colis.voir');
  assert.equal(permissionPageMarchand('/marchand/colis/nouveau'), 'colis.creer');
  assert.equal(permissionPageMarchand('/marchand/colis/abc/ticket'), 'colis.voir');
  assert.equal(permissionPageMarchand('/marchand/colis/marchandises'), 'catalogue.voir');
  assert.equal(permissionPageMarchand('/marchand/bons-livraison/nouveau'), 'bons.creer');
  assert.equal(permissionPageMarchand('/marchand/factures'), 'factures.voir');
  assert.equal(permissionPageMarchand('/marchand/equipe'), 'equipe.voir');
  assert.equal(permissionPageMarchand('/marchand/profil'), null);
  assert.equal(permissionPageMarchand('/marchand/acces-refuse'), null);
});

test('API : lecture et écriture distinguées', () => {
  assert.equal(permissionApiMarchand('/api/commandes', 'GET'), 'colis.voir');
  assert.equal(permissionApiMarchand('/api/commandes', 'POST'), 'colis.creer');
  assert.equal(permissionApiMarchand('/api/commandes/abc', 'PATCH'), 'colis.modifier');
  assert.equal(permissionApiMarchand('/api/commandes/abc', 'DELETE'), 'colis.supprimer');
  assert.equal(permissionApiMarchand('/api/commandes/bulk-delete', 'POST'), 'colis.supprimer');
  assert.equal(permissionApiMarchand('/api/commandes/export', 'GET'), 'colis.exporter');
  assert.equal(permissionApiMarchand('/api/commandes/abc/relancer', 'POST'), 'colis.modifier');
  assert.equal(permissionApiMarchand('/api/marchands/me', 'GET'), null);
  assert.equal(permissionApiMarchand('/api/marchands/me', 'PATCH'), 'boutique.gerer');
  assert.equal(permissionApiMarchand('/api/adresses', 'GET'), null);
  assert.equal(permissionApiMarchand('/api/adresses', 'POST'), 'boutique.gerer');
  assert.equal(permissionApiMarchand('/api/marchands/equipe', 'GET'), 'equipe.voir');
  assert.equal(permissionApiMarchand('/api/marchands/equipe/journal', 'GET'), 'equipe.voir');
  assert.equal(permissionApiMarchand('/api/marchands/equipe/membres', 'POST'), 'equipe.gerer');
  assert.equal(permissionApiMarchand('/api/marchands/equipe/roles/x', 'DELETE'), 'equipe.gerer');
  assert.equal(permissionApiMarchand('/api/integrations/youcan/callback', 'GET'), 'integrations.gerer');
  assert.equal(permissionApiMarchand('/api/auth/me', 'GET'), null);
});

test('chaque page marchande existante est couverte par une règle explicite', () => {
  // Une page ajoutée sans règle resterait ouverte à tout membre : ce test
  // oblige à trancher. `null` explicite compte comme une décision.
  const racine = join(__dirname, '..', '..', 'app', 'marchand');
  const pages: string[] = [];
  const parcourir = (dir: string, chemin: string) => {
    for (const nom of readdirSync(dir)) {
      const complet = join(dir, nom);
      if (statSync(complet).isDirectory()) parcourir(complet, `${chemin}/${nom.startsWith('[') ? 'x' : nom}`);
      else if (nom === 'page.tsx') pages.push(chemin);
    }
  };
  parcourir(racine, '/marchand');
  const motifs = [...PAGES_MARCHAND];
  for (const p of pages) {
    const couverte = motifs.some((r) => {
      const parts = r.pattern.split('/').filter(Boolean);
      const segs = p.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i += 1) {
        if (parts[i] === '**') return true;
        if (i >= segs.length) return false;
        if (parts[i] !== '*' && parts[i] !== segs[i]) return false;
      }
      return parts.length === segs.length;
    });
    assert.ok(couverte, `${p} n’a aucune règle dans PAGES_MARCHAND`);
  }
});

// ------------------------------------------------------------
// Redirections
// ------------------------------------------------------------

test('la destination de repli est toujours ouverte au membre (pas de boucle)', () => {
  const jeux = [
    ...ROLES_SYSTEME_MARCHAND.map((r) => r.permissions),
    ['equipe.voir'],
    ['factures.voir'],
    ['catalogue.voir'],
    [],
  ];
  for (const perms of jeux) {
    const dest = premiereDestinationMarchand(perms);
    const requise = permissionPageMarchand(dest);
    assert.ok(!requise || perms.includes(requise), `${dest} exige ${requise}, absent de [${perms.join(', ')}]`);
  }
  assert.equal(premiereDestinationMarchand([]), '/marchand/acces-refuse');
});
