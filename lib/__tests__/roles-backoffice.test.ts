import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyserRole, FONCTIONS_ROLE_PERSONNALISE } from '../roles-backoffice';

const creation = { creation: true, predefini: false };

test('création : nom et fonction de base exigés', () => {
  assert.equal(analyserRole({ fonction: 'superviseur' }, creation).statut, 'refus');
  assert.equal(analyserRole({ nom: 'Stats' }, creation).statut, 'refus');
  const ok = analyserRole({ nom: '  Stats  ', fonction: 'superviseur', permissions: ['stats:all'] }, creation);
  assert.equal(ok.statut, 'ok');
  if (ok.statut === 'ok') assert.deepEqual(ok.valeur, { nom: 'Stats', fonction: 'superviseur', permissions: ['stats:all'] });
});

test('un rôle personnalisé ne repose que sur une fonction du back-office', () => {
  assert.ok(!FONCTIONS_ROLE_PERSONNALISE.includes('livreur'));
  assert.ok(!FONCTIONS_ROLE_PERSONNALISE.includes('admin'));
  assert.equal(analyserRole({ nom: 'X', fonction: 'livreur' }, creation).statut, 'refus');
  assert.equal(analyserRole({ nom: 'X', fonction: 'admin' }, creation).statut, 'refus');
});

test('les permissions inconnues sont ignorées, pas accordées', () => {
  const r = analyserRole({ nom: 'X', fonction: 'moderateur', permissions: ['colis:read', 'n_existe:pas'] }, creation);
  assert.equal(r.statut, 'ok');
  if (r.statut === 'ok') assert.deepEqual(r.valeur.permissions, ['colis:read']);
});

test('prédéfini : nom et fonction ignorés, droits et description modifiables', () => {
  const r = analyserRole(
    { nom: 'Pirate', fonction: 'responsable', description: 'Revu', permissions: ['colis:read'] },
    { creation: false, predefini: true, fonctionActuelle: 'moderateur' }
  );
  assert.equal(r.statut, 'ok');
  if (r.statut === 'ok') assert.deepEqual(r.valeur, { description: 'Revu', permissions: ['colis:read'] });
});

test('un rôle terrain n’a pas de permissions du back-office', () => {
  const r = analyserRole({ permissions: ['colis:read'] }, { creation: false, predefini: true, fonctionActuelle: 'livreur' });
  assert.equal(r.statut, 'refus');
});
