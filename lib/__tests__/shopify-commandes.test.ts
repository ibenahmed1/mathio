import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  ErreurShopify,
  cleSecretePlausible,
  jetonAccesPlausible,
  lireCommandeShopify,
  normaliserDomaineShopify,
  signatureShopifyValide,
  type CommandeShopifyLue,
} from '../shopify-commandes';
import { apiPermissionFor } from '../permission-routes';

// Seules les décisions sans base sont testées ici ; l'ingestion (écriture du
// colis, idempotence en base) relève du scénario de bout en bout
// (scripts/simuler-webhook-shopify.ts).

// --- Domaine ----------------------------------------------------------------

test('le domaine accepte les formes qu’un marchand colle en pratique', () => {
  for (const saisie of [
    'ma-boutique.myshopify.com',
    'MA-BOUTIQUE.myshopify.com',
    'https://ma-boutique.myshopify.com/admin/orders?x=1',
    'ma-boutique',
    'admin.shopify.com/store/ma-boutique/orders',
    'https://admin.shopify.com/store/ma-boutique',
    '  ma-boutique.myshopify.com.  ',
  ]) {
    assert.equal(normaliserDomaineShopify(saisie), 'ma-boutique.myshopify.com', saisie);
  }
});

// Règle de SÉCURITÉ : le serveur appelle ce domaine avec le jeton du marchand.
test('le domaine refuse tout hôte hors myshopify.com', () => {
  for (const saisie of [
    '',
    'ma-boutique.com',
    'evil.com/ma-boutique.myshopify.com',
    'ma-boutique.myshopify.com.evil.com',
    '127.0.0.1',
    '169.254.169.254',
    'user@ma-boutique.myshopify.com',
    '-boutique.myshopify.com',
  ]) {
    assert.equal(normaliserDomaineShopify(saisie), null, saisie);
  }
});

test('jeton et clé : les deux champs inversés sont repérés', () => {
  assert.equal(jetonAccesPlausible('shpat_0123456789abcdef0123456789abcdef'), true);
  assert.equal(jetonAccesPlausible('shpss_0123456789abcdef0123456789abcdef'), true); // forme seule
  assert.equal(jetonAccesPlausible('0123456789abcdef'), false);
  assert.equal(cleSecretePlausible('shpss_0123456789abcdef0123456789abcdef'), true);
  assert.equal(cleSecretePlausible('shpat_0123456789abcdef0123456789abcdef'), false);
  assert.equal(cleSecretePlausible('court'), false);
});

// --- Signature --------------------------------------------------------------

const SECRET = 'shpss_secret_de_test_0123456789';

function signer(corps: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(corps).digest('base64');
}

test('signature : acceptée sur le corps exact, refusée sinon', () => {
  const corps = '{"id":1,"name":"#1001"}';
  assert.equal(signatureShopifyValide(corps, signer(corps), SECRET), true);
  assert.equal(signatureShopifyValide(Buffer.from(corps), signer(corps), SECRET), true);
  // Un espace de plus : c'est pourquoi on signe le corps BRUT, jamais un JSON resérialisé.
  assert.equal(signatureShopifyValide('{"id":1, "name":"#1001"}', signer(corps), SECRET), false);
  assert.equal(signatureShopifyValide(corps, signer(corps, 'autre_secret_0123456789'), SECRET), false);
  assert.equal(signatureShopifyValide(corps, null, SECRET), false);
  assert.equal(signatureShopifyValide(corps, '', SECRET), false);
  assert.equal(signatureShopifyValide(corps, 'pas-du-base64', SECRET), false);
  // Sans secret, rien ne passe — même une signature calculée avec un secret vide.
  assert.equal(signatureShopifyValide(corps, signer(corps, ''), ''), false);
});

// --- Lecture d'une commande -------------------------------------------------

const COMMANDE = {
  id: 5823429345429,
  name: '#1001',
  currency: 'MAD',
  total_price: '349.00',
  total_outstanding: '349.00',
  financial_status: 'pending',
  payment_gateway_names: ['Cash on Delivery (COD)'],
  total_weight: 1250,
  note: 'Appeler avant',
  cancelled_at: null,
  shipping_address: {
    first_name: 'Karim',
    last_name: 'Idrissi',
    name: 'Karim Idrissi',
    phone: '+212 6 55 44 33 22',
    address1: '18 avenue Mohammed V',
    address2: 'Appt 4',
    city: 'Casa',
    zip: '20000',
  },
  line_items: [
    { title: 'Coffret', variant_title: 'Rouge', quantity: 2, sku: 'COF-R', variant_id: 111, requires_shipping: true },
    { title: 'Carte cadeau', variant_title: null, quantity: 1, sku: null, variant_id: 222, requires_shipping: false },
  ],
};

function lire(corps: unknown): CommandeShopifyLue {
  const lecture = lireCommandeShopify(corps);
  assert.equal(lecture.type, 'commande');
  return (lecture as { commande: CommandeShopifyLue }).commande;
}

