import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  colisReintegrable,
  lignesEffectives,
  regrouperBesoinsStock,
  stockColisVerrouille,
  type ColisBesoin,
  type LigneBesoin,
} from '../stock-quantites';
import { trouverUniteParSku, unitesStock } from '../stock-unites';
import { referenceVariante } from '../sku';

function ligne(partiel: Partial<LigneBesoin> = {}): LigneBesoin {
  return {
    libelle: 'T-shirt',
    quantite: 1,
    produitId: 'p-simple',
    varianteId: null,
    produit: { nom: 'T-shirt', variantesActivees: false },
    ...partiel,
  };
}

function colis(codeSuivi: string, ...lignes: LigneBesoin[]): ColisBesoin {
  return { id: codeSuivi, codeSuivi, lignes: lignes.length > 0 ? lignes : [ligne()] };
}

test('besoins : un produit simple se décrémente sur le produit, cumulé entre colis', () => {
  const { besoins, anomalies } = regrouperBesoinsStock([
    colis('A', ligne({ quantite: 2 })),
    colis('B', ligne({ quantite: 3 })),
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
    colis('A', ligne({ produitId: 'robe', varianteId: 'rouge', produit, quantite: 1 })),
    colis('B', ligne({ produitId: 'robe', varianteId: 'bleu', produit, quantite: 2 })),
    colis('C', ligne({ produitId: 'robe', varianteId: 'rouge', produit, quantite: 4 })),
  ]);
  assert.deepEqual(anomalies, []);
  assert.equal(besoins.get('variante:rouge')?.quantite, 5);
  assert.equal(besoins.get('variante:bleu')?.quantite, 2);
  assert.equal(besoins.get('variante:rouge')?.produitId, 'robe');
});

test('besoins : un colis à plusieurs produits puise dans chacun, et un même produit s’additionne', () => {
  const mug = { nom: 'Mug', variantesActivees: false };
  const { besoins, anomalies } = regrouperBesoinsStock([
    colis('A', ligne({ quantite: 2 }), ligne({ libelle: 'Mug', produitId: 'mug', produit: mug, quantite: 1 })),
    // Deux lignes du même produit dans un colis : un seul besoin, un seul code.
    colis('B', ligne({ libelle: 'Mug', produitId: 'mug', produit: mug, quantite: 3 }), ligne({ libelle: 'Mug', produitId: 'mug', produit: mug, quantite: 1 })),
  ]);
  assert.deepEqual(anomalies, []);
  assert.equal(besoins.get('produit:p-simple')?.quantite, 2);
  assert.equal(besoins.get('produit:mug')?.quantite, 5);
  assert.deepEqual(besoins.get('produit:mug')?.codes, ['A', 'B']);
});

test('besoins : un colis sans contenu, ou une ligne hors stock, est une anomalie, jamais ignoré', () => {
  const { besoins, anomalies } = regrouperBesoinsStock([
    { id: 'VIDE', codeSuivi: 'VIDE', lignes: [] },
    colis('SANS-VARIANTE', ligne({ produitId: 'robe', produit: { nom: 'Robe', variantesActivees: true } })),
    // Une ligne saine à côté d'une ligne texte libre : le colis reste en anomalie.
    colis('MIXTE', ligne(), ligne({ libelle: 'Cadeau', produitId: null, produit: null })),
  ]);
  assert.equal(anomalies.length, 3);
  assert.match(anomalies[0], /VIDE.*aucun produit/);
  assert.match(anomalies[1], /SANS-VARIANTE.*variante/);
  assert.match(anomalies[2], /MIXTE.*Cadeau/);
  // La ligne saine est comptée, mais l'anomalie suffit à tout bloquer en amont.
  assert.equal(besoins.size, 1);
});

test('repli transitoire : un colis sans lignes reprend son ancien produit unique', () => {
  const produit = { nom: 'Mug', variantesActivees: false };
  const ancien = { quantite: 4, produitId: 'mug', varianteId: null, produit, lignes: [] };
  assert.deepEqual(lignesEffectives(ancien), [
    { libelle: 'Mug', quantite: 4, produitId: 'mug', varianteId: null, produit },
  ]);
  // Dès qu'il a des lignes, l'ancien produit unique est ignoré.
  const avecLignes = { ...ancien, lignes: [ligne({ quantite: 2 })] };
  assert.equal(lignesEffectives(avecLignes)[0].produitId, 'p-simple');
  // Ni lignes ni produit : aucun contenu, pas de ligne inventée.
  assert.deepEqual(lignesEffectives({ ...ancien, produitId: null, produit: null }), []);
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
