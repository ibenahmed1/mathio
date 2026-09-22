import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  FENETRE_WEBHOOK_S,
  analyserWebhookPower,
  horodatagePerime,
  signatureValide,
} from '../suivi-power-delivery';

const SECRET = 'secret-de-test-32-caracteres-min';
// Exemple de payload de leur documentation.
const CORPS = JSON.stringify({
  event: 'status_change',
  timestamp: 1732454321,
  parcel: {
    code: 'MTH-PD-000123',
    status: 'DELIVERED',
    status_second: '',
    receiver: 'Ahmed Mohamed',
    phone: '0654987178',
    city: 'Casablanca',
    address: '123 Rue Mohammed V',
    price: 250.0,
    payment_status: 'PAID',
  },
});
const hmac = (corps: string, secret = SECRET) => createHmac('sha256', secret).update(corps, 'utf8').digest('hex');

// ------------------------------------------------------------
// Signature
// ------------------------------------------------------------

test('la signature en hexadécimal nu est acceptée', () => {
  assert.equal(signatureValide(CORPS, hmac(CORPS), SECRET), true);
});

// Leur documentation montre les deux formes, sans dire laquelle leurs serveurs
// envoient.
test('la signature préfixée sha256= est acceptée aussi', () => {
  assert.equal(signatureValide(CORPS, `sha256=${hmac(CORPS)}`, SECRET), true);
  assert.equal(signatureValide(CORPS, `SHA256=${hmac(CORPS).toUpperCase()}`, SECRET), true);
});

test('un corps modifié d’un seul caractère est refusé', () => {
  const falsifie = CORPS.replace('DELIVERED', 'DELIVERE ');
  assert.equal(signatureValide(falsifie, hmac(CORPS), SECRET), false);
});

test('une signature faite avec un autre secret est refusée', () => {
  assert.equal(signatureValide(CORPS, hmac(CORPS, 'autre-secret'), SECRET), false);
});

// Le HMAC est optionnel chez eux, obligatoire chez nous.
test('sans secret configuré ou sans en-tête, tout est refusé', () => {
  assert.equal(signatureValide(CORPS, hmac(CORPS), ''), false);
  assert.equal(signatureValide(CORPS, null, SECRET), false);
  assert.equal(signatureValide(CORPS, '', SECRET), false);
});

test('une signature mal formée est refusée sans exception', () => {
  assert.equal(signatureValide(CORPS, 'sha256=test-signature', SECRET), false);
  assert.equal(signatureValide(CORPS, 'abc', SECRET), false);
});

// ------------------------------------------------------------
// Fraîcheur
// ------------------------------------------------------------

test('un webhook dans la fenêtre est frais', () => {
  const maintenant = new Date(1732454321 * 1000 + 30_000);
  assert.equal(horodatagePerime(1732454321, maintenant), false);
});

test('un webhook hors de la fenêtre est périmé, dans les deux sens', () => {
  const t = 1732454321;
  assert.equal(horodatagePerime(t, new Date((t + FENETRE_WEBHOOK_S + 1) * 1000)), true);
  assert.equal(horodatagePerime(t, new Date((t - FENETRE_WEBHOOK_S - 1) * 1000)), true);
});

// ------------------------------------------------------------
// Lecture
// ------------------------------------------------------------

test('le payload de leur documentation se lit', () => {
  assert.deepEqual(analyserWebhookPower(JSON.parse(CORPS)), {
    timestamp: 1732454321,
    code: 'MTH-PD-000123',
    statut: 'DELIVERED',
    statutSecond: null,
    paiement: 'PAID',
  });
});

test('le statut secondaire est conservé', () => {
  const lu = analyserWebhookPower({
    timestamp: '1732454321',
    parcel: { code: 'X', status: 'IN_PROGRESS', status_second: 'REFUSE' },
  });
  assert.equal(lu?.statutSecond, 'REFUSE');
  assert.equal(lu?.timestamp, 1732454321);
  assert.equal(lu?.paiement, null);
});

test('un payload incomplet n’est pas lu', () => {
  assert.equal(analyserWebhookPower(null), null);
  assert.equal(analyserWebhookPower({ timestamp: 1, parcel: { status: 'DELIVERED' } }), null);
  assert.equal(analyserWebhookPower({ parcel: { code: 'X', status: 'DELIVERED' } }), null);
  assert.equal(analyserWebhookPower({ timestamp: 1, parcel: { code: 'X' } }), null);
});
