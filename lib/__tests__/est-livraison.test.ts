import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  ErreurColisEstLivraison,
  ErreurEstLivraison,
  construireCommandeEst,
  creerCommandeEst,
  lireCreation,
  lireSuppression,
  supprimerCommandesEst,
  type ColisAConfier,
} from '../est-livraison';

const CODE = 'JAD-RBIEC9-310726';

const COLIS: ColisAConfier = {
  codeSuivi: CODE,
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
// Construction de la commande
// ------------------------------------------------------------

// Leur schéma est en `additionalProperties: false` : un champ de trop fait
// refuser l'appel. La liste est figée ici — un ajout devra l'être sciemment.
test('la commande transmise ne porte que les champs autorisés', () => {
  const commande = construireCommandeEst(COLIS, 'OUJDA');
  assert.deepEqual(Object.keys(commande).sort(), [
    'city', 'code', 'is_echange', 'note', 'package_opened', 'price',
    'product_name', 'quantity', 'receiver_address', 'receiver_full_name',
    'receiver_phone_number',
  ]);
});

// Le marchand ne doit jamais leur parvenir : leurs `client_*` restent absents.
test('les champs client_* de leur API ne sont jamais renseignés', () => {
  const commande = construireCommandeEst(COLIS, 'OUJDA') as unknown as Record<string, unknown>;
  assert.equal('client_name' in commande, false);
  assert.equal('client_phone' in commande, false);
});

// Le code part brut : c'est lui qu'ils nous citeront sur
// /api/v1/livraisons/statut, qui cherche le colis sur ce champ exact.
test('notre code de suivi part sans préfixe', () => {
  assert.equal(construireCommandeEst(COLIS, 'OUJDA').code, CODE);
});

test('les champs sont détourés, le COD arrondi, les drapeaux en booléens', () => {
  const commande = construireCommandeEst({ ...COLIS, aRemplacer: true }, ' OUJDA ');
  assert.equal(commande.city, 'OUJDA');
  assert.equal(commande.receiver_full_name, 'Ahmed Benali');
  assert.equal(commande.receiver_phone_number, '0654987178');
  assert.equal(commande.receiver_address, 'Rue Al Maghrib Al Arabi, Maarif');
  assert.equal(commande.price, 399.01);
  assert.equal(commande.quantity, 2);
  assert.equal(commande.is_echange, true);
  assert.equal(commande.package_opened, true);
});

test('un Decimal Prisma est accepté comme montant', () => {
  const decimal = { toString: () => '250.00' };
  assert.equal(construireCommandeEst({ ...COLIS, montantCod: decimal }, 'OUJDA').price, 250);
});

// Leur `price` vaut 0 par défaut, et 0 sur un COD veut dire « ne rien
// encaisser » : il est toujours envoyé, jamais omis.
test('le prix est toujours présent, même à zéro', () => {
  const commande = construireCommandeEst({ ...COLIS, montantCod: 0 }, 'OUJDA');
  assert.equal(commande.price, 0);
  assert.equal('price' in commande, true);
});

test('un montant COD illisible est refusé plutôt qu’envoyé', () => {
  assert.throws(() => construireCommandeEst({ ...COLIS, montantCod: 'abc' }, 'OUJDA'), ErreurColisEstLivraison);
  assert.throws(() => construireCommandeEst({ ...COLIS, montantCod: -5 }, 'OUJDA'), ErreurColisEstLivraison);
});

// L'échange a son propre champ chez eux : la consigne ferait doublon.
test('la note ne porte que la consigne « fragile »', () => {
  assert.equal(construireCommandeEst(COLIS, 'OUJDA').note, '');
  assert.equal(construireCommandeEst({ ...COLIS, aRemplacer: true }, 'OUJDA').note, '');
  assert.match(construireCommandeEst({ ...COLIS, fragile: true }, 'OUJDA').note, /fragile/i);
});

test('une quantité nulle part pour 1', () => {
  assert.equal(construireCommandeEst({ ...COLIS, quantite: 0 }, 'OUJDA').quantity, 1);
});

// Un champ d'information se tronque : on perd du confort, pas un colis.
test('le nom du produit est tronqué à 350 caractères', () => {
  const commande = construireCommandeEst({ ...COLIS, produitDescription: 'x'.repeat(400) }, 'OUJDA');
  assert.equal(commande.product_name.length, 350);
});

// Un champ dont dépend la livraison se refuse : une adresse coupée envoie le
// colis à une adresse incomplète, ce qui est pire qu'un colis non remis.
test('une adresse ou un nom trop long fait refuser le colis, jamais tronquer', () => {
  assert.throws(
    () => construireCommandeEst({ ...COLIS, adresse: 'x'.repeat(351) }, 'OUJDA'),
    (erreur: unknown) => {
      assert.ok(erreur instanceof ErreurColisEstLivraison);
      assert.equal(erreur.codeSuivi, CODE);
      assert.match(erreur.message, /adresse/i);
      return true;
    }
  );
  assert.throws(() => construireCommandeEst({ ...COLIS, clientNom: 'x'.repeat(351) }, 'OUJDA'), ErreurColisEstLivraison);
});

test('un champ requis vide fait refuser le colis avant tout appel', () => {
  assert.throws(() => construireCommandeEst({ ...COLIS, clientTelephone: '   ' }, 'OUJDA'), ErreurColisEstLivraison);
  assert.throws(() => construireCommandeEst(COLIS, '  '), ErreurColisEstLivraison);
});

// ------------------------------------------------------------
// Lecture défensive des réponses
// ------------------------------------------------------------

// Leur réponse RÉELLE, relevée le 23/09/2026 contre leur serveur. Au singulier,
// et `city_created` vaut `null` quand la ville existait deja chez eux — leur
// documentation annonce un pluriel qui n'existe pas.
function reponseOk(code = CODE): Record<string, unknown> {
  return {
    success: true,
    inserted: 1,
    command_id: 'ar9g1pvqkjayy06',
    command_code: code,
    city_created: null,
  };
}

// La forme que leur OpenAPI decrit, jamais observee. Lue quand meme : le jour
// ou ils aligneraient leur API sur leur doc, l'alarme ne doit pas se taire.
function reponseOkDocumentee(code = CODE): Record<string, unknown> {
  return {
    success: true,
    inserted: 1,
    command_ids: ['rec_abc123'],
    inserted_codes: [code],
    cities_created: [],
  };
}

test('une création confirmée rend leur identifiant d’enregistrement', () => {
  assert.equal(lireCreation(reponseOk(), CODE).idExterne, 'ar9g1pvqkjayy06');
});

test('la forme documentée, si elle arrivait un jour, est lue aussi', () => {
  assert.equal(lireCreation(reponseOkDocumentee(), CODE).idExterne, 'rec_abc123');
});

test('sans identifiant dans la réponse, rien n’est inventé', () => {
  const sansId = { ...reponseOk() };
  delete sansId.command_id;
  assert.equal(lireCreation(sansId, CODE).idExterne, null);
});

// La règle centrale du module : leur API CRÉE la ville qu'elle ne connaît pas.
// Une ville créée prouve que le libellé envoyé est faux.
test('une ville créée au passage est un ÉCHEC, jamais un succès', () => {
  assert.throws(
    () => lireCreation({ ...reponseOk(), city_created: 'NADOR' }, CODE),
    (erreur: unknown) => {
      assert.ok(erreur instanceof ErreurEstLivraison);
      assert.match(erreur.message, /CRÉÉ la ville/);
      assert.match(erreur.message, /NADOR/);
      return true;
    }
  );
});

test('l’alarme reste armée sous la forme documentée', () => {
  assert.throws(
    () => lireCreation({ ...reponseOkDocumentee(), cities_created: ['NADOR'] }, CODE),
    /CRÉÉ la ville/
  );
});

test('un succès qui ne cite pas notre code est refusé', () => {
  assert.throws(() => lireCreation(reponseOk('AUTRE-CODE'), CODE), ErreurEstLivraison);
  const sansCode = { ...reponseOk() };
  delete sansCode.command_code;
  assert.throws(() => lireCreation(sansCode, CODE), ErreurEstLivraison);
});

test('un succès annonçant zéro création est refusé', () => {
  assert.throws(() => lireCreation({ ...reponseOk(), inserted: 0 }, CODE), ErreurEstLivraison);
});

test('une réponse illisible est refusée plutôt qu’interprétée', () => {
  assert.throws(() => lireCreation('ok', CODE), ErreurEstLivraison);
  assert.throws(() => lireCreation(null, CODE), ErreurEstLivraison);
});

test('la suppression se lit sur l’exemple de leur documentation', () => {
  const suppression = lireSuppression({
    success: true,
    deleted: 2,
    command_ids: ['rec_abc123', 'rec_def456'],
    deleted_codes: ['CMD-0001', 'CMD-0002'],
  });
  assert.deepEqual(suppression.codesSupprimes, ['CMD-0001', 'CMD-0002']);
});

// ------------------------------------------------------------
// Appels : la clé ne sort jamais
// ------------------------------------------------------------

const CLE = 'cle-de-test-a-ne-jamais-afficher';
const fetchOriginal = globalThis.fetch;
const cleOriginale = process.env.EST_LIVRAISON_CLE;
const baseOriginale = process.env.EST_LIVRAISON_BASE_URL;
let dernierAppel: { url: string; init: RequestInit } | null = null;

function repondre(statut: number, corps: unknown): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    dernierAppel = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify(corps), { status: statut });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.EST_LIVRAISON_CLE = CLE;
  delete process.env.EST_LIVRAISON_BASE_URL;
  dernierAppel = null;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (cleOriginale === undefined) delete process.env.EST_LIVRAISON_CLE;
  else process.env.EST_LIVRAISON_CLE = cleOriginale;
  if (baseOriginale === undefined) delete process.env.EST_LIVRAISON_BASE_URL;
  else process.env.EST_LIVRAISON_BASE_URL = baseOriginale;
});

