import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colisReintegrable, regrouperBesoinsStock, stockColisVerrouille, type ColisBesoin } from '../stock-quantites';
import { trouverUniteParSku, unitesStock } from '../stock-unites';
import { referenceVariante } from '../sku';

function colis(partiel: Partial<ColisBesoin> & { codeSuivi: string }): ColisBesoin {
  return {
    id: partiel.codeSuivi,
    quantite: 1,
    produitId: 'p-simple',
    varianteId: null,
    produit: { nom: 'T-shirt', variantesActivees: false },
    ...partiel,
  };
}

test('besoins : un produit simple se décrémente sur le produit, cumulé entre colis', () => {
  const { besoins, anomalies } = regrouperBesoinsStock([
    colis({ codeSuivi: 'A', quantite: 2 }),
    colis({ codeSuivi: 'B', quantite: 3 }),
  ]);
  assert.deepEqual(anomalies, []);
  assert.equal(besoins.size, 1);
  const [besoin] = besoins.values();
  assert.deepEqual(besoin.unite, { type: 'produit', id: 'p-simple' });
  assert.equal(besoin.quantite, 5);
  assert.deepEqual(besoin.codes, ['A', 'B']);
});

test('besoins : un produit à variantes se décrémente sur chaque variante', () => {
  const produit = { nom: 'Robe', variantesActivees: true };
  const { besoins, anomalies } = regrouperBesoinsStock([
    colis({ codeSuivi: 'A', produitId: 'robe', varianteId: 'rouge', produit, quantite: 1 }),
    colis({ codeSuivi: 'B', produitId: 'robe', varianteId: 'bleu', produit, quantite: 2 }),
    colis({ codeSuivi: 'C', produitId: 'robe', varianteId: 'rouge', produit, quantite: 4 }),
  ]);
  assert.deepEqual(anomalies, []);
  assert.equal(besoins.get('variante:rouge')?.quantite, 5);
  assert.equal(besoins.get('variante:bleu')?.quantite, 2);
  assert.equal(besoins.get('variante:rouge')?.produitId, 'robe');
});

test('besoins : un colis sans produit ou sans variante est une anomalie, jamais ignoré', () => {
  const { besoins, anomalies } = regrouperBesoinsStock([
    colis({ codeSuivi: 'SANS-PRODUIT', produitId: null, produit: null }),
    colis({ codeSuivi: 'SANS-VARIANTE', produitId: 'robe', produit: { nom: 'Robe', variantesActivees: true } }),
  ]);
  assert.equal(besoins.size, 0);
  assert.equal(anomalies.length, 2);
  assert.match(anomalies[0], /SANS-PRODUIT/);
  assert.match(anomalies[1], /SANS-VARIANTE.*variante/);
});

test('réintégration : seulement un colis stock réservé, non réintégré, non livré', () => {
  const base = { enStock: true, statut: 'refuse', stockReserveLe: '2026-10-10', stockReintegreLe: null };
  assert.equal(colisReintegrable(base), true);
  assert.equal(colisReintegrable({ ...base, statut: 'livre' }), false);
  assert.equal(colisReintegrable({ ...base, stockReserveLe: null }), false);
  assert.equal(colisReintegrable({ ...base, stockReintegreLe: '2026-10-11' }), false);
  assert.equal(colisReintegrable({ ...base, enStock: false }), false);
});

test('verrou : le stock réservé fige le colis, la réintégration le libère', () => {
  assert.equal(stockColisVerrouille({ stockReserveLe: null, stockReintegreLe: null }), false);
  assert.equal(stockColisVerrouille({ stockReserveLe: '2026-10-10', stockReintegreLe: null }), true);
  assert.equal(stockColisVerrouille({ stockReserveLe: '2026-10-10', stockReintegreLe: '2026-10-11' }), false);
});

test('unités : un produit à variantes ne se choisit que par ses variantes, stock réel affiché', () => {
  const unites = unitesStock([
    { id: 'p1', nom: 'Mug', reference: 'MUG', quantiteRecue: 7, variantesActivees: false, variantes: [] },
    {
      id: 'p2',
      nom: 'Robe',
      reference: 'ROBE',
      quantiteRecue: 0,
      variantesActivees: true,
      variantes: [
        { id: 'v1', nom: 'Rouge', reference: 'ROBE-ROUGE', quantiteRecue: 3 },
        { id: 'v2', nom: 'Bleu', reference: 'ROBE-BLEU', quantiteRecue: 0 },
      ],
    },
  ]);
  assert.deepEqual(
    unites.map((u) => [u.reference, u.disponible]),
    [['MUG', 7], ['ROBE-ROUGE', 3], ['ROBE-BLEU', 0]]
  );
  assert.equal(trouverUniteParSku(unites, ' robe-rouge ')?.variante?.id, 'v1');
  assert.equal(trouverUniteParSku(unites, 'ROBE'), null);
});

test('SKU de variante proposé : majuscules, sans accents ni ponctuation', () => {
  assert.equal(referenceVariante('PRD-AB12', 'Rouge foncé / XL'), 'PRD-AB12-ROUGE-FONCE-XL');
  assert.equal(referenceVariante('PRD-AB12', '  '), '');
});
