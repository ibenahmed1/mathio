import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normaliserVille } from '../hub-stock';
import {
  CORRESPONDANCES_VILLES_COLIVRAISON,
  VILLES_COLIVRAISON_SANS_CORRESPONDANCE,
  resoudreVilleColivraison,
  resoudreVilleToutesAgencesColivraison,
} from '../colivraison-villes';

const cle = (agence: string, ville: string) => `${agence}|${normaliserVille(ville)}`;

// 132 = les villes de « coliv.pdf » et de « ZONE DARAA TAFILLAT.csv », importées
// par scripts/import-prestataire-colivraison.ts. Aucune sans sort décidé.
test('les 132 villes Colivraison ont toutes un sort décidé', () => {
  assert.equal(CORRESPONDANCES_VILLES_COLIVRAISON.length, 128);
  assert.equal(VILLES_COLIVRAISON_SANS_CORRESPONDANCE.length, 4);
});

test('une ville n’apparaît qu’une fois par agence', () => {
  const cles = [...CORRESPONDANCES_VILLES_COLIVRAISON, ...VILLES_COLIVRAISON_SANS_CORRESPONDANCE].map((c) =>
    cle(c.agence, c.ville)
  );
  assert.equal(new Set(cles).size, cles.length);
});

test('une correspondance exacte porte bien le même nom des deux côtés', () => {
  for (const c of CORRESPONDANCES_VILLES_COLIVRAISON.filter((c) => c.groupe === 'exact')) {
    assert.equal(normaliserVille(c.ville), normaliserVille(c.nomColivraison), `${c.agence} · ${c.ville}`);
  }
});

test('la résolution se fait dans l’agence, casse et accents repliés', () => {
  assert.equal(resoudreVilleColivraison('Agence Béni Mellal', '  BÉNI MELLAL ')?.cityId, 47);
  assert.equal(resoudreVilleColivraison('Agence Béni Mellal', 'aourir bm')?.nomColivraison, 'Aourir-bm');
  assert.equal(resoudreVilleColivraison('Agence Ouarzazate', 'MHAMID GHIZLANE')?.nomColivraison, 'Mhamid ghizlane-oarz');
  // Leur propre graphie, recopiée par un marchand, est reconnue aussi.
  assert.equal(resoudreVilleColivraison('Agence Ouarzazate', 'Tinzouline-oarz')?.cityId, 263);
  // Pas dans cette agence : pas de correspondance.
  assert.equal(resoudreVilleColivraison('Agence Khouribga', 'Aourir BM'), null);
});

test('une ville mise de côté ne se résout jamais', () => {
  for (const v of VILLES_COLIVRAISON_SANS_CORRESPONDANCE) {
    assert.equal(resoudreVilleColivraison(v.agence, v.ville), null, `${v.agence} · ${v.ville}`);
    assert.equal(resoudreVilleToutesAgencesColivraison(v.ville), null, v.ville);
  }
});

test('sans agence, une ville unique se résout', () => {
  assert.equal(resoudreVilleToutesAgencesColivraison('Kasba Tadla')?.agence, 'Agence Béni Mellal');
  assert.equal(resoudreVilleToutesAgencesColivraison('Ville inconnue'), null);
});
