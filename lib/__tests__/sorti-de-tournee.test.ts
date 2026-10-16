import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sortiDeTournee } from '../livreur';

// § Espace transporteur (16/10/2026) : un colis revenu d'une tournée clôturée,
// puis confié à un transporteur par un bon d'envoi plus récent, est à lui.

const avant = new Date('2026-08-18T10:00:00Z');
const apres = new Date('2026-10-16T11:51:00Z');

test('sans tournée, le colis est hors tournée', () => {
  assert.equal(sortiDeTournee({ bonDistributionId: null, bonDistribution: null, bonEnvoi: { dateGeneration: apres } }), true);
});

test('tournée clôturée AVANT le bon : le colis est au transporteur', () => {
  assert.equal(
    sortiDeTournee({ bonDistributionId: 'bd', bonDistribution: { statut: 'cloture', dateGeneration: avant }, bonEnvoi: { dateGeneration: apres } }),
    true
  );
});

test('tournée clôturée APRÈS le bon : le colis a quitté le transporteur', () => {
  assert.equal(
    sortiDeTournee({ bonDistributionId: 'bd', bonDistribution: { statut: 'cloture', dateGeneration: apres }, bonEnvoi: { dateGeneration: avant } }),
    false
  );
});

test('tournée encore ouverte : le colis est chez le livreur', () => {
  assert.equal(
    sortiDeTournee({ bonDistributionId: 'bd', bonDistribution: { statut: 'en_cours', dateGeneration: avant }, bonEnvoi: { dateGeneration: apres } }),
    false
  );
});

test('dates sérialisées (chaînes) acceptées', () => {
  assert.equal(
    sortiDeTournee({
      bonDistributionId: 'bd',
      bonDistribution: { statut: 'cloture', dateGeneration: avant.toISOString() as unknown as Date },
      bonEnvoi: { dateGeneration: apres.toISOString() as unknown as Date },
    }),
    true
  );
});
