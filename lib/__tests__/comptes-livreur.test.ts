import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError } from '../api-utils';
import {
  analyserIdentiteLivreur,
  cinRequise,
  deciderActionColisLivreur,
  hubRequis,
  estTypeCompteLivreur,
} from '../comptes-livreur';

// § Comptes livreurs (individu / société). Ce qui est testé ici est la seule
// chose que le module décide : quels champs d'identité finissent en base, à
// partir du rôle, du corps de la requête et de ce qui y est déjà.

test('un compte livreur sans type annoncé est un individu', () => {
  const identite = analyserIdentiteLivreur('livreur', {});
  assert.equal(identite.typeLivreur, 'individuel');
  assert.equal(identite.raisonSociale, null);
  assert.equal(identite.ice, null);
});

test('une société garde sa raison sociale et son ICE', () => {
  const identite = analyserIdentiteLivreur('livreur', {
    typeLivreur: 'societe',
    raisonSociale: '  Trans Atlas SARL  ',
    ice: '001234567000089',
  });
  assert.equal(identite.typeLivreur, 'societe');
  assert.equal(identite.raisonSociale, 'Trans Atlas SARL');
  assert.equal(identite.ice, '001234567000089');
});

test('raison sociale et ICE restent facultatifs sur une société', () => {
  const identite = analyserIdentiteLivreur('livreur', { typeLivreur: 'societe' });
  assert.equal(identite.typeLivreur, 'societe');
  assert.equal(identite.raisonSociale, null);
  assert.equal(identite.ice, null);
});

test('un individu ne conserve aucune identité d’entreprise', () => {
  // Le cas qui compte : une société repassée en individu. Les champs sont
  // effacés, que le corps les mentionne ou non.
  const identite = analyserIdentiteLivreur(
    'livreur',
    { typeLivreur: 'individuel' },
    { typeLivreur: 'societe', raisonSociale: 'Trans Atlas SARL', ice: '001234567000089' }
  );
  assert.equal(identite.typeLivreur, 'individuel');
  assert.equal(identite.raisonSociale, null);
  assert.equal(identite.ice, null);
});

test('un corps muet ne dégrade pas une société existante', () => {
  // Modification partielle : la fenêtre n'envoie que le téléphone. Ni le type
  // ni les papiers ne doivent bouger.
  const identite = analyserIdentiteLivreur(
    'livreur',
    { telephone: '0600000000' },
    { typeLivreur: 'societe', raisonSociale: 'Trans Atlas SARL', ice: '001234567000089' }
  );
  assert.equal(identite.typeLivreur, 'societe');
  assert.equal(identite.raisonSociale, 'Trans Atlas SARL');
  assert.equal(identite.ice, '001234567000089');
});

test('un champ vidé explicitement est bien effacé', () => {
  const identite = analyserIdentiteLivreur(
    'livreur',
    { raisonSociale: '   ' },
    { typeLivreur: 'societe', raisonSociale: 'Trans Atlas SARL', ice: '001234567000089' }
  );
  assert.equal(identite.raisonSociale, null);
  assert.equal(identite.ice, '001234567000089');
});

test('un compte qui n’est plus livreur perd toute identité de livreur', () => {
  const identite = analyserIdentiteLivreur(
    'superviseur',
    { typeLivreur: 'societe', raisonSociale: 'Trans Atlas SARL' },
    { typeLivreur: 'societe', raisonSociale: 'Trans Atlas SARL', ice: '001234567000089' }
  );
  assert.deepEqual(identite, { typeLivreur: null, raisonSociale: null, ice: null });
});

test('un type hors catalogue est refusé', () => {
  assert.throws(
    () => analyserIdentiteLivreur('livreur', { typeLivreur: 'entreprise' }),
    (erreur: unknown) => erreur instanceof ApiError && erreur.status === 400
  );
  assert.equal(estTypeCompteLivreur('societe'), true);
  assert.equal(estTypeCompteLivreur('entreprise'), false);
});

test('la CIN n’est exigée que des personnes', () => {
  assert.equal(cinRequise('livreur', 'individuel'), true);
  assert.equal(cinRequise('livreur', 'societe'), false);
  assert.equal(cinRequise('ramasseur', null), true);
  assert.equal(cinRequise('superviseur', null), false);
});

