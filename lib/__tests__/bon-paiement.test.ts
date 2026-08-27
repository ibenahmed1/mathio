import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError } from '../api-utils';
import {
  effetAjustement,
  periodeDepuisParams,
  periodeMensuelle,
  periodePrecedente,
  totaliserTournees,
  type TourneeARegler,
} from '../bon-paiement';

// `totaliserTournees` ne lit que trois champs (nbColisLivres, nbColisRetournes,
// gainLivreur) du payload Prisma complet — même parti pris de fixture minimale
// que dans facturation.test.ts.
function tournee(
  gainLivreur: number | string | null,
  nbColisLivres: number | null = 0,
  nbColisRetournes: number | null = 0
): TourneeARegler {
  return { gainLivreur, nbColisLivres, nbColisRetournes } as unknown as TourneeARegler;
}

// ------------------------------------------------------------
// Ajustements — le signe vient du TYPE, jamais du montant
// ------------------------------------------------------------

test('une pénalité est toujours soustraite, une prime toujours ajoutée', () => {
  assert.equal(effetAjustement('penalite', 100), -100);
  assert.equal(effetAjustement('prime', 100), 100);
});

// Le modèle AjustementBonPaiement stocke un montant TOUJOURS positif : le
// signe est porté par le type. Si un montant négatif traverse malgré tout la
// validation, une pénalité de -100 ne doit pas se transformer en prime de
// +100 par double négation — ce serait payer le livreur pour une sanction.
test('un montant négatif ne renverse jamais l’effet du type', () => {
  assert.equal(effetAjustement('penalite', -100), -100);
  assert.equal(effetAjustement('prime', -100), 100);
});

test('un montant en chaîne (Decimal Prisma) est accepté', () => {
  assert.equal(effetAjustement('penalite', '49.50'), -49.5);
  assert.equal(effetAjustement('prime', '49.50'), 49.5);
});

// ------------------------------------------------------------
// Totalisation des tournées
// ------------------------------------------------------------

test('totaliserTournees additionne gains et colis sur l’ensemble des tournées', () => {
  const t = totaliserTournees([
    tournee(150.5, 12, 3),
    tournee(200.25, 18, 1),
    tournee(49.25, 5, 0),
  ]);

  assert.equal(t.nbTournees, 3);
  assert.equal(t.nbColisLivres, 35);
  assert.equal(t.nbColisRetournes, 4);
  assert.equal(t.montantTotal, 400);
});

// Une tournée clôturée sans gain calculé ne doit ni faire planter le total ni
// y injecter NaN — un NaN se propagerait jusqu'au montant du bon de paiement.
test('gain ou compteurs à null comptent pour zéro, jamais NaN', () => {
  const t = totaliserTournees([tournee(null, null, null), tournee(100, 4, 1)]);

  assert.equal(t.montantTotal, 100);
  assert.equal(t.nbColisLivres, 4);
  assert.equal(t.nbColisRetournes, 1);
  assert.equal(t.nbTournees, 2);
  assert.ok(!Number.isNaN(t.montantTotal));
});

test('liste vide : totaux à zéro', () => {
  assert.deepEqual(totaliserTournees([]), {
    nbTournees: 0,
    nbColisLivres: 0,
    nbColisRetournes: 0,
    montantTotal: 0,
  });
});

test('aucune dérive de centime sur un grand nombre de tournées', () => {
  const tournees = Array.from({ length: 500 }, () => tournee(33.33, 1, 0));
  const t = totaliserTournees(tournees);

  assert.equal(t.montantTotal, Number((33.33 * 500).toFixed(2)));
});

// ------------------------------------------------------------
// Bornes de période de paie
// ------------------------------------------------------------

