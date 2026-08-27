import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATEGORIES_TRANSACTION,
  LABELS_CATEGORIE_TRANSACTION,
  LABELS_TYPE_TRANSACTION,
  TYPES_TRANSACTION,
  formatMontantTransaction,
  formatSolde,
} from '../finance';

// Ce module n'a que deux fonctions, et elles ne font que du formatage — mais
// c'est le formatage du JOURNAL COMPTABLE. Un signe inversé n'y provoque
// aucune erreur : il fait juste lire un déficit comme un excédent, ce qui est
// pire qu'un plantage.

// ------------------------------------------------------------
// Montant d'une écriture
// ------------------------------------------------------------

// `Transaction.montant` est TOUJOURS positif en base : le sens de l'écriture
// est porté par `type`. C'est donc le type, et lui seul, qui décide du signe
// affiché.
test('le signe vient du type, jamais du montant', () => {
  assert.equal(formatMontantTransaction(1500, 'revenu'), '+ 1500.00 DH');
  assert.equal(formatMontantTransaction(1500, 'depense'), '- 1500.00 DH');
});

// Si un montant négatif traverse malgré tout la validation, une dépense ne
// doit pas se transformer en recette par double négation — même règle que
// effetAjustement sur les bons de paiement.
test('un montant négatif ne renverse pas le sens de l’écriture', () => {
  assert.equal(formatMontantTransaction(-1500, 'depense'), '- 1500.00 DH');
  assert.equal(formatMontantTransaction(-1500, 'revenu'), '+ 1500.00 DH');
});

// Prisma rend les Decimal sous forme de chaîne : le formatage doit accepter ce
// que la base renvoie réellement.
test('un montant en chaîne (Decimal Prisma) est accepté', () => {
  assert.equal(formatMontantTransaction('249.5', 'revenu'), '+ 249.50 DH');
});

test('deux décimales toujours affichées', () => {
  assert.equal(formatMontantTransaction(7, 'revenu'), '+ 7.00 DH');
  assert.equal(formatMontantTransaction(0.5, 'depense'), '- 0.50 DH');
  assert.equal(formatMontantTransaction(1234.567, 'revenu'), '+ 1234.57 DH');
});

// ------------------------------------------------------------
// Solde
// ------------------------------------------------------------

// Contrairement au montant d'une écriture, le solde est un résultat : c'est
// SON signe qui fait foi, pas un champ à côté.
test('le solde porte son propre signe', () => {
  assert.equal(formatSolde(3200), '+ 3200.00 DH');
  assert.equal(formatSolde(-3200), '- 3200.00 DH');
});

// Un solde nul est un équilibre, pas un déficit : il doit s'afficher « + »,
// sinon un journal à zéro se lit comme une perte.
test('un solde nul s’affiche en positif', () => {
  assert.equal(formatSolde(0), '+ 0.00 DH');
});

// ------------------------------------------------------------
// Référentiels
// ------------------------------------------------------------

// Un enum élargi côté Prisma sans son libellé ici afficherait `undefined` dans
// l'écran de comptabilité. Le test le rappelle au moment de la migration
// plutôt qu'en production.
test('chaque type et chaque catégorie a un libellé', () => {
  for (const t of TYPES_TRANSACTION) {
    assert.equal(typeof LABELS_TYPE_TRANSACTION[t], 'string', `libellé manquant pour le type ${t}`);
    assert.ok(LABELS_TYPE_TRANSACTION[t].length > 0, `libellé vide pour le type ${t}`);
  }
  for (const c of CATEGORIES_TRANSACTION) {
    assert.equal(typeof LABELS_CATEGORIE_TRANSACTION[c], 'string', `libellé manquant pour ${c}`);
    assert.ok(LABELS_CATEGORIE_TRANSACTION[c].length > 0, `libellé vide pour ${c}`);
  }
});

test('aucun doublon dans les référentiels', () => {
  assert.equal(new Set(TYPES_TRANSACTION).size, TYPES_TRANSACTION.length);
  assert.equal(new Set(CATEGORIES_TRANSACTION).size, CATEGORIES_TRANSACTION.length);
});
