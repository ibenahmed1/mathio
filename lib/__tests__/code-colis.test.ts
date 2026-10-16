import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeEtiquette, normaliserCodeColis } from '@/lib/code-colis';
import { lireDouchette } from '@/lib/douchette';
import { buildParcelLabel } from '@/lib/parcel-label';
import { buildQrPayload, generateParcelSerial } from '@/lib/parcel-serial';
import { codeSuiviDepuisScan } from '@/lib/scan-colis';

test('le QR de l\'étiquette porte le code connu des transporteurs', async () => {
  const label = await buildParcelLabel({ codeSuivi: 'PD-000123' });
  assert.equal(label.qrPayload, 'MTH-PD-000123');
  assert.equal(codeEtiquette('PD-000123'), 'MTH-PD-000123');
});

test('la normalisation retire MTH- devant PD- seulement', () => {
  assert.equal(normaliserCodeColis(' mth-pd-000123 '), 'PD-000123');
  assert.equal(normaliserCodeColis('PD-000123'), 'PD-000123');
  assert.equal(normaliserCodeColis('MTH-ABC'), 'MTH-ABC');
});

test('nos scans lisent le nouveau QR, le code saisi et l\'ancien QR signé', () => {
  // Nouveau QR : sans point, les écrans l'envoient comme codeSuivi.
  assert.equal(codeSuiviDepuisScan('', 'MTH-PD-000123'), 'PD-000123');
  assert.equal(codeSuiviDepuisScan('MTH-PD-000123', ''), 'PD-000123');
  assert.equal(codeSuiviDepuisScan('', 'pd-000123'), 'PD-000123');

  const ancien = buildQrPayload(generateParcelSerial('AGA', 123, new Date(2026, 8, 7)));
  assert.equal(codeSuiviDepuisScan(ancien, ''), 'PD-000123');
});

test('un ancien QR à la signature fausse reste refusé', () => {
  const ancien = buildQrPayload(generateParcelSerial('AGA', 123, new Date(2026, 8, 7)));
  const falsifie = ancien.slice(0, -2) + (ancien.endsWith('ZZ') ? 'YY' : 'ZZ');
  assert.throws(() => codeSuiviDepuisScan(falsifie, ''), /Checksum incorrect/);
});

test('un scan vide est refusé', () => {
  assert.throws(() => codeSuiviDepuisScan('', '  '), /requis/);
});

// Douchette sur Mac en AZERTY : « § » à la place de chaque tiret (16/10).
test('les « § » d\'une douchette sur Mac redeviennent des tirets', () => {
  assert.equal(codeSuiviDepuisScan('', 'MTH§PD§000123'), 'PD-000123');

  const ancien = buildQrPayload(generateParcelSerial('AGA', 123, new Date(2026, 8, 7)));
  assert.equal(codeSuiviDepuisScan(ancien.replace(/-/g, '§'), ''), 'PD-000123');

  const lecture = lireDouchette(ancien.replace(/-/g, '§'));
  assert.deepEqual(lecture, { etat: 'complet', code: ancien, qr: true });
});
