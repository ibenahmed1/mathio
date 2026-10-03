import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apiPermissionFor } from '../permission-routes';

const ID = '3f2b8c1e-0000-4000-8000-000000000000';

// La remise d'un bon déjà composé relève de sa GESTION : sans sa règle nommée,
// la règle générique `/api/bons-envoi/**` la classerait en composition.
test('la remise Power d’un bon d’envoi exige bon_envoi:manage', () => {
  assert.equal(apiPermissionFor(`/api/bons-envoi/${ID}/remise-power-delivery`, 'POST'), 'bon_envoi:manage');
});

// Sans règle, ces chemins à plusieurs segments n'étaient couverts par aucune
// des règles `/api/commandes/*` : ils auraient échappé à la matrice.
test('les actions Power sur un colis exigent bon_envoi:manage', () => {
  assert.equal(apiPermissionFor(`/api/commandes/${ID}/power-delivery`, 'GET'), 'bon_envoi:manage');
  for (const action of ['actualiser', 'modifier', 'retour', 'relivraison']) {
    assert.equal(apiPermissionFor(`/api/commandes/${ID}/power-delivery/${action}`, 'POST'), 'bon_envoi:manage', action);
  }
});

test('les règles Power ne happent pas les routes voisines', () => {
  assert.equal(apiPermissionFor(`/api/commandes/${ID}/statut`, 'PATCH'), 'colis:confirm');
  assert.equal(apiPermissionFor(`/api/bons-envoi/${ID}/marquer-recu`, 'POST'), 'bon_envoi:manage');
  // Inchangé : l'export Excel tombe sous la règle générique, comme avant ce lot.
  assert.equal(apiPermissionFor(`/api/bons-envoi/${ID}/export`, 'GET'), 'bon_envoi:create');
});

// Le webhook n'a pas de session : aucune permission, et c'est écrit.
test('le webhook Power n’est gouverné par aucune permission', () => {
  assert.equal(apiPermissionFor('/api/v1/webhooks/power-delivery', 'POST'), null);
});

// § Colivraison : même responsabilité, même clé que Power Delivery.
test('la remise Colivraison et le suivi d’un colis confié exigent bon_envoi:manage', () => {
  assert.equal(apiPermissionFor(`/api/bons-envoi/${ID}/remise-colivraison`, 'POST'), 'bon_envoi:manage');
  assert.equal(apiPermissionFor(`/api/commandes/${ID}/colivraison`, 'GET'), 'bon_envoi:manage');
  assert.equal(apiPermissionFor(`/api/commandes/${ID}/colivraison/actualiser`, 'POST'), 'bon_envoi:manage');
});

// § Meta Livraison : même responsabilité ; leur webhook, comme celui de Power,
// n'a pas de session.
test('la remise et le suivi Meta exigent bon_envoi:manage ; leur webhook aucune permission', () => {
  assert.equal(apiPermissionFor(`/api/bons-envoi/${ID}/remise-meta-livraison`, 'POST'), 'bon_envoi:manage');
  assert.equal(apiPermissionFor(`/api/commandes/${ID}/meta-livraison`, 'GET'), 'bon_envoi:manage');
  assert.equal(apiPermissionFor(`/api/commandes/${ID}/meta-livraison/actualiser`, 'POST'), 'bon_envoi:manage');
  assert.equal(apiPermissionFor('/api/v1/webhooks/meta-livraison', 'POST'), null);
});

// § EST Livraison : même responsabilité que les autres remises par API.
test('la remise EST Livraison exige bon_envoi:manage', () => {
  assert.equal(apiPermissionFor(`/api/bons-envoi/${ID}/remise-est-livraison`, 'POST'), 'bon_envoi:manage');
});
