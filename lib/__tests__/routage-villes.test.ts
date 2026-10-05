import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleRoutage, meilleurHub, villesRetenues, type VilleAvecHub } from '../hub-envoi';

let n = 0;
const ville = (nom: string, hub: string, tarif: number | null, options: { interne?: boolean; central?: boolean } = {}): VilleAvecHub => ({
  id: `v${++n}`,
  nom,
  tarif,
  hub: {
    id: `h-${hub}`,
    nom: hub,
    isCentral: options.central ?? false,
    prestataireId: options.interne || options.central ? null : `p-${hub}`,
  },
});

// § Décision du 05/10/2026 : une ville desservie par plusieurs réseaux part
// chez le moins cher.
test('entre deux agences, le tarif le plus bas l’emporte', () => {
  const meta = ville('missour', 'Agence Missour', 25);
  const coliv = ville('Missour', 'Agence Errachidia', 30);
  assert.equal(meilleurHub(meta, coliv), meta);
  assert.equal(meilleurHub(coliv, meta), meta);
});

test('à tarif égal, l’ordre alphabétique des agences départage', () => {
  const meta = ville('TAOURIRT', 'Agence Taza', 25);
  const est = ville('Taourirt', 'Agence Oujda', 25);
  assert.equal(meilleurHub(meta, est), est);
  assert.equal(meilleurHub(est, meta), est);
});

test('une ville sans tarif passe après une ville tarifée, même plus chère', () => {
  const inconnue = ville('Oujda', 'Agence A', null);
  const chere = ville('Oujda', 'Agence B', 40);
  assert.equal(meilleurHub(inconnue, chere), chere);
});

test('un hub interne l’emporte toujours sur une agence, quel que soit le prix', () => {
  const interne = ville('Casablanca', 'Hub Casablanca', null, { central: true });
  const power = ville('Casablanca', 'Agence Casablanca', 15);
  assert.equal(meilleurHub(power, interne), interne);
});

test('les graphies d’une même ville partagent une clé de routage', () => {
  assert.equal(cleRoutage('Bouleman'), cleRoutage('Boulmane'));
  assert.equal(cleRoutage('  BOULEMAN '), cleRoutage('boulmane'));
  assert.equal(cleRoutage('sidi fini'), cleRoutage('Sidi Ifni'));
  assert.equal(cleRoutage('Ajdir-Taza'), cleRoutage('AJDIR TAZA'));
  assert.equal(cleRoutage('Oued Amlil'), cleRoutage('OUAD AMLIL'));
  // Une ville hors table garde sa clé normalisée.
  assert.equal(cleRoutage('Fès'), 'fes');
  assert.notEqual(cleRoutage('Mzouda'), cleRoutage('mzoudia'));
});

test('les graphies concurrentes sont départagées par le prix', () => {
  const retenues = villesRetenues([
    ville('Bouleman', 'Agence Errachidia', 30),
    ville('Boulmane', 'Agence Boulmane', 25),
    ville('merleft', 'Agence Agadir', 23),
    ville('Mirleft', 'Agence Guelmim', 25),
  ]);
  assert.equal(retenues.get(cleRoutage('Bouleman'))?.nom, 'Boulmane');
  assert.equal(retenues.get(cleRoutage('Mirleft'))?.nom, 'merleft');
  assert.equal(retenues.size, 2);
});
