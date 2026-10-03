import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normaliserVille } from '../hub-stock';
import {
  CORRESPONDANCES_VILLES_COLIVRAISON,
  VILLES_COLIVRAISON_SANS_CORRESPONDANCE,
  adresseLivraisonColivraison,
  resoudreVilleColivraison,
  resoudreVilleToutesAgencesColivraison,
} from '../colivraison-villes';

const cle = (agence: string, ville: string) => `${agence}|${normaliserVille(ville)}`;

// 132 = les villes de « coliv.pdf » et de « ZONE DARAA TAFILLAT.csv », importées
// par scripts/import-prestataire-colivraison.ts. Aucune sans sort décidé, et
// depuis le 03/10/2026 toutes remettables par l'API.
test('les 132 villes Colivraison ont toutes un sort décidé', () => {
  assert.equal(CORRESPONDANCES_VILLES_COLIVRAISON.length, 132);
  assert.equal(VILLES_COLIVRAISON_SANS_CORRESPONDANCE.length, 0);
});

// Chaque rattachement est une décision de l'exploitation, jamais une déduction.
test('seules Ahl Merbaa, Faryata, Boulanouare et Tachrafat sont rattachées', () => {
  assert.deepEqual(
    CORRESPONDANCES_VILLES_COLIVRAISON.filter((c) => c.groupe === 'rattachee')
      .map((c) => [c.agence, c.ville])
      .sort(),
    [
      ['Agence Béni Mellal', 'Ahl Merbaa'],
      ['Agence Béni Mellal', 'Faryata'],
      ['Agence Khouribga', 'Boulanouare'],
      ['Agence Khouribga', 'Tachrafat'],
    ]
  );
});

// Une localité rattachée part sous la ville de SON agence, jamais une voisine.
test('une localité rattachée part sous la ville de son agence', () => {
  const villeAgence: Record<string, string> = { 'Agence Béni Mellal': 'Beni Mellal', 'Agence Khouribga': 'Khouribga' };
  for (const c of CORRESPONDANCES_VILLES_COLIVRAISON.filter((c) => c.groupe === 'rattachee')) {
    const centre = resoudreVilleColivraison(c.agence, villeAgence[c.agence]);
    assert.ok(centre && centre.groupe === 'exact', c.agence);
    assert.equal(c.cityId, centre.cityId, c.ville);
    assert.equal(c.nomColivraison, centre.nomColivraison, c.ville);
  }
  // Boulanouare n'est pas rapprochée de « Boulanoir » sans leur confirmation.
  assert.equal(resoudreVilleColivraison('Agence Khouribga', 'Boulanouare')?.cityId, 1424);
});

// Le nom de la ville d'agence, porté par une ligne rattachée, ne doit pas
// résoudre vers cette ligne : « Beni Mellal » reste Beni Mellal.
test('la ville d’agence se résout vers sa propre ligne, pas vers une localité rattachée', () => {
  assert.equal(resoudreVilleColivraison('Agence Béni Mellal', 'Beni mellal')?.ville, 'Beni Mellal');
  assert.equal(resoudreVilleToutesAgencesColivraison('Khouribga')?.ville, 'Khouribga');
  assert.equal(resoudreVilleToutesAgencesColivraison('Tachrafat')?.cityId, 1424);
});

test('une localité rattachée ajoute son nom à l’adresse, sans le répéter', () => {
  const faryata = resoudreVilleColivraison('Agence Béni Mellal', 'Faryata');
  assert.equal(adresseLivraisonColivraison(' Douar Ouled Ali ', faryata), 'Douar Ouled Ali, Faryata');
  assert.equal(adresseLivraisonColivraison('', faryata), 'Faryata');
  assert.equal(adresseLivraisonColivraison('Centre FARYATA', faryata), 'Centre FARYATA');
  assert.equal(
    adresseLivraisonColivraison(' Hay Salam ', resoudreVilleColivraison('Agence Khouribga', 'Khouribga')),
    'Hay Salam'
  );
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
