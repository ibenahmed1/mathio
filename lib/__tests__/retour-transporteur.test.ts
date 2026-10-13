import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATUTS_ELIGIBLES_RETOUR } from '../statuts';
import { DELAI_ALERTE_RETOUR_JOURS, joursEcoules, retourEnAlerte } from '../retour-transporteur';

const DECLARE = new Date('2026-10-10T09:00:00Z');

test('le délai d’alerte est de 3 jours (décision du 11/10/2026)', () => {
  assert.equal(DELAI_ALERTE_RETOUR_JOURS, 3);
});

test('l’alerte part au 3e jour plein, pas avant', () => {
  assert.equal(retourEnAlerte(DECLARE, new Date('2026-10-13T08:59:00Z')), false);
  assert.equal(retourEnAlerte(DECLARE, new Date('2026-10-13T09:00:00Z')), true);
  assert.equal(joursEcoules(DECLARE, new Date('2026-10-15T12:00:00Z')), 5);
});

// Un colis en échec chez EST n'a jamais de déclaration : il est listé, mais
// sans date de départ il ne peut pas être en alerte.
test('sans déclaration, jamais d’alerte', () => {
  assert.equal(retourEnAlerte(null, new Date('2027-01-01T00:00:00Z')), false);
});

// Le scan pose `retourne_au_hub` : c'est ce qui ouvre le bon de retour.
test('un retour reçu au hub est éligible au bon de retour', () => {
  assert.ok(STATUTS_ELIGIBLES_RETOUR.includes('retourne_au_hub'));
});