// Leur chemin porte une faute de frappe (« rammasage ») et un préfixe inversé
// (`/v1/api`). Le corriger donne un 404 : il est recopié à l'identique.
test('la clé part dans Client-Key, sur leur chemin recopié tel quel', async () => {
  repondre(200, reponseOk());
  await creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA'));
  const entetes = dernierAppel!.init.headers as Record<string, string>;
  assert.equal(entetes['Client-Key'], CLE);
  assert.equal(dernierAppel!.url, 'https://pb.estlivraison.com/v1/api/clients/commands/add-rammasage');
});

// Leur serveur ne lit AUCUNE enveloppe : le corps est plat, un colis par appel.
test('la commande part à plat, sans enveloppe commands', async () => {
  repondre(200, reponseOk());
  await creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA'));
  const corps = JSON.parse(String(dernierAppel!.init.body)) as Record<string, unknown>;
  assert.equal('commands' in corps, false);
  assert.equal(corps.code, CODE);
  assert.equal(corps.city, 'OUJDA');
  assert.equal(corps.receiver_phone_number, '0654987178');
});

test('une erreur HTTP ne cite jamais la clé', async () => {
  repondre(401, { message: 'Invalid Client-Key token' });
  await assert.rejects(creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA')), (erreur: unknown) => {
    assert.ok(erreur instanceof ErreurEstLivraison);
    assert.equal(erreur.statutHttp, 401);
    assert.ok(!erreur.message.includes(CLE));
    assert.match(erreur.message, /Invalid Client-Key token/);
    return true;
  });
});

