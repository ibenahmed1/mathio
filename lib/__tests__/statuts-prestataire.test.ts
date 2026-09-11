import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StatutCommande } from '../../app/generated/prisma/enums';
import {
  CATALOGUE_STATUTS_PRESTATAIRE,
  LABELS_STATUT_COMMANDE,
  STATUTS_COMMANDE,
  STATUTS_PRESTATAIRE,
  STATUTS_TERMINAUX,
  statutPrestataire,
} from '../statuts';

// ------------------------------------------------------------
// Intégrité du catalogue
// ------------------------------------------------------------

test('toute valeur du catalogue est un statut de colis connu', () => {
  for (const entree of CATALOGUE_STATUTS_PRESTATAIRE) {
    assert.ok(
      STATUTS_COMMANDE.includes(entree.statut),
      `statut hors enum : ${entree.statut}`
    );
  }
});

test('aucun statut n’est déclaré deux fois', () => {
  assert.equal(new Set(STATUTS_PRESTATAIRE).size, STATUTS_PRESTATAIRE.length);
});

test('chaque entrée porte une description non vide', () => {
  for (const entree of CATALOGUE_STATUTS_PRESTATAIRE) {
    assert.ok(entree.description.trim().length > 0, `description vide : ${entree.statut}`);
  }
});

// ------------------------------------------------------------
// La garde qui compte : nos états internes restent hors de portée
// ------------------------------------------------------------

test('aucun statut de NOTRE logistique n’est exposé à un prestataire', () => {
  // Ces états sont produits par nos propres écrans (scan de réception, bon
  // d'envoi, composition de tournée, bon de retour) et par eux seuls. Un
  // transporteur n'a aucun moyen de les observer : les lui ouvrir
  // reviendrait à le laisser réécrire notre circuit depuis l'extérieur.
  const internes: StatutCommande[] = [
    'nouveau_colis',
    'attente_de_ramassage',
    'ramasse',
    'recu',
    'pret_pour_preparation',
    'recu_au_hub',
    'en_transit',
    'expedie',
    'expedier_par_amana',
    'en_voyage',
    'mise_en_distribution',
    'retourne',
    'retourne_au_hub',
    'en_retour_par_amana',
    'annule_par_vendeur',
  ];

  for (const statut of internes) {
    assert.ok(
      !STATUTS_PRESTATAIRE.includes(statut),
      `statut interne exposé à un tiers : ${statut}`
    );
  }
});

test('la relance par SMS reste un statut à nous', () => {
  // `pas_de_reponse_sms` ne décrit pas un constat de terrain mais l'échec
  // d'une relance par un canal que NOUS opérons. L'ouvrir à un sous-traitant
  // ferait affirmer qu'un SMS a été envoyé là où personne n'en a envoyé.
  assert.ok(!STATUTS_PRESTATAIRE.includes('pas_de_reponse_sms'));
});

// ------------------------------------------------------------
// Les champs dérivés ne peuvent pas diverger de leur source
// ------------------------------------------------------------

test('le libellé public est celui du back-office', () => {
  for (const entree of CATALOGUE_STATUTS_PRESTATAIRE) {
    assert.equal(entree.libelle, LABELS_STATUT_COMMANDE[entree.statut]);
  }
});

test('le drapeau terminal suit STATUTS_TERMINAUX', () => {
  for (const entree of CATALOGUE_STATUTS_PRESTATAIRE) {
    assert.equal(entree.terminal, STATUTS_TERMINAUX.includes(entree.statut), entree.statut);
  }
});

test('la date n’est requise que pour un report ou une programmation', () => {
  const avecDate = CATALOGUE_STATUTS_PRESTATAIRE.filter((s) => s.dateRequise).map((s) => s.statut);
  assert.deepEqual(avecDate.sort(), ['programme', 'reporte']);
});

// ------------------------------------------------------------
// Résolution d'une valeur reçue d'un tiers
// ------------------------------------------------------------

test('une valeur du catalogue est résolue avec ses contraintes', () => {
  const reporte = statutPrestataire('reporte');
  assert.ok(reporte);
  assert.equal(reporte.statut, 'reporte');
  assert.equal(reporte.dateRequise, true);
  assert.equal(reporte.terminal, false);
});

test('une valeur inconnue, interne ou mal typée est refusée', () => {
  // 'recu_au_hub' est un vrai statut de l'enum : il doit être refusé ICI non
  // parce qu'il n'existe pas, mais parce qu'il n'appartient pas au catalogue.
  // C'est la distinction que ce test protège.
  for (const valeur of ['DELIVERED', 'recu_au_hub', 'livré', '', null, undefined, 42, {}]) {
    assert.equal(statutPrestataire(valeur), null, `accepté à tort : ${String(valeur)}`);
  }
});

// ------------------------------------------------------------
// Le vocabulaire du marché se projette sur le nôtre
// ------------------------------------------------------------

test('les dix valeurs exposées par les confrères ont toutes un équivalent', () => {
  // Vocabulaire des API livreur des plateformes COD marocaines. Ce test ne
  // sert pas à valider leur API mais la NÔTRE : un intégrateur qui a déjà
  // branché un confrère doit retrouver chacune de ses valeurs chez nous, sans
  // quoi il devra inventer un repli et nous enverra n'importe quoi.
  const equivalences: Record<string, StatutCommande> = {
    DELIVERED: 'livre',
    POSTPONED: 'reporte',
    // Leurs deux définitions les séparent nettement : « personne n'a répondu »
    // porte sur la PERSONNE, « lieu de livraison inaccessible » sur l'ADRESSE.
    NOANSWER: 'injoignable',
    UNREACHABLE: 'hors_zone',
    CANCELLED: 'annule',
    REFUSE: 'refuse',
    DEUXIEME: 'deuxieme_appel_pas_reponse',
    TROIXIEME: 'troisieme_appel_pas_reponse',
    PROGRAMMED: 'programme',
    INTERESTED: 'client_interesse',
  };

  for (const [leur, notre] of Object.entries(equivalences)) {
    assert.ok(STATUTS_PRESTATAIRE.includes(notre), `${leur} sans équivalent exposé (${notre})`);
  }
});
