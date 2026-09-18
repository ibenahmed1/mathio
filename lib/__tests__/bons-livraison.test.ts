import assert from 'node:assert/strict';
import { test } from 'node:test';

import { grouperParMarchand, totalCod } from '../bons-livraison';

// Seules les deux règles pures sont testées ici : la génération elle-même
// écrit en base (transaction, numérotation, historique) et relève d'un
// scénario de bout en bout. Ces deux-là suffisent à couvrir ce qui se casse
// silencieusement — un total faux et un bon à cheval sur deux boutiques ne
// lèvent aucune erreur, ils produisent un document faux.

// ------------------------------------------------------------
// Total COD du bon
// ------------------------------------------------------------

test('somme les montants et arrondit au centime', () => {
  assert.equal(totalCod(['120.50', '79.50']), 200);
  assert.equal(totalCod([349.9, 120]), 469.9);
});

// Le montant du bon est celui que le ramasseur contresigne en emportant le
// sac : il doit valoir exactement la somme des colis, pas son approximation
// flottante. Sans l'arrondi final, ce cas rendrait 0.30000000000000004.
test("l'arrondi absorbe la dérive du flottant", () => {
  assert.equal(totalCod(['0.10', '0.20']), 0.3);
  assert.equal(totalCod(Array.from({ length: 10 }, () => '0.10')), 1);
});

// Les montants arrivent en Decimal Prisma, convertis en chaîne à la frontière
// de lib/ : la fonction doit accepter les deux formes sans en privilégier une.
test('accepte indifféremment chaînes et nombres', () => {
  assert.equal(totalCod(['10.25', 10.25]), 20.5);
});

test('une sélection vide vaut zéro, pas NaN', () => {
  assert.equal(totalCod([]), 0);
});

// ------------------------------------------------------------
// Regroupement par marchand
// ------------------------------------------------------------

// L'invariant central du BL : un bon ne contient que des colis d'une seule
// boutique. Il est tenu par ce regroupement — pas par un identifiant reçu du
// client — donc c'est ici qu'il faut le vérifier.
test('sépare les colis de deux marchands en deux groupes', () => {
  const groupes = grouperParMarchand([
    { id: 'c1', marchandId: 'm1' },
    { id: 'c2', marchandId: 'm2' },
    { id: 'c3', marchandId: 'm1' },
  ]);

  assert.equal(groupes.size, 2);
  assert.deepEqual(
    groupes.get('m1')?.map((c) => c.id),
    ['c1', 'c3'],
  );
  assert.deepEqual(
    groupes.get('m2')?.map((c) => c.id),
    ['c2'],
  );
});

test('un seul marchand donne un seul groupe, dans l’ordre reçu', () => {
  const groupes = grouperParMarchand([
    { id: 'c1', marchandId: 'm1' },
    { id: 'c2', marchandId: 'm1' },
  ]);

  assert.equal(groupes.size, 1);
  assert.deepEqual(
    groupes.get('m1')?.map((c) => c.id),
    ['c1', 'c2'],
  );
});

test('une sélection vide ne produit aucun bon', () => {
  assert.equal(grouperParMarchand([]).size, 0);
});
