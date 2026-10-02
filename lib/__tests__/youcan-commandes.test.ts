import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  ErreurYoucan,
  lireCommandeYoucan,
  signatureRetourOAuthValide,
  signatureYoucanValide,
  type CommandeYoucanLue,
} from '../youcan-commandes';
import { apiPermissionFor } from '../permission-routes';

// Seules les décisions sans base sont testées ici. Les formes de commande
// suivent la doc YouCan (« Get Order », entités Order/Customer/Address) :
// aucune commande réelle n'a encore été reçue.

// --- Signature --------------------------------------------------------------

const SECRET = 'secret-client-oauth';
const corps = '{"event_name":"order.created","data":{"id":"x"}}';
const signer = (c: string, s = SECRET) => createHmac('sha256', s).update(c).digest('hex');

test('la signature est un HMAC-SHA256 hexadécimal du corps brut, avec le secret de l’application', () => {
  assert.equal(signatureYoucanValide(corps, signer(corps), SECRET), true);
  assert.equal(signatureYoucanValide(Buffer.from(corps), signer(corps).toUpperCase(), SECRET), true);
});

test('la signature refuse un corps modifié, un autre secret, un en-tête absent ou mal formé', () => {
  assert.equal(signatureYoucanValide(corps + ' ', signer(corps), SECRET), false);
  assert.equal(signatureYoucanValide(corps, signer(corps, 'autre'), SECRET), false);
  assert.equal(signatureYoucanValide(corps, null, SECRET), false);
  assert.equal(signatureYoucanValide(corps, signer(corps), ''), false);
  // L'encodage base64 de Shopify n'est pas accepté ici.
  assert.equal(
    signatureYoucanValide(corps, createHmac('sha256', SECRET).update(corps).digest('base64'), SECRET),
    false
  );
});

// --- Retour OAuth ------------------------------------------------------------

test('le retour OAuth est signé sur la chaîne de requête sans hmac, dans l’ordre reçu', () => {
  const reste = 'timestamp=1790444817&code=def502abc&store=boutique&seller=a091e397&locale=fr&embedded=0';
  const hmac = signer(reste);
  assert.equal(signatureRetourOAuthValide(`?${reste}&hmac=${hmac}`, SECRET), true);
  // hmac placé ailleurs que ce dernier : retiré quand même.
  assert.equal(signatureRetourOAuthValide(`hmac=${hmac}&${reste}`, SECRET), true);
  // Paramètres réordonnés, code modifié, autre secret, hmac absent : refusé.
  assert.equal(signatureRetourOAuthValide(`store=boutique&timestamp=1790444817&code=def502abc&seller=a091e397&locale=fr&embedded=0&hmac=${hmac}`, SECRET), false);
  assert.equal(signatureRetourOAuthValide(`?${reste.replace('abc', 'abd')}&hmac=${hmac}`, SECRET), false);
  assert.equal(signatureRetourOAuthValide(`?${reste}&hmac=${hmac}`, 'autre'), false);
  assert.equal(signatureRetourOAuthValide(`?${reste}`, SECRET), false);
});

// --- Lecture d'une commande -------------------------------------------------

const ID = '72aa7882-3898-49a8-87a2-506af3dd7320';

function commandeType(surcharges: Record<string, unknown> = {}) {
  return {
    id: ID,
    ref: '021',
    total: 240,
    currency: 'MAD',
    status: 1,
    status_object: { slug: 'open', name: 'Open' },
    payment_status: 4,
    payment_status_new: 'Pending',
    notes: null,
    customer: {
      id: 'c1',
      first_name: 'Amine',
      last_name: 'Alaoui',
      phone: '+212 6 12 34 56 78',
      city: 'Casablanca',
      address: [],
    },
    payment: { status_text: 'pending', status_object: { slug: 'pending' }, gateway_type_text: 'Cash on Delivery', address: [] },
    shipping: {
      status_text: 'unfulfilled',
      address: {
        first_name: 'Amine',
        last_name: 'Alaoui',
        phone: '0612345678',
        first_line: '12 rue des Fleurs',
        second_line: 'Appt 3',
        city: 'Rabat',
        zip_code: '10000',
      },
    },
    variants: [
      {
        id: 'l1',
        price: 120,
        quantity: 2,
        variant: {
          id: 'v1',
          sku: 'MNT-01',
          values: ['Noir', 'L'],
          product: { id: 'p1', name: 'Montre' },
        },
      },
    ],
    ...surcharges,
  };
}

