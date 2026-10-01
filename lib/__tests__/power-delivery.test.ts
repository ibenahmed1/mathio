import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  ErreurPowerDelivery,
  codeExterneDeReponse,
  construireColisPower,
  creerColisPower,
  lireSuivi,
  lireWebhookPower,
  suivreColisPower,
  type ColisAConfier,
} from '../power-delivery';

const COLIS: ColisAConfier = {
  codeSuivi: 'PD-000123',
  clientNom: '  Ahmed Benali ',
  clientTelephone: ' 0654987178 ',
  adresse: ' Rue Al Maghrib Al Arabi, Maarif ',
  montantCod: '399.005',
  ouvrir: true,
  fragile: false,
  aRemplacer: false,
  produitDescription: 'Montre',
  quantite: 2,
};

// ------------------------------------------------------------
// Construction du colis
// ------------------------------------------------------------

// Le marchand ne doit jamais leur parvenir. La liste des clés est figée ici :
// un champ ajouté plus tard devra l'être en connaissance de cause.
test('le colis transmis ne porte que les champs autorisés', () => {
  const colis = construireColisPower(COLIS, 4240);
  assert.deepEqual(Object.keys(colis).sort(), [
    'parcel_address', 'parcel_city', 'parcel_code', 'parcel_note', 'parcel_open', 'parcel_payment_mode',
    'parcel_phone', 'parcel_price', 'parcel_product_name', 'parcel_product_qty', 'parcel_receiver',
  ]);
});

test('notre code part avec le préfixe MTH-', () => {
  assert.equal(construireColisPower(COLIS, 4240).parcel_code, 'MTH-PD-000123');
});

test('les champs sont détourés, le COD arrondi, l’ouverture en 0/1', () => {
  const colis = construireColisPower(COLIS, 4240);
  assert.equal(colis.parcel_receiver, 'Ahmed Benali');
  assert.equal(colis.parcel_phone, '0654987178');
  assert.equal(colis.parcel_address, 'Rue Al Maghrib Al Arabi, Maarif');
  assert.equal(colis.parcel_price, 399.01);
  assert.equal(colis.parcel_open, 1);
  assert.equal(colis.parcel_city, 4240);
  assert.equal(colis.parcel_payment_mode, 'COD');
});

test('un Decimal Prisma est accepté comme montant', () => {
  const decimal = { toString: () => '250.00' };
  assert.equal(construireColisPower({ ...COLIS, montantCod: decimal }, 1).parcel_price, 250);
});

test('un montant COD illisible est refusé plutôt qu’envoyé', () => {
  assert.throws(() => construireColisPower({ ...COLIS, montantCod: 'abc' }, 1));
  assert.throws(() => construireColisPower({ ...COLIS, montantCod: -5 }, 1));
});

test('la note ne porte que des consignes standardisées', () => {
  assert.equal(construireColisPower(COLIS, 1).parcel_note, '');
  const note = construireColisPower({ ...COLIS, fragile: true, aRemplacer: true }, 1).parcel_note;
  assert.match(note, /fragile/i);
  assert.match(note, /échange/i);
});

test('une quantité nulle part pour 1', () => {
  assert.equal(construireColisPower({ ...COLIS, quantite: 0 }, 1).parcel_product_qty, 1);
});

// ------------------------------------------------------------
// Lecture défensive des réponses
// ------------------------------------------------------------

test('le code externe est trouvé là où leurs réponses le rangent', () => {
  assert.equal(codeExterneDeReponse({ success: true, parcel: { code: 'POW549871' } }), 'POW549871');
  assert.equal(codeExterneDeReponse({ success: true, data: { tracking_code: 'X1' } }), 'X1');
  assert.equal(codeExterneDeReponse({ success: true, code: 42 }), '42');
});

test('sans code dans la réponse, rien n’est inventé', () => {
  assert.equal(codeExterneDeReponse({ success: true, message: 'ok' }), null);
  assert.equal(codeExterneDeReponse('ok'), null);
  assert.equal(codeExterneDeReponse(null), null);
});

