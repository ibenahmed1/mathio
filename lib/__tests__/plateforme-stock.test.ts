import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ErreurPlateforme } from '../plateforme-auth';
import { LIGNES_MAX_PAR_ENVOI, analyserEntreeEnvoi } from '../plateforme-stock';

// Seule la VALIDATION est testée ici ; l'annonce écrit en base et relève du
// scénario de bout en bout (scripts/simuler-shipeh.ts).

function codeRefus(corps: unknown): string | null {
  try {
    analyserEntreeEnvoi(corps);
    return null;
  } catch (error) {
    if (error instanceof ErreurPlateforme) return error.code;
    throw error;
  }
}

const VALIDE = { referenceEnvoi: 'ENV-2026-0153', lignes: [{ sku: 'MUG-X', quantite: 200 }] };

test('un envoi valide : numéro et lignes', () => {
  assert.deepEqual(analyserEntreeEnvoi(VALIDE), VALIDE);
});

test('le numéro d’envoi et les lignes sont requis', () => {
  assert.equal(codeRefus({ ...VALIDE, referenceEnvoi: '  ' }), 'champ_requis');
  assert.equal(codeRefus({ ...VALIDE, lignes: [] }), 'lignes_invalides');
  assert.equal(codeRefus({ ...VALIDE, lignes: 'MUG-X' }), 'lignes_invalides');
  const trop = Array.from({ length: LIGNES_MAX_PAR_ENVOI + 1 }, (_, i) => ({ sku: `S${i}`, quantite: 1 }));
  assert.equal(codeRefus({ ...VALIDE, lignes: trop }), 'lignes_invalides');
});

test('chaque ligne : un SKU et une quantité entière positive', () => {
  assert.equal(codeRefus({ ...VALIDE, lignes: [{ quantite: 1 }] }), 'champ_requis');
  for (const q of [0, -1, 2.5, 'dix']) {
    assert.equal(codeRefus({ ...VALIDE, lignes: [{ sku: 'A', quantite: q }] }), 'quantite_invalide', String(q));
  }
});

test('un même SKU répété (casse comprise) n’en fait qu’une ligne', () => {
  const e = analyserEntreeEnvoi({ ...VALIDE, lignes: [{ sku: 'MUG-X', quantite: 2 }, { sku: 'mug-x', quantite: 3 }] });
  assert.deepEqual(e.lignes, [{ sku: 'MUG-X', quantite: 5 }]);
});

test('un corps qui n’est pas un objet est refusé proprement', () => {
  for (const corps of [null, 'texte', 42, [VALIDE]]) assert.equal(codeRefus(corps), 'corps_invalide');
});
