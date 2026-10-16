import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resoudreDansListePower } from '../power-delivery-villes';

// § BE exceptionnel vers Power (16/10/2026) : ville cherchée dans leur liste
// complète (GET listcities) quand notre table ne la connaît pas.

const LISTE = [
  { id: 4373, city: 'Agadir' },
  { id: 5101, city: 'OUARZAZATE' },
  { id: 5289, city: 'Ait Amira' },
  { id: 7001, city: 'Sidi bou othmane ' },
  { id: 7002, city: "Ksar El-Kébir" },
  { id: 6458, city: 'ouargui' },
  { id: 6542, city: 'ouargui' },
];

test('nom identique : identifiant de leur liste, nom de chez eux gardé', () => {
  const r = resoudreDansListePower(LISTE, 'Agadir');
  assert.equal(r?.cityId, 4373);
  assert.equal(r?.nomPower, 'Agadir');
  assert.equal(r?.ville, 'Agadir');
});

test('casse, accents, espaces, tirets et apostrophes ignorés', () => {
  assert.equal(resoudreDansListePower(LISTE, 'ouarzazate')?.cityId, 5101);
  assert.equal(resoudreDansListePower(LISTE, ' Aït  Amira ')?.cityId, 5289);
  assert.equal(resoudreDansListePower(LISTE, 'sidi bou othmane')?.cityId, 7001);
  assert.equal(resoudreDansListePower(LISTE, 'ksar el kebir')?.cityId, 7002);
});

test('plusieurs identifiants pour un même nom : rien n’est choisi', () => {
  assert.equal(resoudreDansListePower(LISTE, 'ouargui'), null);
});

test('ville absente ou vide : null, jamais un voisin', () => {
  assert.equal(resoudreDansListePower(LISTE, 'Agadi'), null);
  assert.equal(resoudreDansListePower(LISTE, 'ait mlloul'), null);
  assert.equal(resoudreDansListePower(LISTE, '  '), null);
  assert.equal(resoudreDansListePower([], 'Agadir'), null);
});

test('correspondance « exacte » : l’adresse n’est pas complétée', () => {
  assert.equal(resoudreDansListePower(LISTE, 'Agadir')?.groupe, 'exact');
});
