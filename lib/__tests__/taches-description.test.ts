import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decouperDescription, recomposerDescription } from '../taches-description';

test('les cases Markdown sortent de la description', () => {
  const { texte, etapes } = decouperDescription('Revoir le tarif Casablanca.\n\n- [x] Lire la grille\n- [ ] Écrire la note');
  assert.equal(texte, 'Revoir le tarif Casablanca.');
  assert.deepEqual(etapes, [
    { texte: 'Lire la grille', fait: true },
    { texte: 'Écrire la note', fait: false },
  ]);
});

// C'est ce qui manquait à la carte du board : sans découpage, elle affichait
// « - [ ] Lire la grille » tel quel dans son résumé.
test('une description sans case reste intacte', () => {
  const { texte, etapes } = decouperDescription('Deux lignes\nsans checklist');
  assert.equal(texte, 'Deux lignes\nsans checklist');
  assert.deepEqual(etapes, []);
});

test('le « x » majuscule coche aussi', () => {
  assert.equal(decouperDescription('- [X] fait').etapes[0].fait, true);
});

test('découper puis recomposer ne perd rien', () => {
  const source = 'Contexte.\n\n- [x] Étape faite\n- [ ] Étape à faire';
  const { texte, etapes } = decouperDescription(source);
  assert.equal(recomposerDescription(texte, etapes), source);
});

test('une description vide ou nulle ne casse pas', () => {
  assert.deepEqual(decouperDescription(null), { texte: '', etapes: [] });
  assert.equal(recomposerDescription('', []), '');
});
