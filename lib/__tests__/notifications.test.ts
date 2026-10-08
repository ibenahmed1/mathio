import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TYPES_NOTIFICATION,
  contenuStatutColis,
  definitionNotification,
  doitAfficher,
  doitPousser,
  espaceDuLien,
  nettoyerClocheCoupes,
  nettoyerPushCoupes,
  prefixesDeLEspace,
  statutNotifie,
} from '../notifications-catalogue';
import { estJetonInvalide } from '../push-firebase';
import { pagePermissionFor } from '../permission-routes';
import { permissionApiMarchand, permissionPageMarchand } from '../permissions-marchand';

test('catalogue : clés uniques, au format famille.evenement', () => {
  const cles = TYPES_NOTIFICATION.map((t) => t.cle);
  assert.equal(new Set(cles).size, cles.length);
  for (const cle of cles) assert.match(cle, /^[a-z_]+\.[a-z_]+$/);
});

test('catalogue : « colis livré » reste en cloche seule (décision du 28/09/2026)', () => {
  assert.equal(definitionNotification('colis.livre')?.push, false);
  assert.equal(definitionNotification('colis.refuse')?.push, true);
});

test("catalogue : l'admin peut régler les écritures comptables, cloche et push séparément (07/10/2026)", () => {
  const def = definitionNotification('comptabilite.transaction');
  assert.equal(def?.espace, 'admin');
  assert.equal(def?.famille, 'comptabilite');
  assert.equal(def?.push, true);
  assert.deepEqual(nettoyerPushCoupes(['comptabilite.transaction']), ['comptabilite.transaction']);
  assert.deepEqual(nettoyerClocheCoupes(['comptabilite.transaction']), ['comptabilite.transaction']);
  assert.equal(doitPousser('comptabilite.transaction', ['comptabilite.transaction']), false);
  assert.equal(doitAfficher('comptabilite.transaction', []), true);
});

test('doitPousser : type qui pousse, sauf coupé ; jamais un type cloche-seule ni inconnu', () => {
  assert.equal(doitPousser('colis.refuse', []), true);
  assert.equal(doitPousser('colis.refuse', ['colis.refuse']), false);
  assert.equal(doitPousser('colis.livre', []), false);
  assert.equal(doitPousser('type.disparu', []), false);
});

test('nettoyerPushCoupes : ne garde que des types qui poussent, dédupliqués', () => {
  assert.deepEqual(nettoyerPushCoupes(['colis.refuse', 'colis.refuse', 'colis.livre', 'inconnu', 42]), ['colis.refuse']);
  assert.deepEqual(nettoyerPushCoupes('colis.refuse'), []);
  assert.deepEqual(nettoyerPushCoupes(undefined), []);
});

test("espaceDuLien : l'espace est lu dans le premier segment", () => {
  assert.equal(espaceDuLien('/marchand/colis/abc'), 'marchand');
  assert.equal(espaceDuLien('/marchand?x=1'), 'marchand');
  assert.equal(espaceDuLien('/admin/reclamations'), 'admin');
  assert.equal(espaceDuLien('/livreur/bons-distribution/1'), 'terrain');
  assert.equal(espaceDuLien('/ramasseur'), 'terrain');
  // Un préfixe homonyme n'est pas l'espace : /marchandises n'est pas /marchand.
  assert.equal(espaceDuLien('/marchandises'), null);
  assert.equal(espaceDuLien('https://ailleurs.test/admin'), null);
  assert.equal(espaceDuLien(null), null);
});

test("prefixesDeLEspace : terrain couvre livreur ET ramasseur", () => {
  assert.deepEqual(prefixesDeLEspace('terrain').sort(), ['/livreur', '/ramasseur']);
  assert.deepEqual(prefixesDeLEspace('admin'), ['/admin']);
  // Chaque préfixe renvoie bien à son espace : les deux tables ne divergent pas.
  for (const espace of ['admin', 'marchand', 'terrain'] as const) {
    for (const p of prefixesDeLEspace(espace)) assert.equal(espaceDuLien(`${p}/x`), espace);
  }
});

test('statutNotifie : seuls les statuts qui appellent une réaction', () => {
  for (const s of ['livre', 'refuse', 'retourne', 'injoignable', 'numero_errone'] as const) assert.ok(statutNotifie(s));
  for (const s of ['ramasse', 'en_transit', 'reporte', 'mise_en_distribution'] as const) assert.ok(!statutNotifie(s));
});

test('contenuStatutColis : un colis → sa fiche', () => {
  const n = contenuStatutColis('refuse', [{ id: 'c1', codeSuivi: 'MD-001', clientNom: 'Salma B.' }]);
  assert.deepEqual(n, { type: 'colis.refuse', titre: 'Colis MD-001 : refusé', corps: 'Salma B.', lien: '/marchand/colis/c1' });
});

test('contenuStatutColis : plusieurs colis → la liste filtrée, trois codes au plus', () => {
  const colis = ['1', '2', '3', '4'].map((i) => ({ id: `c${i}`, codeSuivi: `MD-00${i}`, clientNom: 'x' }));
  const n = contenuStatutColis('numero_errone', colis);
  assert.equal(n.type, 'colis.injoignable');
  assert.equal(n.titre, '4 colis : numéros erronés');
  assert.equal(n.corps, 'MD-001, MD-002, MD-003…');
  assert.equal(n.lien, '/marchand/colis?statut=numero_errone');
  assert.equal(espaceDuLien(n.lien), 'marchand');
});

test('estJetonInvalide : seuls les refus qui condamnent le jeton', () => {
  assert.equal(estJetonInvalide(404, '{}'), true);
  assert.equal(estJetonInvalide(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}'), true);
  assert.equal(estJetonInvalide(403, '{"error":{"details":[{"errorCode":"SENDER_ID_MISMATCH"}]}}'), true);
  // Un défaut de NOTRE message ne doit pas faire purger les appareils.
  assert.equal(estJetonInvalide(400, '{"error":{"status":"INVALID_ARGUMENT"}}'), false);
  assert.equal(estJetonInvalide(500, 'erreur'), false);
});

test("doitAfficher : la cloche reçoit tout, sauf ce que le compte a coupé", () => {
  assert.equal(doitAfficher('colis.livre', []), true);
  assert.equal(doitAfficher('colis.livre', ['colis.livre']), false);
  // Couper le push ne coupe pas la cloche : deux réglages indépendants.
  assert.equal(doitAfficher('colis.refuse', []), true);
  assert.equal(doitPousser('colis.refuse', []), true);
  assert.equal(doitAfficher('colis.refuse', ['colis.refuse']), false);
  assert.equal(doitPousser('colis.refuse', []), true);
});

test("nettoyerClocheCoupes : toute clé du catalogue, y compris les types cloche-seule", () => {
  assert.deepEqual(nettoyerClocheCoupes(['colis.livre', 'colis.livre', 'inconnu', 3]), ['colis.livre']);
  assert.deepEqual(nettoyerClocheCoupes(null), []);
});

test("le centre de notifications est ouvert à tout compte de l'espace", () => {
  assert.equal(pagePermissionFor('/admin/notifications'), null);
  assert.equal(permissionPageMarchand('/marchand/notifications'), null);
  assert.equal(permissionApiMarchand('/api/notifications/preferences', 'PUT'), null);
});