function lire(corpsCommande: unknown): CommandeYoucanLue {
  const lecture = lireCommandeYoucan(corpsCommande);
  assert.equal(lecture.type, 'commande');
  return (lecture as { commande: CommandeYoucanLue }).commande;
}

test('une commande en paiement à la livraison devient un colis au montant total', () => {
  const c = lire(commandeType());
  assert.equal(c.idCommande, ID);
  assert.equal(c.numero, '021');
  assert.equal(c.montantCod, 240);
  assert.equal(c.devise, 'MAD');
  assert.equal(c.clientNom, 'Amine Alaoui');
  assert.equal(c.telephoneBrut, '0612345678');
  assert.equal(c.ville, 'Rabat');
  assert.equal(c.adresse, '12 rue des Fleurs, Appt 3');
  assert.equal(c.codePostal, '10000');
  assert.equal(c.quantite, 2);
  assert.equal(c.produitDescription, '2 × Montre (Noir / L)');
  assert.deepEqual(c.lignes[0], { titre: 'Montre (Noir / L)', quantite: 2, idVariante: 'v1', sku: 'MNT-01' });
  assert.deepEqual(c.manquants, []);
});

test('une commande déjà payée donne un COD de 0, qu’on le lise sur `payment` ou au premier niveau', () => {
  assert.equal(lire(commandeType({ payment: { status_object: { slug: 'paid' } } })).montantCod, 0);
  assert.equal(lire(commandeType({ payment: undefined, payment_status_new: 'Paid' })).montantCod, 0);
});

test('une commande annulée est ignorée', () => {
  const lecture = lireCommandeYoucan(commandeType({ status_object: { slug: 'canceled' } }));
  assert.equal(lecture.type, 'ignoree');
});

test('sans adresse de livraison (`[]`), le destinataire est lu sur le client et son adresse par défaut', () => {
  const c = lire(
    commandeType({
      shipping: { address: [] },
      customer: {
        first_name: 'Sara',
        last_name: null,
        phone: '0700000000',
        city: 'Fès',
        address: [
          { first_line: 'Ancienne adresse', city: 'Meknès', default: false },
          { first_line: '5 avenue Hassan II', city: 'Fès', default: true },
        ],
      },
    })
  );
  assert.equal(c.clientNom, 'Sara');
  assert.equal(c.telephoneBrut, '0700000000');
  assert.equal(c.ville, 'Fès');
  assert.equal(c.adresse, '5 avenue Hassan II');
});

test('la commande « abrégée » du webhook crée quand même un colis, marqué à compléter', () => {
  const c = lire({ id: ID, ref: '10245', status: 1, total: 249.9, currency: 'MAD', customer: { id: 'c', first_name: 'X' } });
  assert.equal(c.montantCod, 249.9);
  assert.deepEqual(c.manquants, ['téléphone', 'ville', 'adresse', 'articles']);
  assert.equal(c.quantite, 1);
});

test('un produit sans déclinaison (variante « default ») garde son nom seul', () => {
  const c = lire(
    commandeType({
      variants: [{ quantity: 1, variant: { id: 'v', values: ['default'], product: { name: 'Sac' } } }],
    })
  );
  assert.equal(c.produitDescription, '1 × Sac');
});

test('un identifiant de commande absent ou étrange est refusé', () => {
  assert.throws(() => lireCommandeYoucan(commandeType({ id: undefined })), ErreurYoucan);
  assert.throws(() => lireCommandeYoucan(commandeType({ id: '../../me' })), ErreurYoucan);
  assert.throws(() => lireCommandeYoucan('pas un objet'), ErreurYoucan);
});

// --- Permissions ------------------------------------------------------------

test('le webhook YouCan est explicitement non gouverné, comme celui de Shopify', () => {
  assert.equal(apiPermissionFor('/api/v1/webhooks/youcan', 'POST'), null);
  assert.equal(apiPermissionFor('/api/integrations/youcan/callback', 'GET'), null);
});