test('commande en paiement à la livraison : destinataire, COD et articles', () => {
  const c = lire(COMMANDE);
  assert.equal(c.idCommande, '5823429345429');
  assert.equal(c.numero, '#1001');
  assert.equal(c.devise, 'MAD');
  assert.equal(c.clientNom, 'Karim Idrissi');
  assert.equal(c.telephoneBrut, '+212 6 55 44 33 22');
  assert.equal(c.ville, 'Casa');
  assert.equal(c.adresse, '18 avenue Mohammed V, Appt 4');
  assert.equal(c.codePostal, '20000');
  assert.equal(c.montantCod, 349);
  // La carte cadeau n'a rien à expédier : elle ne compte pas.
  assert.equal(c.quantite, 2);
  assert.equal(c.produitDescription, '2 × Coffret (Rouge)');
  assert.deepEqual(c.lignes, [{ titre: 'Coffret (Rouge)', quantite: 2, idVariante: '111', sku: 'COF-R' }]);
  assert.equal(c.poidsKg, 1.25);
  assert.equal(c.noteClient, 'Appeler avant');
  assert.deepEqual(c.manquants, []);
});

// Décision du 2026-09-26 : une commande payée en ligne devient un colis à COD 0.
test('commande prépayée : COD à 0, sans être écartée', () => {
  assert.equal(lire({ ...COMMANDE, total_outstanding: '0.00', financial_status: 'paid' }).montantCod, 0);
  // Sans total_outstanding, le statut financier tranche.
  const { total_outstanding: _ignore, ...sansRestant } = COMMANDE;
  void _ignore;
  assert.equal(lire({ ...sansRestant, financial_status: 'paid' }).montantCod, 0);
  assert.equal(lire({ ...sansRestant, financial_status: 'pending' }).montantCod, 349);
});

test('le montant restant dû prime sur le total (acompte versé)', () => {
  assert.equal(lire({ ...COMMANDE, total_outstanding: '149.505' }).montantCod, 149.51);
  assert.equal(lire({ ...COMMANDE, total_outstanding: '-5' }).montantCod, 0);
});

test('destinataire : repli sur la facturation puis sur le client', () => {
  const c = lire({
    ...COMMANDE,
    shipping_address: null,
    phone: null,
    billing_address: { first_name: 'Sara', last_name: 'B.', address1: '2 rue X', city: 'Rabat', phone: '0611223344' },
  });
  assert.equal(c.clientNom, 'Sara B.');
  assert.equal(c.ville, 'Rabat');
  assert.equal(c.telephoneBrut, '0611223344');

  const d = lire({
    ...COMMANDE,
    shipping_address: null,
    customer: { first_name: 'Nadia', phone: '0700000000', default_address: { city: 'Fès', address1: 'Derb 3' } },
  });
  assert.equal(d.clientNom, 'Nadia');
  assert.equal(d.telephoneBrut, '0700000000');
  assert.equal(d.ville, 'Fès');
});

// Une commande sans téléphone ni adresse n'est PAS perdue : le colis est créé,
// et le marchand sait quoi compléter.
test('données du destinataire absentes : colis quand même, champs manquants listés', () => {
  const c = lire({ id: 42, name: '#1002', line_items: [{ title: 'Article', quantity: 1 }] });
  assert.equal(c.clientNom, 'Client Shopify');
  assert.equal(c.telephoneBrut, null);
  assert.equal(c.ville, '');
  assert.deepEqual(c.manquants, ['nom', 'téléphone', 'ville', 'adresse']);
});

test('commandes ignorées : annulée, ou rien à expédier', () => {
  const annulee = lireCommandeShopify({ ...COMMANDE, cancelled_at: '2026-09-26T10:00:00Z' });
  assert.equal(annulee.type, 'ignoree');

  const sansExpedition = lireCommandeShopify({
    ...COMMANDE,
    line_items: [{ title: 'Carte cadeau', quantity: 1, requires_shipping: false }],
  });
  assert.equal(sansExpedition.type, 'ignoree');
  assert.equal(sansExpedition.type === 'ignoree' && sansExpedition.numero, '#1001');
});

test('corps illisible : refusé avec une ErreurShopify', () => {
  for (const corps of [null, [], 'texte', {}, { id: 'abc' }]) {
    assert.throws(() => lireCommandeShopify(corps), ErreurShopify, JSON.stringify(corps));
  }
});

test('les montants hors bornes de la colonne sont plafonnés, pas envoyés à PostgreSQL', () => {
  const c = lire({ ...COMMANDE, total_outstanding: '1000000000', total_weight: 99_999_999 });
  assert.equal(c.montantCod, 99_999_999.99);
  assert.equal(c.poidsKg, 9_999.99);
});

test('description tronquée à 500 caractères', () => {
  const lignes = Array.from({ length: 40 }, (_, i) => ({ title: `Article numéro ${i} au nom très long`, quantity: 1 }));
  const c = lire({ ...COMMANDE, line_items: lignes });
  assert.equal(c.produitDescription?.length, 500);
  assert.equal(c.quantite, 40);
});

// --- Matrice des permissions ------------------------------------------------

test('le webhook Shopify et les routes marchand ne sont gouvernés par aucune permission', () => {
  assert.equal(apiPermissionFor('/api/v1/webhooks/shopify', 'POST'), null);
  for (const chemin of ['', '/tester', '/produits', '/webhook']) {
    assert.equal(apiPermissionFor(`/api/integrations/shopify${chemin}`, 'POST'), null, chemin);
  }
  // L'administration des plateformes, elle, reste gouvernée.
  assert.equal(apiPermissionFor('/api/plateformes', 'GET'), 'integrations:manage');
});
