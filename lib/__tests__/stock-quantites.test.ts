import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  quantiteRecueTotale,
  reliquatReception,
  type ProduitQuantites,
} from '../stock-quantites';

// Produit simple : les compteurs vivent sur le produit, `variantes` est vide.
function produitSimple(quantiteRecue: number, quantiteEnCours: number): ProduitQuantites {
  return { variantesActivees: false, quantiteRecue, quantiteEnCours, variantes: [] };
}

// Produit à variantes : les compteurs du produit restent à 0 — c'est
// exactement l'état que produit la base, et le piège que ces fonctions
// existent pour désamorcer.
function produitAVariantes(
  variantes: { quantiteRecue: number; quantiteEnCours: number }[]
): ProduitQuantites {
  return { variantesActivees: true, quantiteRecue: 0, quantiteEnCours: 0, variantes };
}

test('produit simple : les compteurs du produit font foi', () => {
  const p = produitSimple(8, 2);

  assert.equal(quantiteRecueTotale(p), 8);
  assert.equal(reliquatReception(p), 2);
});

// LE test qui justifie ce module : sur un produit à variantes, produit.quantiteRecue
// vaut 0. Une lecture naïve conclurait « rien n'a été validé » et laisserait
// passer un retour arrière qui devait être confirmé.
test('produit à variantes : les compteurs du produit sont ignorés au profit des variantes', () => {
  const p = produitAVariantes([
    { quantiteRecue: 5, quantiteEnCours: 1 },
    { quantiteRecue: 3, quantiteEnCours: 4 },
  ]);

  assert.equal(quantiteRecueTotale(p), 8);
  assert.equal(reliquatReception(p), 5);
});

// Le drapeau `variantesActivees` décide seul, jamais la présence de variantes :
// un produit peut porter des variantes historiques sans les suivre.
test('des variantes présentes mais désactivées ne sont jamais comptées', () => {
  const p: ProduitQuantites = {
    variantesActivees: false,
    quantiteRecue: 8,
    quantiteEnCours: 2,
    variantes: [{ quantiteRecue: 999, quantiteEnCours: 999 }],
  };

  assert.equal(quantiteRecueTotale(p), 8);
  assert.equal(reliquatReception(p), 2);
});

// Côté écran, `Produit.variantes` est optionnel : la fiche peut arriver avant
// que les variantes ne soient chargées. Renvoyer 0 est correct ; planter ne
// l'est pas.
test('variantes absentes ou nulles donnent 0, jamais une exception', () => {
  for (const variantes of [undefined, null, []]) {
    const p: ProduitQuantites = {
      variantesActivees: true,
      quantiteRecue: 0,
      quantiteEnCours: 0,
      variantes,
    };
    assert.equal(quantiteRecueTotale(p), 0);
    assert.equal(reliquatReception(p), 0);
  }
});

test('produit entièrement réceptionné : reliquat nul', () => {
  assert.equal(reliquatReception(produitSimple(10, 0)), 0);
  assert.equal(reliquatReception(produitAVariantes([{ quantiteRecue: 10, quantiteEnCours: 0 }])), 0);
});

// Après clôture de réception, le reliquat est remis à 0 sur toutes les
// variantes — la fonction doit alors renvoyer 0, ce qui masque le bandeau
// d'alerte et désactive le bouton.
test('après clôture, plus aucun reliquat sur un produit à variantes', () => {
  const p = produitAVariantes([
    { quantiteRecue: 5, quantiteEnCours: 0 },
    { quantiteRecue: 3, quantiteEnCours: 0 },
  ]);

  assert.equal(reliquatReception(p), 0);
  assert.equal(quantiteRecueTotale(p), 8);
});