// Leur doublon sort en 400, pas en 409. C'est notre seul garde-fou
// d'idempotence : le message prouve que le colis existe déjà chez eux.
test('un code déjà utilisé remonte leur message tel quel', async () => {
  repondre(400, { data: {}, message: 'Code already exists.', status: 400 });
  await assert.rejects(
    creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA')),
    /already exists/i
  );
});

// Leur enveloppe d'erreur réelle est celle de PocketBase : { data, message, status }.
test('un success: false sous un 200 est un échec', async () => {
  repondre(200, { success: false, data: {}, message: 'City is required.', status: 400 });
  await assert.rejects(creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA')), /City is required/);
});

test('leur enveloppe d’erreur PocketBase est lue', async () => {
  repondre(400, { data: {}, message: 'Receiver_phone_number is required.', status: 400 });
  await assert.rejects(
    creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA')),
    /Receiver_phone_number is required/
  );
});

test('sans clé, aucun appel n’est tenté', async () => {
  delete process.env.EST_LIVRAISON_CLE;
  repondre(200, reponseOk());
  await assert.rejects(creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA')), /EST_LIVRAISON_CLE/);
  assert.equal(dernierAppel, null);
});

test('la base est surchargeable pour les tests', async () => {
  process.env.EST_LIVRAISON_BASE_URL = 'http://127.0.0.1:4011/';
  repondre(200, reponseOk());
  await creerCommandeEst(construireCommandeEst(COLIS, 'OUJDA'));
  assert.equal(dernierAppel!.url, 'http://127.0.0.1:4011/v1/api/clients/commands/add-rammasage');
});

test('la suppression envoie les codes et cite leur chemin', async () => {
  repondre(200, { success: true, deleted: 1, command_ids: ['rec_1'], deleted_codes: [CODE] });
  const suppression = await supprimerCommandesEst([CODE]);
  assert.deepEqual(suppression.codesSupprimes, [CODE]);
  assert.equal(dernierAppel!.url, 'https://pb.estlivraison.com/v1/api/clients/commands/delete');
  assert.deepEqual(JSON.parse(String(dernierAppel!.init.body)), { commands: [CODE] });
});

test('une suppression sans code ne part pas', async () => {
  repondre(200, { success: true });
  await assert.rejects(supprimerCommandesEst([]), ErreurEstLivraison);
  assert.equal(dernierAppel, null);
});

// Un colis déjà ramassé ne peut plus être annulé : leur message le dit, on le
// remonte tel quel plutôt que de le traduire en « erreur inconnue ».
test('un colis déjà ramassé remonte leur motif de refus', async () => {
  repondre(400, { message: 'commands[0] cannot be deleted because it is already ramassed' });
  await assert.rejects(supprimerCommandesEst([CODE]), /already ramassed/);
});
