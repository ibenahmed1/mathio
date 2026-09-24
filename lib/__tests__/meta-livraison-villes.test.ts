import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normaliserVille } from '../hub-stock';
import {
  CITY_ID_AGENCES_META,
  CORRESPONDANCES_VILLES_META,
  adresseLivraisonMeta,
  resoudreVilleMeta,
} from '../meta-livraison-villes';

// ------------------------------------------------------------
// Intégrité du fichier
// ------------------------------------------------------------

test('les 106 villes Meta du référentiel sont couvertes', () => {
  assert.equal(CORRESPONDANCES_VILLES_META.length, 106);
});

test('une ville n’apparaît qu’une fois par agence', () => {
  const cles = CORRESPONDANCES_VILLES_META.map((c) => `${c.agence}|${normaliserVille(c.ville)}`);
  assert.equal(new Set(cles).size, cles.length);
});

test('toute agence citée a sa ville d’agence déclarée', () => {
  for (const c of CORRESPONDANCES_VILLES_META) {
    assert.ok(CITY_ID_AGENCES_META[c.agence], `agence sans ville d’agence : ${c.agence}`);
  }
});

test('une correspondance exacte porte bien le même nom des deux côtés', () => {
  for (const c of CORRESPONDANCES_VILLES_META.filter((c) => c.groupe === 'exact')) {
    assert.equal(normaliserVille(c.ville), normaliserVille(c.nomMeta), c.ville);
  }
});

test('une localité rattachée part toujours vers la ville de SON agence', () => {
  for (const c of CORRESPONDANCES_VILLES_META.filter((c) => c.groupe === 'rattachee')) {
    assert.equal(c.cityId, CITY_ID_AGENCES_META[c.agence], `${c.agence} · ${c.ville}`);
  }
});

// Les homonymes lointains que la proposition automatique avait retenus. Aucun
// ne dessert le Nord-Est : les voir réapparaître voudrait dire qu'un colis de
// Taza ou de Meknès part à l'autre bout du pays.
test('aucun des pièges relevés au rapprochement n’est retenu', () => {
  const pieges: Record<number, string> = {
    235: 'Boujdour',
    400: 'Marzouga',
    512: 'Sidi Ali Azemmour',
    144: 'Ain Harrouda',
    406: 'Mejjat - Marrakech',
    551: 'Taddart - Agadir',
    533: 'Sidi slimane',
    344: 'Issaguen',
    165: 'Akchour',
  };
  for (const c of CORRESPONDANCES_VILLES_META) {
    assert.ok(!(c.cityId in pieges), `${c.ville} → ${pieges[c.cityId]}`);
  }
});

// ------------------------------------------------------------
// Résolution à l'envoi
// ------------------------------------------------------------

test('la résolution ignore casse et accents', () => {
  assert.equal(resoudreVilleMeta('Agence Meknès', 'Meknès')?.cityId, 409);
  assert.equal(resoudreVilleMeta('Agence Taounate', '  TAOUNATE ')?.cityId, 577);
});

test('la résolution est confinée à l’agence de destination', () => {
  assert.equal(resoudreVilleMeta('Agence Taza', 'meknes'), null);
});

test('une ville inconnue ne se résout pas', () => {
  assert.equal(resoudreVilleMeta('Agence Taza', 'Casablanca'), null);
});

// ------------------------------------------------------------
// Adresse
// ------------------------------------------------------------

test('une localité rattachée est ajoutée à l’adresse', () => {
  const c = resoudreVilleMeta('Agence Taounate', 'mazraoua')!;
  assert.equal(adresseLivraisonMeta('Douar Ouled Ali', c), 'Douar Ouled Ali, mazraoua');
});

test('la localité n’est pas répétée si l’adresse la cite déjà', () => {
  const c = resoudreVilleMeta('Agence Taounate', 'mazraoua')!;
  assert.equal(adresseLivraisonMeta('Douar Ouled Ali, Mazraoua', c), 'Douar Ouled Ali, Mazraoua');
});

test('une adresse vide devient le nom de la localité', () => {
  const c = resoudreVilleMeta('Agence Taza', 'bouhlou')!;
  assert.equal(adresseLivraisonMeta('  ', c), 'bouhlou');
});

test('l’adresse d’une ville connue d’eux reste intacte', () => {
  const c = resoudreVilleMeta('Agence Meknès', 'lhajeb')!;
  assert.equal(adresseLivraisonMeta(' 12 rue X ', c), '12 rue X');
});
