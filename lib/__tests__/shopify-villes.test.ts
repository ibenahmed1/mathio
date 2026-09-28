import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleVille, distanceEdition, rapprocherVille } from '../shopify-villes';

// Extrait du référentiel réel (base locale, 2026-09-26), orthographe comprise.
const VILLES = [
  'Casablanca',
  'Rabat',
  'Sale',
  'Safi',
  'Marrakech',
  'Tanger',
  'Fès',
  'meknes',
  'Tétouan',
  'El Jadida',
  'Kenitra',
  'Agadir',
  'Oujda',
  'Oujda (Centre & Quartiers)',
  'Laayoune',
  'Nador Ville',
  "M'diq",
  'Sidi moussa - Marrakech',
  'Ajdir-Taza',
].map((nom, i) => ({ id: `v${i}`, nom }));

function nomRetenu(saisie: string): string | null {
  return rapprocherVille(saisie, VILLES)?.nom ?? null;
}

test('clé : casse, accents, ponctuation et espaces', () => {
  assert.equal(cleVille('  Fès  '), 'fes');
  assert.equal(cleVille('TÉTOUAN'), 'tetouan');
  assert.equal(cleVille("M'diq"), 'm diq');
  assert.equal(cleVille('Ajdir-Taza'), 'ajdir taza');
});

test('rapprochement exact', () => {
  assert.equal(rapprocherVille('casablanca', VILLES)?.methode, 'exacte');
  assert.equal(nomRetenu('FES'), 'Fès');
  assert.equal(nomRetenu('Meknès'), 'meknes');
  assert.equal(nomRetenu('m diq'), "M'diq");
  assert.equal(nomRetenu('Ajdir Taza'), 'Ajdir-Taza');
  // Le nom complet est préféré à sa forme courte.
  assert.equal(nomRetenu('Oujda'), 'Oujda');
});

test('alias : abréviations, noms anglais, noms arabes', () => {
  assert.equal(rapprocherVille('Casa', VILLES)?.methode, 'alias');
  assert.equal(nomRetenu('Casa'), 'Casablanca');
  assert.equal(nomRetenu('Marrakesh'), 'Marrakech');
  assert.equal(nomRetenu('Tangier'), 'Tanger');
  assert.equal(nomRetenu('Fez'), 'Fès');
  assert.equal(nomRetenu('الدار البيضاء'), 'Casablanca');
  assert.equal(nomRetenu('مراكش'), 'Marrakech');
  assert.equal(nomRetenu('Nador'), 'Nador Ville');
  assert.equal(nomRetenu('Casablanca, Maroc'), 'Casablanca');
});

test('fautes de frappe tolérées quand le candidat est unique', () => {
  assert.equal(rapprocherVille('Casablnca', VILLES)?.methode, 'approchee');
  assert.equal(nomRetenu('Casablnca'), 'Casablanca');
  assert.equal(nomRetenu('Marakech'), 'Marrakech');
  assert.equal(nomRetenu('Kenitraa'), 'Kenitra');
});

// Un rapprochement FAUX enverrait le colis au mauvais hub sans que personne ne
// le voie : dans le doute, pas de rapprochement.
test('pas de devinette : mots courts, ambiguïtés, inconnues', () => {
  // « Sali » est à une lettre de « Sale » ET de « Safi » — et trop court de toute façon.
  assert.equal(nomRetenu('Sali'), null);
  assert.equal(nomRetenu('Paris'), null);
  assert.equal(nomRetenu(''), null);
  assert.equal(nomRetenu('   '), null);
});

test('distance d’édition bornée', () => {
  assert.equal(distanceEdition('marrakech', 'marakech', 2), 1);
  assert.equal(distanceEdition('abc', 'abc', 0), 0);
  assert.equal(distanceEdition('casablanca', 'rabat', 2), 3); // abandon au-delà de la borne
});
