import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normaliserTelephone } from '../auth';

// § Téléphones des comptes (décision du 16/10/2026) : marocains ET
// internationaux, une seule écriture stockée par numéro.

test('un numéro marocain garde le format historique 0XXXXXXXXX', () => {
  for (const saisie of ['0612345678', '06 12 34 56 78', '06-12-34-56-78', '+212612345678', '+212 6 12 34 56 78', '00212612345678', '212612345678', '+212 0612345678']) {
    assert.equal(normaliserTelephone(saisie), '0612345678', saisie);
  }
  assert.equal(normaliserTelephone('0522123456'), '0522123456');
  assert.equal(normaliserTelephone('0712345678'), '0712345678');
});

test('un numéro international est stocké en E.164', () => {
  assert.equal(normaliserTelephone('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(normaliserTelephone('0033612345678'), '+33612345678');
  assert.equal(normaliserTelephone('+1 (415) 555-2671'), '+14155552671');
  assert.equal(normaliserTelephone('+34 612 34 56 78'), '+34612345678');
  assert.equal(normaliserTelephone('+971 50 123 4567'), '+971501234567');
});

test('un numéro non reconnu est refusé', () => {
  for (const saisie of [
    '',
    '12345',
    '612345678', // sans 0 ni indicatif : ambigu
    '0812345678', // préfixe marocain inconnu
    '061234567', // trop court
    '+212912345678', // indicatif marocain, numéro invalide
    '+0612345678', // pas d'indicatif pays commençant par 0
    '+1234567', // moins de 8 chiffres
    '+1234567890123456', // plus de 15 chiffres
    'zéro six',
  ]) {
    assert.equal(normaliserTelephone(saisie), null, saisie);
  }
});
