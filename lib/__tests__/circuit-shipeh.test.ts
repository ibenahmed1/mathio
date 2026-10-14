import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendRemise,
  noteEnTransit,
  perimetreEnvoi,
  refusPerimetreEnvoi,
  refusShipehNonScanne,
  statutApresRemise,
  statutEntreeBonEnvoi,
  suitCircuitShipeh,
} from '../circuit-shipeh';

const shipeh = { source: 'api' as const, enStock: true };
const shopify = { source: 'api' as const, enStock: false };
const marchand = { source: 'manuel' as const, enStock: true };

test('seul un colis de plateforme ET de stock suit le circuit Shipeh (Shopify et nos marchands, non)', () => {
  assert.equal(suitCircuitShipeh(shipeh), true);
  assert.equal(suitCircuitShipeh(shopify), false);
  assert.equal(suitCircuitShipeh(marchand), false);
});

test('entrée dans un bon d’envoi : le colis Shipeh garde son statut, les autres passent en transit', () => {
  assert.equal(statutEntreeBonEnvoi({ ...shipeh, statut: 'recu_au_hub' }), 'recu_au_hub');
  assert.equal(statutEntreeBonEnvoi({ ...shopify, statut: 'recu_au_hub' }), 'en_transit');
  assert.equal(statutEntreeBonEnvoi({ ...marchand, statut: 'ramasse' }), 'en_transit');
});

test('remise par API : en transit pour Shipeh, « expédié » pour les autres', () => {
  assert.equal(statutApresRemise(shipeh), 'en_transit');
  assert.equal(statutApresRemise(shopify), 'expedier_par_amana');
});

test('un colis Shipeh encore au hub de départ attend sa remise ; en transit, non', () => {
  assert.equal(attendRemise({ ...shipeh, statut: 'recu_au_hub' }), true);
  assert.equal(attendRemise({ ...shipeh, statut: 'en_transit' }), false);
  assert.equal(attendRemise({ ...shopify, statut: 'recu_au_hub' }), false);
});

test('pas de bon d’envoi pour un colis Shipeh non scanné', () => {
  assert.match(refusShipehNonScanne({ ...shipeh, statut: 'pret_pour_preparation', codeSuivi: 'PD-1' }) ?? '', /scanné/);
  assert.match(refusShipehNonScanne({ ...shipeh, statut: 'nouveau_colis', codeSuivi: 'PD-1' }) ?? '', /PD-1/);
  assert.equal(refusShipehNonScanne({ ...shipeh, statut: 'recu_au_hub', codeSuivi: 'PD-1' }), null);
  assert.equal(refusShipehNonScanne({ ...marchand, statut: 'nouveau_colis', codeSuivi: 'PD-1' }), null);
});

test('la phrase de transit nomme le hub quand on le connaît', () => {
  assert.equal(noteEnTransit('Hub Tanger'), 'en transit vers Hub Tanger');
  assert.equal(noteEnTransit(null), 'en transit');
});

test('planner : seuls les colis Shipeh scannés au Hub Central entrent dans ses bons d’envoi', () => {
  assert.equal(refusPerimetreEnvoi('planner', { ...shipeh, statut: 'recu_au_hub', codeSuivi: 'PD-1' }), null);
  assert.match(refusPerimetreEnvoi('planner', { ...shipeh, statut: 'pret_pour_preparation', codeSuivi: 'PD-2' }) ?? '', /scanné au Hub Central/);
  // PD-101550 (14/10) : colis de plateforme hors stock, « Nouveau colis ».
  assert.match(refusPerimetreEnvoi('planner', { ...shopify, statut: 'nouveau_colis', codeSuivi: 'PD-3' }) ?? '', /pas un colis Shipeh/);
  assert.match(refusPerimetreEnvoi('planner', { ...marchand, statut: 'recu_au_hub', codeSuivi: 'PD-4' }) ?? '', /pas un colis Shipeh/);
});

test('l’admin garde tous les colis : aucun périmètre, aucun refus', () => {
  assert.equal(perimetreEnvoi('admin'), undefined);
  assert.equal(refusPerimetreEnvoi('admin', { ...shopify, statut: 'nouveau_colis', codeSuivi: 'PD-3' }), null);
  assert.deepEqual(perimetreEnvoi('planner'), { source: 'api', enStock: true, statut: 'recu_au_hub' });
});
