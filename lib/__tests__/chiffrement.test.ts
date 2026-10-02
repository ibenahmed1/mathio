import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { ErreurChiffrement, chiffrer, dechiffrer, lireCle } from '../chiffrement';

const CLE = randomBytes(32);

test('aller-retour, et deux chiffrements du même texte diffèrent', () => {
  const secret = 'shpat_0123456789abcdef';
  const a = chiffrer(secret, CLE);
  const b = chiffrer(secret, CLE);
  assert.notEqual(a, b); // IV aléatoire : aucune égalité visible en base
  assert.ok(!a.includes(secret));
  assert.equal(dechiffrer(a, CLE), secret);
  assert.equal(dechiffrer(b, CLE), secret);
  assert.equal(dechiffrer(chiffrer('', CLE), CLE), '');
});

// GCM authentifie : une valeur altérée ou lue avec une autre clé échoue au lieu
// de rendre un jeton faux.
test('mauvaise clé ou valeur altérée : refus', () => {
  const chiffre = chiffrer('secret', CLE);
  assert.throws(() => dechiffrer(chiffre, randomBytes(32)), ErreurChiffrement);

  const [v, iv, tag, donnees] = chiffre.split('.');
  const altere = [v, iv, tag, `${donnees.slice(0, -2)}AA`].join('.');
  assert.throws(() => dechiffrer(altere, CLE), ErreurChiffrement);
  assert.throws(() => dechiffrer('v0.a.b.c', CLE), ErreurChiffrement);
  assert.throws(() => dechiffrer('illisible', CLE), ErreurChiffrement);
});

test('clé d’environnement : base64 ou hexadécimal, 32 octets exactement', () => {
  assert.equal(lireCle(CLE.toString('base64')).length, 32);
  assert.equal(lireCle(CLE.toString('hex')).length, 32);
  assert.throws(() => lireCle(undefined), ErreurChiffrement);
  assert.throws(() => lireCle('   '), ErreurChiffrement);
  assert.throws(() => lireCle(randomBytes(16).toString('base64')), ErreurChiffrement);
});
