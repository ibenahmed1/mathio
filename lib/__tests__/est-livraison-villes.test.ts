import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  CORRESPONDANCES_VILLES_EST,
  VILLES_EST_SANS_CORRESPONDANCE,
  resoudreVilleEst,
} from '../est-livraison-villes';
import { normaliserVille } from '../hub-stock';

// La grille d'EST Livraison, lue à sa SOURCE — le script d'import, qui fait foi
// pour le référentiel (§ SOUS_TRAITANCE.md). Relire le fichier plutôt que de
// recopier ses 63 villes garantit que le test constate un écart au lieu de le
// reproduire : une ville ajoutée à la grille et oubliée ici fait échouer
// `npm test`, pas un colis en production.
function villesDeLaGrille(): string[] {
  const source = readFileSync('scripts/import-prestataire-est-livraison.ts', 'utf8');
  const zones = source.slice(source.indexOf('const ZONES'), source.indexOf('export async function'));
  const villes: string[] = [];
  for (const zone of zones.matchAll(/villes:\s*\[([\s\S]*?)\]/g)) {
    for (const item of zone[1].matchAll(/'([^']*)'|"([^"]*)"/g)) {
      villes.push(item[1] ?? item[2]);
    }
  }
  return villes;
}

const GRILLE = villesDeLaGrille();

test('la grille est bien celle des 63 villes du réseau EST Livraison', () => {
  assert.equal(GRILLE.length, 63);
});

// L'invariant du fichier : chaque ville de la grille est soit rapprochée d'un
// libellé de chez eux, soit explicitement mise de côté avec un motif. Aucune
// ne peut être oubliée — un oubli serait une ville silencieusement non
// remettable, qu'aucun écran ne signalerait.
test('chaque ville de la grille est rapprochée ou mise de côté, jamais oubliée', () => {
  const rapprochees = new Set(CORRESPONDANCES_VILLES_EST.map((c) => normaliserVille(c.ville)));
  const misesDeCote = new Set(VILLES_EST_SANS_CORRESPONDANCE.map((v) => normaliserVille(v.ville)));

  const oubliees = GRILLE.filter((ville) => {
    const cle = normaliserVille(ville);
    return !rapprochees.has(cle) && !misesDeCote.has(cle);
  });
  assert.deepEqual(oubliees, [], `villes absentes des deux listes : ${oubliees.join(', ')}`);
});

test('aucune ville n’est à la fois rapprochée et mise de côté', () => {
  const misesDeCote = new Set(VILLES_EST_SANS_CORRESPONDANCE.map((v) => normaliserVille(v.ville)));
  const doubles = CORRESPONDANCES_VILLES_EST.filter((c) => misesDeCote.has(normaliserVille(c.ville)));
  assert.deepEqual(doubles.map((c) => c.ville), []);
});

test('aucune ville n’apparaît deux fois dans la même liste', () => {
  for (const [nom, villes] of [
    ['correspondances', CORRESPONDANCES_VILLES_EST.map((c) => `${c.agence}|${normaliserVille(c.ville)}`)],
    ['mises de côté', VILLES_EST_SANS_CORRESPONDANCE.map((v) => `${v.agence}|${normaliserVille(v.ville)}`)],
  ] as const) {
    assert.equal(new Set(villes).size, villes.length, `doublon dans les ${nom}`);
  }
});

test('toute ville mise de côté porte un motif', () => {
  for (const ville of VILLES_EST_SANS_CORRESPONDANCE) {
    assert.ok(ville.motif.trim().length > 0, `${ville.ville} est mise de côté sans motif`);
  }
});

// Leur libellé est ce qui part dans `city`. Vide ou non détouré, il fabrique
// une ville fantôme chez eux.
test('toute correspondance porte un libellé EST non vide et détouré', () => {
  for (const c of CORRESPONDANCES_VILLES_EST) {
    assert.ok(c.nomEst.length > 0, `${c.ville} n’a pas de libellé EST`);
    assert.equal(c.nomEst, c.nomEst.trim(), `le libellé de ${c.ville} n’est pas détouré`);
  }
});

// ------------------------------------------------------------
// Résolution
// ------------------------------------------------------------

// `Commande.ville` est du texte libre saisi par un marchand : la casse et les
// accents ne doivent pas faire manquer une correspondance.
test('la résolution replie la casse et les accents', () => {
  for (const c of CORRESPONDANCES_VILLES_EST) {
    assert.ok(resoudreVilleEst(c.agence, c.ville.toUpperCase()));
    assert.ok(resoudreVilleEst(c.agence, ` ${c.ville.toLowerCase()} `));
  }
});

test('une ville d’une autre agence n’est pas résolue', () => {
  for (const c of CORRESPONDANCES_VILLES_EST) {
    assert.equal(resoudreVilleEst('Agence Casablanca', c.ville), null);
  }
});

// La garantie qui empêche leur API de créer une ville fantôme : hors de la
// liste, on ne devine rien.
test('une ville inconnue rend null plutôt qu’un nom envoyé au jugé', () => {
  assert.equal(resoudreVilleEst('Agence Oujda', 'Ville Qui N’Existe Pas'), null);
  assert.equal(resoudreVilleEst('Agence Oujda', ''), null);
});

// Une seule ville est remettable : « Oujda (Centre & Quartiers) », vérifiée
// contre leur API (`city_created: null`). Les 62 autres attendent leur liste,
// et l'Excel du bon reste leur voie. Ce test tombe dès qu'une correspondance
// est ajoutée : c'est le signal qu'il faut dire d'où elle vient.
test('seule Oujda est remettable, et sa correspondance est vérifiée', () => {
  assert.equal(CORRESPONDANCES_VILLES_EST.length, 1);
  const oujda = resoudreVilleEst('Agence Oujda', 'Oujda (Centre & Quartiers)');
  assert.equal(oujda?.nomEst, 'OUJDA');

  const autres = GRILLE.filter((v) => normaliserVille(v) !== normaliserVille('Oujda (Centre & Quartiers)'));
  assert.equal(autres.length, 62);
  for (const ville of autres) {
    assert.equal(resoudreVilleEst('Agence Oujda', ville), null);
  }
});
