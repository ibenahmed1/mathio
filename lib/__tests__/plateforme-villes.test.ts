import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VilleAvecHub } from '../hub-envoi';
import { construireCatalogue } from '../plateforme-villes';
import { TARIF_LIVRAISON_MATHIO } from '../tarif-mathio';

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

test('chaque ville sort avec son nom, son code et le tarif Mathio, 35 dh partout', () => {
  assert.equal(TARIF_LIVRAISON_MATHIO, 35);
  assert.deepEqual(construireCatalogue(VILLES), [
    { nom: 'Boulmane', code: 'v2', tarifLivraison: 35 },
    { nom: 'Fès', code: 'v4', tarifLivraison: 35 },
    { nom: 'Oujda (Centre & Quartiers)', code: 'v1', tarifLivraison: 35 },
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

test('le tarif du transporteur ne sort jamais, même quand il est inconnu', () => {
  // Prix d'achat : 15 dh ici. Le catalogue n'expose que le prix Mathio.
  const [v] = construireCatalogue([ville('v9', 'Tinghir', 'Agence Ouarzazate', null), ville('v1', 'Oujda', 'Agence Oujda', 15)]);
  assert.equal(v.tarifLivraison, TARIF_LIVRAISON_MATHIO);
  assert.ok(!JSON.stringify(construireCatalogue([ville('v1', 'Oujda', 'Agence Oujda', 15)])).includes('15'));
});