test('periodeMensuelle encadre le mois entier, dernière milliseconde incluse', () => {
  const { debut, fin } = periodeMensuelle(2026, 8);

  assert.equal(debut.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(fin.toISOString(), '2026-08-31T23:59:59.999Z');
});

test('periodeMensuelle gère décembre sans déborder sur l’année suivante', () => {
  const { debut, fin } = periodeMensuelle(2026, 12);

  assert.equal(debut.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(fin.toISOString(), '2026-12-31T23:59:59.999Z');
});

test('periodeMensuelle gère février bissextile', () => {
  assert.equal(periodeMensuelle(2028, 2).fin.toISOString(), '2028-02-29T23:59:59.999Z');
  assert.equal(periodeMensuelle(2026, 2).fin.toISOString(), '2026-02-28T23:59:59.999Z');
});

// Deux périodes consécutives ne doivent ni se chevaucher (une tournée payée
// deux fois) ni laisser de trou (une tournée jamais payée).
test('deux mois consécutifs sont jointifs et disjoints', () => {
  const aout = periodeMensuelle(2026, 8);
  const septembre = periodeMensuelle(2026, 9);

  assert.equal(septembre.debut.getTime() - aout.fin.getTime(), 1);
});

test('periodeMensuelle rejette un mois ou une année hors bornes', () => {
  const invalides: [number, number][] = [
    [2026, 0],
    [2026, 13],
    [2026, 1.5],
    [2019, 6],
    [2101, 6],
    [Number.NaN, 6],
  ];

  for (const [annee, mois] of invalides) {
    assert.throws(
      () => periodeMensuelle(annee, mois),
      (err: unknown) => err instanceof ApiError && err.status === 400,
      `${annee}-${mois} aurait dû être rejeté`
    );
  }
});

// ------------------------------------------------------------
// Paramètres de requête
// ------------------------------------------------------------

test('periodeDepuisParams : sans annee ni mois, aucune période (pas d’erreur)', () => {
  assert.equal(periodeDepuisParams(new URLSearchParams()), null);
});

// Filtrer sur un mois sans année ramènerait silencieusement les mois
// homonymes des années précédentes : mieux vaut refuser que répondre faux.
test('periodeDepuisParams : annee et mois vont toujours ensemble', () => {
  assert.throws(
    () => periodeDepuisParams(new URLSearchParams('mois=8')),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
  assert.throws(
    () => periodeDepuisParams(new URLSearchParams('annee=2026')),
    (err: unknown) => err instanceof ApiError && err.status === 400
  );
});

test('periodeDepuisParams : couple valide produit les mêmes bornes que periodeMensuelle', () => {
  const depuisParams = periodeDepuisParams(new URLSearchParams('annee=2026&mois=8'));

  assert.deepEqual(depuisParams, periodeMensuelle(2026, 8));
});

// ------------------------------------------------------------
// Mois de paie par défaut
// ------------------------------------------------------------

test('periodePrecedente renvoie le mois écoulé, pas le mois courant', () => {
  assert.deepEqual(periodePrecedente(new Date(2026, 7, 15)), { annee: 2026, mois: 7 });
});

// Le 1er janvier, l'écran de paie doit s'ouvrir sur décembre de l'année
// PRÉCÉDENTE — le passage d'année est le seul cas où ce calcul peut se
// tromper d'un an entier.
test('periodePrecedente franchit correctement le 1er janvier', () => {
  assert.deepEqual(periodePrecedente(new Date(2026, 0, 1)), { annee: 2025, mois: 12 });
});

// Le 31 mars, le mois précédent est février — un calcul naïf qui retirerait
// 30 jours ou fixerait le jour à 31 retomberait sur mars.
test('periodePrecedente depuis un 31 ne saute pas le mois court', () => {
  assert.deepEqual(periodePrecedente(new Date(2026, 2, 31)), { annee: 2026, mois: 2 });
});

// Bornes UTC vs heure marocaine (UTC+1). Ce test fige le comportement RÉEL
// décrit par le commentaire de periodeMensuelle — il existe parce que ce
// commentaire décrivait l'écart dans le mauvais sens, et qu'un commentaire ne
// se vérifie pas tout seul.
test('heure marocaine : la première heure du mois retombe dans la paie du mois précédent', () => {
  const aout = periodeMensuelle(2026, 8);
  const dansPeriode = (instantUtc: string) => {
    const t = new Date(instantUtc).getTime();
    return t >= aout.debut.getTime() && t <= aout.fin.getTime();
  };

  // 31/08 à 23h30 heure marocaine = 22h30 UTC → reste en août. Pas de bascule.
  assert.equal(dansPeriode('2026-08-31T22:30:00.000Z'), true);

  // 01/09 à 00h30 heure marocaine = 31/08 23h30 UTC → tombe ENCORE en août,
  // alors que c'est déjà septembre sur place. C'est l'arrondi d'une heure
  // assumé par le choix de bornes UTC.
  assert.equal(dansPeriode('2026-08-31T23:30:00.000Z'), true);

  // 01/09 à 01h30 heure marocaine = 00h30 UTC → bien en septembre.
  assert.equal(dansPeriode('2026-09-01T00:30:00.000Z'), false);
});
