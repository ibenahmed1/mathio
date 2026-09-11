import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LABELS_STATUT_COMMANDE_STOCK_HUB,
  STATUTS_COMMANDE_STOCK_HUB,
  STATUTS_CREATION_COMMANDE_STOCK_HUB,
  STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT,
  estStatutCommandeStockHub,
  peutPasserCommandeStockHub,
  statutsSuivantsCommandeStockHub,
} from '../commandes-stock-hub';

// ------------------------------------------------------------
// Transitions
// ------------------------------------------------------------

test('le cycle avance : brouillon → commandée → reçue', () => {
  assert.equal(peutPasserCommandeStockHub('brouillon', 'commandee'), true);
  assert.equal(peutPasserCommandeStockHub('commandee', 'recue'), true);
});

test('une commande s’annule tant qu’elle n’est pas reçue', () => {
  assert.equal(peutPasserCommandeStockHub('brouillon', 'annulee'), true);
  assert.equal(peutPasserCommandeStockHub('commandee', 'annulee'), true);
  assert.equal(peutPasserCommandeStockHub('recue', 'annulee'), false);
});

test('le cycle ne recule jamais', () => {
  assert.equal(peutPasserCommandeStockHub('commandee', 'brouillon'), false);
  assert.equal(peutPasserCommandeStockHub('recue', 'commandee'), false);
  assert.equal(peutPasserCommandeStockHub('annulee', 'brouillon'), false);
  assert.equal(peutPasserCommandeStockHub('annulee', 'commandee'), false);
});

// Sauter « Commandée » reviendrait à recevoir un achat qui n'a jamais été passé.
test('un brouillon ne passe pas directement à reçue', () => {
  assert.equal(peutPasserCommandeStockHub('brouillon', 'recue'), false);
});

test('reçue et annulée sont définitives', () => {
  assert.deepEqual(statutsSuivantsCommandeStockHub('recue'), []);
  assert.deepEqual(statutsSuivantsCommandeStockHub('annulee'), []);
});

test('rester au même statut n’est pas une transition', () => {
  for (const statut of STATUTS_COMMANDE_STOCK_HUB) {
    assert.equal(peutPasserCommandeStockHub(statut, statut), false, statut);
  }
});

test('modifier la liste renvoyée ne change pas les règles', () => {
  const suivants = statutsSuivantsCommandeStockHub('brouillon');
  suivants.push('recue');
  assert.equal(peutPasserCommandeStockHub('brouillon', 'recue'), false);
});

// ------------------------------------------------------------
// Création et référentiel
// ------------------------------------------------------------

test('une commande naît en brouillon, et annulée ne se choisit pas à la création', () => {
  assert.equal(STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT, 'brouillon');
  assert.ok(STATUTS_CREATION_COMMANDE_STOCK_HUB.includes(STATUT_COMMANDE_STOCK_HUB_PAR_DEFAUT));
  assert.equal(STATUTS_CREATION_COMMANDE_STOCK_HUB.includes('annulee'), false);
});

test('chaque statut a son libellé, et aucun libellé ne vise un statut disparu', () => {
  assert.deepEqual(Object.keys(LABELS_STATUT_COMMANDE_STOCK_HUB).sort(), [...STATUTS_COMMANDE_STOCK_HUB].sort());
  for (const statut of STATUTS_COMMANDE_STOCK_HUB) {
    assert.ok(LABELS_STATUT_COMMANDE_STOCK_HUB[statut], statut);
  }
});

// Une page ouverte avant la migration peut encore envoyer les anciennes valeurs.
test('les anciennes valeurs et les non-chaînes sont écartées', () => {
  assert.equal(estStatutCommandeStockHub('en_attente'), false);
  assert.equal(estStatutCommandeStockHub('livre'), false);
  assert.equal(estStatutCommandeStockHub(42), false);
  assert.equal(estStatutCommandeStockHub(null), false);
  assert.equal(estStatutCommandeStockHub('recue'), true);
});
