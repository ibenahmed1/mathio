import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normaliserVille } from '../hub-stock';
import {
  CORRESPONDANCES_VILLES_POWER,
  VILLES_POWER_SANS_CORRESPONDANCE,
  resoudreVillePower,
} from '../power-delivery-villes';

const cle = (agence: string, ville: string) => `${agence}|${normaliserVille(ville)}`;

// ------------------------------------------------------------
// Intégrité du fichier
// ------------------------------------------------------------

// 91 = les 90 lignes de « ville Power.pdf » + « El Jadida », ville
// d'implantation de l'agence ajoutée par scripts/ajouter-villes-agences.ts.
// Une ville Power qui n'apparaît dans AUCUNE des deux listes serait une ville
// dont personne n'a décidé du sort.
test('les 91 villes Power du référentiel ont toutes un sort décidé', () => {
  assert.equal(CORRESPONDANCES_VILLES_POWER.length, 85);
  assert.equal(VILLES_POWER_SANS_CORRESPONDANCE.length, 6);
});

test('une ville n’apparaît qu’une fois par agence', () => {
  const cles = CORRESPONDANCES_VILLES_POWER.map((c) => cle(c.agence, c.ville));
  assert.equal(new Set(cles).size, cles.length);
});

// Une ville à la fois rapprochée et mise de côté : la résolution trouverait
// l'identifiant, et la mise à l'écart ne protégerait plus rien.
test('une ville mise de côté n’a pas de correspondance', () => {
  const rapprochees = new Set(CORRESPONDANCES_VILLES_POWER.map((c) => cle(c.agence, c.ville)));
  for (const v of VILLES_POWER_SANS_CORRESPONDANCE) {
    assert.ok(!rapprochees.has(cle(v.agence, v.ville)), `${v.agence} · ${v.ville}`);
  }
});

test('une correspondance exacte porte bien le même nom des deux côtés', () => {
  for (const c of CORRESPONDANCES_VILLES_POWER.filter((c) => c.groupe === 'exact')) {
    assert.equal(normaliserVille(c.ville), normaliserVille(c.nomPower), c.ville);
  }
});

// Le groupe `orthographe` est une décision humaine, pas une tolérance : toute
// nouvelle entrée doit être ajoutée ici en connaissance de cause.
test('seule « l jadida » est rapprochée malgré une autre graphie', () => {
  const orthographe = CORRESPONDANCES_VILLES_POWER.filter((c) => c.groupe === 'orthographe');
  assert.deepEqual(
    orthographe.map((c) => [c.ville, c.cityId]),
    [['l jadida', 4247]]
  );
});

// Les doublons de LEUR base gardent chacun leur identifiant : décider que c'est
// la même ville leur appartient.
test('les doublons de leur base ne sont pas fusionnés', () => {
  assert.equal(resoudreVillePower('Agence Marrakech', 'ait aourir')?.cityId, 5353);
  assert.equal(resoudreVillePower('Agence Marrakech', 'Aït ourir')?.cityId, 5658);
  assert.equal(resoudreVillePower('Agence Marrakech', 'tamelelt')?.cityId, 6437);
  assert.equal(resoudreVillePower('Agence Marrakech', 'Tamallalt')?.cityId, 6054);
});

// Les homonymes et voisins qu'un rapprochement approximatif aurait retenus.
// Chacun enverrait un colis ailleurs que chez son destinataire.
test('aucun des pièges relevés au rapprochement n’est retenu', () => {
  const pieges: Record<number, string> = {
    4451: 'TEMSIA (près d’Agadir, pas Tamesna)',
    7154: 'Alnif (pas Asni)',
    5812: 'Assa (pas Asni)',
    5679: 'Alal elbahraoui (pas El arjat)',
    6458: 'ouargui, l’un des deux',
    6542: 'ouargui, l’autre',
  };
  for (const c of CORRESPONDANCES_VILLES_POWER) {
    assert.ok(!(c.cityId in pieges), `${c.ville} → ${pieges[c.cityId]}`);
  }
});

// « Sale el jadida » (#6092) est une vraie ville de l'agence Rabat : le piège
// n'est pas son identifiant, c'est de l'attribuer à El Jadida, que tout
// rapprochement par inclusion de nom lui donnerait.
test('El Jadida ne part jamais sous l’identifiant de Salé El Jadida', () => {
  for (const c of CORRESPONDANCES_VILLES_POWER.filter((c) => c.cityId === 6092)) {
    assert.equal(c.agence, 'Agence Rabat', c.ville);
  }
});

// ------------------------------------------------------------
// Résolution à la remise
// ------------------------------------------------------------

test('la résolution ignore casse, accents et espaces de bord', () => {
  assert.equal(resoudreVillePower('Agence Rabat', 'Kénitra')?.cityId, resoudreVillePower('Agence Rabat', 'Kenitra')?.cityId);
  assert.equal(resoudreVillePower('Agence Casablanca', '  casablanca ')?.cityId, 4240);
  assert.equal(resoudreVillePower('Agence Marrakech', 'EL KELAA DES SRAGHNA')?.cityId, 4775);
});

test('les deux graphies d’El Jadida partent sous le même identifiant', () => {
  assert.equal(resoudreVillePower('Agence El Jadida', 'El Jadida')?.cityId, 4247);
  assert.equal(resoudreVillePower('Agence El Jadida', 'l jadida')?.cityId, 4247);
});

test('la résolution est confinée à l’agence qui reçoit le colis', () => {
  assert.equal(resoudreVillePower('Agence Rabat', 'Marrakech'), null);
});

test('une ville mise de côté ne se résout pas', () => {
  for (const v of VILLES_POWER_SANS_CORRESPONDANCE) {
    assert.equal(resoudreVillePower(v.agence, v.ville), null, `${v.agence} · ${v.ville}`);
  }
});

test('une ville hors contrat ne se résout pas', () => {
  assert.equal(resoudreVillePower('Agence Rabat', 'Tanger'), null);
});
