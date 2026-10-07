import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleRecherche, proposerVilles } from '../recherche-ville';

const LISTE = ['Casablanca', 'Fès', 'Taza Ville', 'Tazarine', 'Al Hoceima Ville', 'Oujda', "Ras El Ma (Cap de l'Eau)", 'Dar bouazza'].map(
  (nom) => ({ valeur: nom, libelle: nom })
);
const noms = (saisie: string) => proposerVilles(saisie, LISTE).map((o) => o.libelle);

test('casse et accents ne comptent pas', () => {
  assert.equal(cleRecherche('  FÈS  '), 'fes');
  assert.deepEqual(noms('fes'), ['Fès']);
  assert.deepEqual(noms('CASA'), ['Casablanca']);
});

test('le début du nom passe avant un mot, puis avant le milieu', () => {
  // « taza » : Taza Ville et Tazarine commencent par la saisie.
  assert.deepEqual(noms('taza'), ['Taza Ville', 'Tazarine']);
  // « hoceima » : seul un MOT commence par la saisie.
  assert.deepEqual(noms('hoceima'), ['Al Hoceima Ville']);
  // « ouazz » : au milieu d'un mot, en dernier recours.
  assert.deepEqual(noms('ouazz'), ['Dar bouazza']);
});

test('ponctuation et parenthèses sont ignorées', () => {
  assert.deepEqual(noms('cap de l eau'), ["Ras El Ma (Cap de l'Eau)"]);
});

test('saisie vide : toute la liste ; rien ne correspond : liste vide', () => {
  assert.equal(proposerVilles('', LISTE).length, LISTE.length);
  assert.deepEqual(noms('xyz'), []);
});
