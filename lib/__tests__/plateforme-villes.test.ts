import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VilleAvecHub } from '../hub-envoi';
import { construireCatalogue } from '../plateforme-villes';

const ville = (id: string, nom: string, hub: string, tarif: number | null = 25): VilleAvecHub => ({
  id,
  nom,
  tarif,
  hub: { id: `h-${hub}`, nom: hub, isCentral: false, prestataireId: `p-${hub}` },
});

const VILLES = [
  ville('v1', 'Oujda (Centre & Quartiers)', 'Agence Oujda', 15),
  ville('v2', 'Boulmane', 'Agence Boulmane'),
  ville('v3', 'Bouleman', 'Agence Errachidia', 30),
  ville('v4', 'Fès', 'Agence Fès', 18),
  ville('v5', 'VilleAuditTournee', 'Hub Audit Tournée'),
];

test('chaque ville sort avec son nom, son code et le tarif de livraison du transporteur', () => {
  assert.deepEqual(construireCatalogue(VILLES), [
    { nom: 'Boulmane', code: 'v2', tarifLivraison: 25 },
    { nom: 'Fès', code: 'v4', tarifLivraison: 18 },
    { nom: 'Oujda (Centre & Quartiers)', code: 'v1', tarifLivraison: 15 },
  ]);
});

test('deux graphies d’une même ville n’apparaissent qu’une fois, sous la ville retenue', () => {
  const noms = construireCatalogue(VILLES).map((v) => v.nom);
  assert.ok(noms.includes('Boulmane'));
  assert.ok(!noms.includes('Bouleman'));
});

test('la ville d’un hub de test n’est jamais exposée', () => {
  assert.ok(!construireCatalogue(VILLES).some((v) => v.nom === 'VilleAuditTournee'));
});

test('ni transporteur ni agence ne sortent', () => {
  const json = JSON.stringify(construireCatalogue(VILLES));
  for (const interdit of ['Agence', 'prestataire', 'hub', 'p-Agence']) {
    assert.ok(!json.includes(interdit), interdit);
  }
});

test('un tarif inconnu sort à null, jamais à 0', () => {
  assert.deepEqual(construireCatalogue([ville('v9', 'Tinghir', 'Agence Ouarzazate', null)]), [
    { nom: 'Tinghir', code: 'v9', tarifLivraison: null },
  ]);
});
