import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { ApiRequestError, apiGet, apiPost } from '../api-client';
import { deconnecter } from '../deconnexion';

// `request` passe par le `fetch` global : chaque test le remplace par une
// réponse fabriquée. De vraies `Response`, et non des objets imités, pour que
// `ok`, `status` et `text()` se comportent exactement comme dans le navigateur.
const fetchOriginal = globalThis.fetch;

function repondre(corps: string, status: number, contentType = 'application/json'): void {
  globalThis.fetch = (async () =>
    new Response(corps, { status, headers: { 'Content-Type': contentType } })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

// La page réellement servie par Next quand son routeur ignore une route —
// constatée le 11/09/2026 sur POST /api/auth/logout, avec un cache .next
// incohérent. Tronquée : seul le premier caractère compte pour JSON.parse.
const PAGE_404_NEXT =
  '<!DOCTYPE html><html lang="fr"><head><title>404: This page could not be found.</title></head><body></body></html>';

function estErreurApi(message: string, details: unknown = null) {
  return (err: unknown) => {
    assert.ok(err instanceof ApiRequestError, `attendu ApiRequestError, reçu ${String(err)}`);
    assert.equal(err.message, message);
    assert.deepEqual(err.details, details);
    return true;
  };
}

// ------------------------------------------------------------
// Corps non JSON — ce qui levait une SyntaxError
// ------------------------------------------------------------

test('une page HTML 404 de Next devient « Erreur 404 », jamais une SyntaxError', async () => {
  repondre(PAGE_404_NEXT, 404, 'text/html');
  await assert.rejects(apiPost('/api/auth/logout'), estErreurApi('Erreur 404'));
});

test('une page 502 de l’hébergeur devient « Erreur 502 »', async () => {
  repondre('<html><body><h1>502 Bad Gateway</h1></body></html>', 502, 'text/html');
  await assert.rejects(apiGet('/api/finance'), estErreurApi('Erreur 502'));
});

// Renvoyer ce corps comme donnée ferait lire `undefined` plus loin, dans un
// écran sans rapport avec la cause : mieux vaut échouer ici, lisiblement.
test('un 200 illisible est signalé, pas renvoyé comme une donnée', async () => {
  repondre(PAGE_404_NEXT, 200, 'text/html');
  await assert.rejects(apiGet('/api/finance'), estErreurApi('Réponse inattendue du serveur'));
});

// ------------------------------------------------------------
// Ce qui marchait déjà ne doit pas bouger
// ------------------------------------------------------------

test('le message d’erreur JSON de l’API est conservé, avec tout son détail', async () => {
  const corps = { error: 'Fichier invalide', erreurs: [{ ligne: 3, motif: 'téléphone manquant' }] };
  repondre(JSON.stringify(corps), 422);
  await assert.rejects(apiPost('/api/commandes/import', {}), estErreurApi('Fichier invalide', corps));
});

// Le proxy refuse un hôte ou un espace par `new NextResponse(null, { status: 404 })`.
test('le 404 à corps vide du proxy donne « Erreur 404 »', async () => {
  repondre('', 404);
  await assert.rejects(apiGet('/admin/inconnu'), estErreurApi('Erreur 404'));
});

test('une erreur JSON sans champ `error` retombe sur le statut', async () => {
  repondre(JSON.stringify({ detail: 'x' }), 500);
  await assert.rejects(apiGet('/api/finance'), estErreurApi('Erreur 500', { detail: 'x' }));
});

test('une réponse JSON valide est renvoyée telle quelle', async () => {
  repondre(JSON.stringify({ data: [1, 2] }), 200);
  assert.deepEqual(await apiGet('/api/finance'), { data: [1, 2] });
});

test('un 200 à corps vide renvoie null', async () => {
  repondre('', 200);
  assert.equal(await apiPost('/api/auth/logout'), null);
});

// ------------------------------------------------------------
// Déconnexion
// ------------------------------------------------------------

test('une déconnexion réussie ne renvoie aucun message', async () => {
  repondre('', 200);
  assert.equal(await deconnecter(), null);
});

// Le cas du 11/09/2026 : le bouton restait sans effet. Le message doit dire
// que la session est TOUJOURS ouverte — c'est ce qui justifie de ne pas
// rediriger vers /login.
test('une déconnexion en échec dit pourquoi, et que la session reste ouverte', async () => {
  repondre(PAGE_404_NEXT, 404, 'text/html');
  const message = await deconnecter();
  assert.ok(message, 'un message est attendu');
  assert.match(message, /Erreur 404/);
  assert.match(message, /session est toujours ouverte/);
});

test('une panne réseau est rattrapée aussi', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  const message = await deconnecter();
  assert.ok(message, 'un message est attendu');
  assert.match(message, /Failed to fetch/);
});
