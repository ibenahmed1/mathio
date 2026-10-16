import assert from 'node:assert/strict';
import { test } from 'node:test';

import { etatTransmissionApi, partiParApi, type RemiseColis } from '../remise-affichage';

// § Fiche d'un bon d'envoi (16/10/2026) : ce qui est parti par API, ce qui
// reste à transmettre par l'Excel.

const r = (etat: string, active: boolean, extra: Partial<RemiseColis> = {}): RemiseColis => ({
  etat,
  active,
  codeEnvoye: 'MTH-PD-1',
  codeExterne: null,
  erreur: null,
  ...extra,
});

test('accepté par l’API : parti, code du transporteur affiché', () => {
  assert.equal(partiParApi([r('acceptee', true)]), true);
  const e = etatTransmissionApi([r('acceptee', true, { codeExterne: 'PW-9' })]);
  assert.equal(e.cle, 'api');
  assert.equal(e.detail, 'PW-9');
});

test('à confirmer : compté comme parti (jamais renvoyé par Excel)', () => {
  assert.equal(partiParApi([r('a_confirmer', true)]), true);
  assert.equal(etatTransmissionApi([r('a_confirmer', true)]).cle, 'a_confirmer');
});

test('refusé par l’API : à transmettre par Excel, avec la raison', () => {
  assert.equal(partiParApi([r('refusee', false, { erreur: 'Ville invalide' })]), false);
  const e = etatTransmissionApi([r('refusee', false, { erreur: 'Ville invalide' })]);
  assert.equal(e.cle, 'refuse');
  assert.match(e.detail, /Ville invalide/);
});

test('aucune remise : à transmettre par Excel', () => {
  assert.equal(partiParApi([]), false);
  assert.equal(partiParApi(undefined), false);
  assert.equal(etatTransmissionApi(undefined).cle, 'excel');
});

test('remise retirée puis acceptée de nouveau : la remise active fait foi', () => {
  assert.equal(partiParApi([r('acceptee', true), r('retiree', false)]), true);
  assert.equal(etatTransmissionApi([r('refusee', false), r('acceptee', true)]).cle, 'api');
});
