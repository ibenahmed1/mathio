import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMPTEURS_VIDES,
  assemblerVentilation,
  compteursDepuisStatuts,
  joursEntre,
  nbTermines,
  periodePrecedenteEquivalente,
  resoudrePeriode,
  tauxAnnulation,
  tauxLivraison,
  tauxRetour,
  variation,
  type Compteurs,
} from '../statistiques';

function compteurs(partiel: Partial<Compteurs>): Compteurs {
  return { ...COMPTEURS_VIDES, ...partiel };
}

// ------------------------------------------------------------
// Classement des statuts
// ------------------------------------------------------------

test('les 28 statuts se rangent dans les bonnes cases', () => {
  const c = compteursDepuisStatuts([
    { statut: 'livre', nb: 80 },
    { statut: 'retourne', nb: 15 },
    { statut: 'annule', nb: 3 },
    { statut: 'annule_par_vendeur', nb: 2 },
    { statut: 'mise_en_distribution', nb: 7 },
    { statut: 'injoignable', nb: 4 },
  ]);

  assert.equal(c.total, 111);
  assert.equal(c.livres, 80);
  assert.equal(c.retournes, 15);
  // Les deux formes d'annulation se cumulent : côté pilotage, un colis annulé
  // est un colis annulé, peu importe qui a décidé.
  assert.equal(c.annules, 5);
  assert.equal(c.enCours, 11);
});

// `retourne_au_hub` est l'état PHYSIQUE d'un colis rentré au dépôt après une
// tentative infructueuse — il repartira. Le compter comme un retour définitif
// gonflerait le taux d'échec d'une population qui n'a pas fini son parcours.
test('retourne_au_hub compte comme « en cours », pas comme un retour', () => {
  const c = compteursDepuisStatuts([{ statut: 'retourne_au_hub', nb: 6 }]);

  assert.equal(c.retournes, 0);
  assert.equal(c.enCours, 6);
});

// ------------------------------------------------------------
// Taux
// ------------------------------------------------------------

test('le taux de livraison se calcule sur les colis TERMINÉS, pas sur le total', () => {
  // 80 livrés, 20 retournés, 50 encore en tournée : le taux est de 80 %, pas
  // de 53 %. Rapporter au total punirait la plateforme pour des colis qui
  // n'ont simplement pas encore été présentés.
  const c = compteurs({ total: 150, livres: 80, retournes: 20, enCours: 50 });

  assert.equal(nbTermines(c), 100);
  assert.equal(tauxLivraison(c), 80);
  assert.equal(tauxRetour(c), 20);
});

// Une annulation n'est pas un échec de livraison : le colis n'a jamais été
// présenté à un client. Elle a donc son propre taux, rapporté au total.
test('les annulations sortent du taux de livraison et ont leur propre taux', () => {
  const c = compteurs({ total: 100, livres: 45, retournes: 5, annules: 50 });

  assert.equal(tauxLivraison(c), 90);
  assert.equal(tauxAnnulation(c), 50);
});

// « 0 % » et « on ne sait pas encore » ne se disent pas de la même façon à
// l'écran : le premier est un constat, le second une absence de données.
test('aucun colis terminé : taux null, jamais zéro', () => {
  const c = compteurs({ total: 30, enCours: 30 });

  assert.equal(tauxLivraison(c), null);
  assert.equal(tauxRetour(c), null);
  assert.equal(tauxAnnulation(c), 0);
});

test('taux arrondis à une décimale', () => {
  assert.equal(tauxLivraison(compteurs({ total: 3, livres: 2, retournes: 1 })), 66.7);
});

// ------------------------------------------------------------
// Variation
// ------------------------------------------------------------

test('variation : hausse, baisse et stabilité', () => {
  assert.equal(variation(120, 100), 20);
  assert.equal(variation(80, 100), -20);
  assert.equal(variation(100, 100), 0);
});

// Diviser par zéro donnerait Infinity, qui s'afficherait « +∞ % » — ce qui est
// faux : passer de 0 à 5 colis n'est pas une progression infinie, c'est un
// démarrage, et ça se dit autrement.
test('variation depuis zéro : null, jamais Infinity', () => {
  assert.equal(variation(5, 0), null);
  assert.equal(variation(0, 0), 0);
});

// ------------------------------------------------------------
// Périodes
// ------------------------------------------------------------

test('un preset inconnu retombe sur 30 jours plutôt que de planter', () => {
  for (const brut of [undefined, null, '', 'nawak', '../etc/passwd']) {
    assert.equal(resoudrePeriode(brut).preset, '30j');
  }
});

test('les périodes glissantes couvrent bien le nombre de jours annoncé', () => {
  for (const [preset, jours] of [
    ['7j', 7],
    ['30j', 30],
    ['90j', 90],
  ] as const) {
    const p = resoudrePeriode(preset);
    assert.equal(p.nbJours, jours);
    assert.notEqual(p.debut, null);
    assert.equal(joursEntre(p.debut!, p.fin), jours);
  }
});

test('« depuis le début » n’a ni borne de début ni durée', () => {
  const p = resoudrePeriode('tout');

  assert.equal(p.debut, null);
  assert.equal(p.nbJours, null);
});

// La période de comparaison doit être JOINTIVE et de même durée : sans ça, la
// variation compare deux populations de tailles différentes et raconte
// n'importe quoi.
test('la période précédente est jointive et de même durée', () => {
  const p = resoudrePeriode('30j');
  const prec = periodePrecedenteEquivalente(p);

  assert.notEqual(prec, null);
  assert.equal(prec!.nbJours, p.nbJours);
  // Elle finit une milliseconde avant que l'actuelle ne commence : ni trou,
  // ni chevauchement (un colis compté deux fois).
  assert.equal(p.debut!.getTime() - prec!.fin.getTime(), 1);
});

test('« depuis le début » n’a pas de période précédente', () => {
  assert.equal(periodePrecedenteEquivalente(resoudrePeriode('tout')), null);
});

// ------------------------------------------------------------
// Ventilation
// ------------------------------------------------------------

test('assemblerVentilation regroupe les statuts d’une même clé', () => {
  const lignes = assemblerVentilation([
    { cle: 'l1', libelle: 'Karim', statut: 'livre', nb: 40, cod: 12000 },
    { cle: 'l1', libelle: 'Karim', statut: 'retourne', nb: 10, cod: 3000 },
    { cle: 'l2', libelle: 'Salma', statut: 'livre', nb: 90, cod: 27000 },
  ]);

  assert.equal(lignes.length, 2);
  // Tri sur le VOLUME : Salma (90) passe devant Karim (50).
  assert.equal(lignes[0].libelle, 'Salma');
  assert.equal(lignes[1].compteurs.total, 50);
  assert.equal(tauxLivraison(lignes[1].compteurs), 80);
});

// Le COD d'un colis retourné n'a jamais été encaissé : l'inclure gonflerait le
// chiffre d'affaires d'un argent qui n'est pas entré en caisse. Même règle
// qu'en facturation.
test('seul le COD des colis LIVRÉS est encaissé', () => {
  const [ligne] = assemblerVentilation([
    { cle: 'l1', libelle: 'Karim', statut: 'livre', nb: 40, cod: 12000 },
    { cle: 'l1', libelle: 'Karim', statut: 'retourne', nb: 10, cod: 3000 },
  ]);

  assert.equal(ligne.codEncaisse, 12000);
});

test('ventilation vide : liste vide, pas d’exception', () => {
  assert.deepEqual(assemblerVentilation([]), []);
});
