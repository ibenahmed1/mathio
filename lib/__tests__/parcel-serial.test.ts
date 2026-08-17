import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PARCEL_SERIAL_SALT_KEY = "unit-test-salt-key-please-change";

import {
  buildQrPayload,
  computeChecksum,
  decodeParcelSerial,
  generateParcelSerial,
  validateQrPayload,
} from "../parcel-serial";

const FIXED_DATE = new Date(2026, 6, 31); // 31/07/2026

test("round-trip: decode(generate(id)) retrouve l'ID d'origine", () => {
  for (const id of [0, 1, 2, 3, 42, 1042, 999_999, 2_176_782_335]) {
    const serial = generateParcelSerial("JAD", id, FIXED_DATE);
    const decoded = decodeParcelSerial(serial);
    assert.equal(decoded.parcelId, id);
    assert.equal(decoded.cityCode, "JAD");
    assert.equal(decoded.date, "310726");
  }
});

test("format respecté : VILLE-CODE(6)-DATE(6)", () => {
  const serial = generateParcelSerial("JAD", 1042, FIXED_DATE);
  assert.match(serial, /^[A-Z]{3}-[0-9A-Z]{6}-\d{6}$/);
  assert.equal(serial, `JAD-${serial.split("-")[1]}-310726`);
});

test("IDs consécutifs (1, 2, 3) produisent des codes masqués totalement différents", () => {
  const codes = [1, 2, 3, 4, 5].map(
    (id) => generateParcelSerial("JAD", id, FIXED_DATE).split("-")[1]
  );

  // aucun préfixe commun entre codes voisins
  for (let i = 0; i < codes.length - 1; i++) {
    assert.notEqual(codes[i][0], codes[i + 1][0]);
  }

  // au moins 4 des 6 caractères diffèrent entre chaque paire consécutive
  for (let i = 0; i < codes.length - 1; i++) {
    const a = codes[i];
    const b = codes[i + 1];
    let diff = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
    assert.ok(diff >= 4, `codes trop similaires: ${a} vs ${b} (diff=${diff})`);
  }

  console.log("IDs 1..5 ->", codes);
});

test("unicité empirique sur une large plage d'IDs séquentiels", () => {
  const seen = new Set<string>();
  for (let id = 0; id < 20_000; id++) {
    const code = generateParcelSerial("JAD", id, FIXED_DATE).split("-")[1];
    assert.ok(!seen.has(code), `collision détectée pour l'ID ${id}: ${code}`);
    seen.add(code);
  }
  assert.equal(seen.size, 20_000);
});

test("QR payload valide passe la validation et restitue l'ID", () => {
  const serial = generateParcelSerial("JAD", 1042, FIXED_DATE);
  const qr = buildQrPayload(serial);
  assert.match(qr, /^[A-Z]{3}-[0-9A-Z]{6}-\d{6}\.[0-9A-Z]{2}$/);

  const result = validateQrPayload(qr);
  assert.equal(result.valid, true);
  assert.equal(result.parcelId, 1042);
  assert.equal(result.cityCode, "JAD");
});

test("falsification détectée : checksum altéré", () => {
  const serial = generateParcelSerial("JAD", 1042, FIXED_DATE);
  const goodChecksum = computeChecksum(serial);
  const badChecksum = goodChecksum === "00" ? "01" : "00";
  const forged = `${serial}.${badChecksum}`;

  const result = validateQrPayload(forged);
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /incorrect/i);
});

test("falsification détectée : numéro de série inventé sans connaître SALT_KEY", () => {
  // Un attaquant qui invente un numéro plausible ne peut pas deviner le
  // checksum HMAC (1/1296 chances) : on vérifie juste qu'un checksum
  // arbitraire non recalculé avec la clé est rejeté.
  const result = validateQrPayload("CAS-ABCDEF-310726.ZZ");
  assert.equal(result.valid, false);
});

test("entrées malformées ne lèvent pas d'exception", () => {
  for (const bad of ["", "not-a-serial", "JAD-XX-310726.AA", "JAD-ABCDEF-310726", null as unknown as string]) {
    assert.doesNotThrow(() => validateQrPayload(bad));
    assert.equal(validateQrPayload(bad).valid, false);
  }
});
