import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  codeExterneDeReponseMeta,
  construireColisMeta,
  lireSuiviMeta,
  messageMeta,
  refusDansReponseMeta,
  type ColisAConfier,
} from '../meta-livraison';

const colis = (surcharge: Partial<ColisAConfier> = {}): ColisAConfier => ({
  codeSuivi: 'PD-000123',
  clientNom: '  Amina Alaoui ',
  clientTelephone: ' 0612345678 ',
  adresse: ' 12 rue des Oliviers ',
  montantCod: '249.5',
  ouvrir: false,
  fragile: false,
  aRemplacer: false,
  produitDescription: 'Montre',
  quantite: 1,
  ...surcharge,
});

test('le colis porte les champs de leur doc, sans consigne inventée', () => {
  const c = construireColisMeta(colis(), 307, '12 rue des Oliviers');
  assert.deepEqual(c, {
    code: 'MTH-PD-000123',
    destinataire: 'Amina Alaoui',
    phone: '0612345678',
    address: '12 rue des Oliviers',
    price: 249.5,
    cityId: 307,
    quantity: 1,
    canOpen: false,
    replaceColis: false,
    marchendise: 'Montre',
    colisStock: false,
  });
});

test('ouvrir et échanger ont leurs champs ; fragile part en description, pas dans l’adresse', () => {
  const c = construireColisMeta(colis({ ouvrir: true, fragile: true, aRemplacer: true, quantite: 3 }), 307, 'Douar X, kanssara');
  assert.equal(c.address, 'Douar X, kanssara');
  assert.equal(c.canOpen, true);
  assert.equal(c.replaceColis, true);
  assert.equal(c.description, 'Colis fragile');
  assert.equal(c.quantity, 3);
});

test('sans description produit exploitable, marchendise est omis', () => {
  assert.equal('marchendise' in construireColisMeta(colis({ produitDescription: null }), 307, 'x'), false);
  assert.equal('marchendise' in construireColisMeta(colis({ produitDescription: ' a ' }), 307, 'x'), false);
});

test('un montant COD invalide est refusé avant tout envoi', () => {
  assert.throws(() => construireColisMeta(colis({ montantCod: 'abc' }), 307, 'x'));
});

test('le message d’erreur reprend le détail de validation', () => {
  const brut = {
    success: false,
    message: 'Validation failed',
    errors: { 'colis[0].phone': 'Le téléphone est obligatoire' },
  };
  assert.equal(messageMeta(brut), 'Validation failed — colis[0].phone : Le téléphone est obligatoire');
  assert.equal(refusDansReponseMeta(brut), 'Validation failed — colis[0].phone : Le téléphone est obligatoire');
});

test('un 200 avec totalFailed > 0 est un refus (forme documentée de leur bulk)', () => {
  assert.ok(refusDansReponseMeta({ success: true, data: { totalImported: 0, totalFailed: 1, successCodes: [], errors: [{ code: 'MTH-1' }] } }));
  assert.equal(refusDansReponseMeta({ success: true, data: { totalImported: 1, totalFailed: 0, successCodes: ['MTH-1'], errors: [] } }), null);
});

test('leur code n’est retenu que s’il diffère du nôtre', () => {
  assert.equal(codeExterneDeReponseMeta({ data: [{ code: 'MTH-PD-1' }] }, 'MTH-PD-1'), null);
  assert.equal(codeExterneDeReponseMeta({ data: { colis: [{ trackingCode: 'ML-998' }] } }, 'MTH-PD-1'), 'ML-998');
});

test('le suivi se lit avec les noms de champs de leur webhook', () => {
  const s = lireSuiviMeta({ success: true, data: { code: 'MTH-PD-1', status: 'delivered', statusLabel: 'Livré' } });
  assert.equal(s.statut, 'DELIVERED');
  assert.equal(s.libelle, 'Livré');
  assert.equal(s.injoignables, null);
});