test('le suivi se lit sur l’exemple de leur documentation', () => {
  const suivi = lireSuivi({
    success: true,
    parcel: { code: 'MKS092416402PK', payment_status: 'NOT_PAID', delivery_status: 'RETURNED' },
    tracking: { current_status: 'RETURNED', description: 'Retourné' },
  });
  assert.equal(suivi.statut, 'RETURNED');
  assert.equal(suivi.paiement, 'NOT_PAID');
});

test('le suivi se replie sur tracking.current_status', () => {
  assert.equal(lireSuivi({ tracking: { current_status: 'DELIVERED' } }).statut, 'DELIVERED');
});

// ------------------------------------------------------------
// Appels : le token ne sort jamais
// ------------------------------------------------------------

const TOKEN = 'secret-de-test-a-ne-jamais-afficher';
const fetchOriginal = globalThis.fetch;
const tokenOriginal = process.env.POWERDELIVERY_TOKEN;
let dernierAppel: { url: string; init: RequestInit } | null = null;

function repondre(statut: number, corps: unknown): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    dernierAppel = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify(corps), { status: statut });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.POWERDELIVERY_TOKEN = TOKEN;
  dernierAppel = null;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (tokenOriginal === undefined) delete process.env.POWERDELIVERY_TOKEN;
  else process.env.POWERDELIVERY_TOKEN = tokenOriginal;
});

// Ces deux tests disent la même chose que leur API : elle ne lit pas
// l'autorisation de la même façon des deux côtés. Vérifié le 23/09/2026 contre
// leur production, avec le même token — `/listcities` et `/trackparcel`
// acceptent le token nu, `/files/webhook.php` répond « Missing or invalid
// authorization header » et n'accepte que « Bearer ». Le test précédent
// n'affirmait que la première moitié, et la déclaration du webhook échouait.
test('sur les routes colis, le token part nu dans Authorization', async () => {
  repondre(200, { success: true, parcel: { code: 'P1' } });
  await creerColisPower(construireColisPower(COLIS, 1));
  const entetes = dernierAppel!.init.headers as Record<string, string>;
  assert.equal(entetes.Authorization, TOKEN);
  assert.equal(dernierAppel!.url, 'https://elog.ma/apiclient/addparcelsnew');
});

test('sur /files/*, le token part precede de Bearer', async () => {
  repondre(200, { success: true, webhook: null });
  await lireWebhookPower();
  const entetes = dernierAppel!.init.headers as Record<string, string>;
  assert.equal(entetes.Authorization, `Bearer ${TOKEN}`);
  assert.equal(dernierAppel!.url, 'https://elog.ma/apiclient/files/webhook.php');
});

test('une erreur HTTP ne cite jamais le token', async () => {
  repondre(401, { success: false, message: 'Token invalide' });
  await assert.rejects(creerColisPower(construireColisPower(COLIS, 1)), (erreur: unknown) => {
    assert.ok(erreur instanceof ErreurPowerDelivery);
    assert.equal(erreur.statutHttp, 401);
    assert.ok(!erreur.message.includes(TOKEN));
    assert.match(erreur.message, /Token invalide/);
    return true;
  });
});

test('un success: false sous un 200 est un échec', async () => {
  repondre(200, { success: false, message: 'Code déjà utilisé' });
  await assert.rejects(creerColisPower(construireColisPower(COLIS, 1)), /Code déjà utilisé/);
});

test('sans token, aucun appel n’est tenté', async () => {
  delete process.env.POWERDELIVERY_TOKEN;
  repondre(200, { success: true });
  await assert.rejects(suivreColisPower('MTH-PD-1'), ErreurPowerDelivery);
  assert.equal(dernierAppel, null);
});

test('le code suivi est encodé dans l’URL', async () => {
  repondre(200, { success: true, parcel: { delivery_status: 'DELIVERED' } });
  await suivreColisPower('MTH-PD 1&x');
  assert.equal(dernierAppel!.url, 'https://elog.ma/apiclient/trackparcel?parcel_code=MTH-PD%201%26x');
});
