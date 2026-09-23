import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATUTS_TERMINAUX } from '../statuts';
import { codeEffectifWebhook, paiementPower, sortStatutPower } from '../power-delivery-statuts';

// Les 29 codes réellement servis par leur `GET liststatus` le 21/09/2026 —
// pas ceux de leur documentation, qui sont faux pour trois d'entre eux.
const CODES_REELS = [
  'NEW_PARCEL', 'WAITING_PICKUP', 'PICKED_UP', 'SENT', 'RECEIVED', 'DISTRIBUTION', 'IN_PROGRESS',
  'RETURNED', 'DELIVERED', 'POSTPONED', 'NOANSWER', 'UNREACHABLE', 'OUT_OF_AREA', 'CANCELED',
  'REFUSE', 'SENT_BY_AMANA', 'RETURN_BY_AMANA', 'ERR', 'DEUX', 'TROIS', 'CANCELED_BY_VENDEUR',
  'CLIENT_INTERESE', 'PROGRAMMER', 'EN_VOYAGE', 'RELENCE_NEW_CLIENT', 'WAIT_RELANCE', 'BV',
];

test('chaque code réel de leur API a un sort décidé', () => {
  for (const code of CODES_REELS) {
    assert.notEqual(sortStatutPower(code).sort, 'inconnu', code);
  }
});

test('les graphies de leur documentation sont reconnues aussi', () => {
  assert.deepEqual(sortStatutPower('HORS_ZONE'), { sort: 'appliquer', statut: 'hors_zone' });
  assert.deepEqual(sortStatutPower('CANCELLED'), { sort: 'appliquer', statut: 'annule' });
  assert.deepEqual(sortStatutPower('ENVG'), { sort: 'memoriser' });
});

test('un code inconnu n’est jamais deviné', () => {
  assert.deepEqual(sortStatutPower('LIVRE'), { sort: 'inconnu' });
  assert.deepEqual(sortStatutPower(''), { sort: 'inconnu' });
});

test('la casse et les espaces de bord n’empêchent pas la reconnaissance', () => {
  assert.deepEqual(sortStatutPower(' delivered '), { sort: 'appliquer', statut: 'livre' });
});

// Le piège du vocabulaire commun : « Retourné » chez eux n'est pas notre
// `retourne`, terminal. Le poser clôturerait un colis encore sur la route.
test('leur « retourné » ne clôture jamais le colis', () => {
  for (const code of ['RETURNED', 'RETURN_BY_AMANA']) {
    const s = sortStatutPower(code);
    assert.equal(s.sort, 'appliquer', code);
    assert.ok(s.sort === 'appliquer' && s.statut !== 'retourne', code);
  }
});

// Décision du 22/09/2026 : seules la livraison, la distribution et le retour
// touchent le colis. Leur logistique interne reste sur la remise.
test('leur logistique interne n’est jamais posée sur le colis', () => {
  for (const code of ['NEW_PARCEL', 'WAITING_PICKUP', 'PICKED_UP', 'SENT', 'RECEIVED', 'EN_VOYAGE', 'SENT_BY_AMANA']) {
    assert.deepEqual(sortStatutPower(code), { sort: 'memoriser' }, code);
  }
});

test('seuls « livré » et « annulé » ferment le colis', () => {
  const fermants = CODES_REELS.flatMap((code) => {
    const s = sortStatutPower(code);
    return s.sort === 'appliquer' && STATUTS_TERMINAUX.includes(s.statut) ? [code] : [];
  });
  assert.deepEqual(fermants.sort(), ['CANCELED', 'DELIVERED']);
});

test('« pas de réponse » chez eux est un SMS envoyé par eux', () => {
  assert.deepEqual(sortStatutPower('NOANSWER'), { sort: 'appliquer', statut: 'pas_de_reponse_sms' });
  assert.deepEqual(sortStatutPower('UNREACHABLE'), { sort: 'appliquer', statut: 'injoignable' });
});

// ------------------------------------------------------------
// Les deux niveaux du webhook
// ------------------------------------------------------------

test('le détail l’emporte sur une étape en cours', () => {
  assert.equal(codeEffectifWebhook('IN_PROGRESS', 'REFUSE'), 'REFUSE');
  assert.equal(codeEffectifWebhook('IN_PROGRESS', 'POSTPONED'), 'POSTPONED');
});

test('sans détail, c’est l’étape qui compte', () => {
  assert.equal(codeEffectifWebhook('DELIVERED', ''), 'DELIVERED');
  assert.equal(codeEffectifWebhook('DISTRIBUTION', null), 'DISTRIBUTION');
});

test('un colis livré ou retourné ne redevient pas reporté', () => {
  assert.equal(codeEffectifWebhook('DELIVERED', 'POSTPONED'), 'DELIVERED');
  assert.equal(codeEffectifWebhook('RETURNED', 'REFUSE'), 'RETURNED');
});

// ------------------------------------------------------------
// Paiement
// ------------------------------------------------------------

test('le statut de paiement est lu, pas deviné', () => {
  assert.equal(paiementPower('PAID'), 'PAID');
  assert.equal(paiementPower(' invoiced '), 'INVOICED');
  assert.equal(paiementPower('PAYE'), null);
  assert.equal(paiementPower(undefined), null);
});