test('le hub n’est pas exigé d’une société de livraison', () => {
  // Elle n'a pas de quai chez nous : on lui confie des colis par bon d'envoi,
  // elle ne revient pas au dépôt. Les postes qui travaillent SUR un quai,
  // eux, gardent l'obligation.
  assert.equal(hubRequis('livreur', 'societe'), false);
  assert.equal(hubRequis('livreur', 'individuel'), true);
  assert.equal(hubRequis('agent_hub', null), true);
  assert.equal(hubRequis('planner', null), true);
  assert.equal(hubRequis('ramasseur', null), false);
  assert.equal(hubRequis('superviseur', null), false);
});

// § /livreur/colis — la garde des trois actions terrain. Deux régimes, et le
// second doit répondre comme l'API des prestataires, jamais autrement.

const MOI = 'compte-societe';

test('un colis qui ne m’est pas affecté est refusé', () => {
  const decision = deciderActionColisLivreur(
    { livreurId: 'quelqu-un-dautre', statut: 'mise_en_distribution', origine: 'tournee', tourneeNumero: 'BD-1' },
    MOI,
    'livre'
  );
  assert.equal(decision.issue, 'refuse');
  assert.equal(decision.issue === 'refuse' && decision.status, 403);
});

test('en tournée, la règle d’avant ne bouge pas', () => {
  const enDistribution = deciderActionColisLivreur(
    { livreurId: MOI, statut: 'mise_en_distribution', origine: 'tournee', tourneeNumero: 'BD-1' },
    MOI,
    'livre'
  );
  assert.equal(enDistribution.issue, 'autorise');

  const pasEnDistribution = deciderActionColisLivreur(
    { livreurId: MOI, statut: 'recu_au_hub', origine: 'tournee', tourneeNumero: 'BD-1' },
    MOI,
    'livre'
  );
  assert.equal(pasEnDistribution.issue, 'refuse');
  assert.equal(pasEnDistribution.issue === 'refuse' && pasEnDistribution.status, 400);
});

test('une tournée clôturée ferme le colis, en nommant la tournée', () => {
  const decision = deciderActionColisLivreur(
    { livreurId: MOI, statut: 'mise_en_distribution', origine: 'aucune', tourneeNumero: 'BD-2026-0912-003' },
    MOI,
    'livre'
  );
  assert.equal(decision.issue, 'refuse');
  assert.equal(decision.issue === 'refuse' && decision.status, 409);
  assert.ok(decision.issue === 'refuse' && decision.message.includes('BD-2026-0912-003'));
});

test('un colis confié se déclare depuis en_transit', () => {
  // Le cas central du module : le bon d'envoi ne change pas le statut du
  // colis, il reste en_transit — et c'est bien depuis là que la société
  // déclare, sans qu'aucun écran n'ait eu à le « mettre en distribution ».
  const decision = deciderActionColisLivreur(
    { livreurId: MOI, statut: 'en_transit', origine: 'confie', tourneeNumero: null },
    MOI,
    'livre'
  );
  assert.equal(decision.issue, 'autorise');
});

test('un colis confié se redéclare après un report', () => {
  const decision = deciderActionColisLivreur(
    { livreurId: MOI, statut: 'reporte', origine: 'confie', tourneeNumero: null },
    MOI,
    'livre'
  );
  assert.equal(decision.issue, 'autorise');
});

test('un colis confié déjà clos est refusé, comme par l’API', () => {
  const decision = deciderActionColisLivreur(
    { livreurId: MOI, statut: 'livre', origine: 'confie', tourneeNumero: null },
    MOI,
    'annule'
  );
  assert.equal(decision.issue, 'refuse');
  assert.equal(decision.issue === 'refuse' && decision.status, 409);
});

test('rejouer la même déclaration est sans effet, pas une erreur', () => {
  const decision = deciderActionColisLivreur(
    { livreurId: MOI, statut: 'reporte', origine: 'confie', tourneeNumero: null },
    MOI,
    'reporte'
  );
  assert.equal(decision.issue, 'inchange');
});
