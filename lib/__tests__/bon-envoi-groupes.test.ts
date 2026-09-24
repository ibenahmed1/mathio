import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GROUPE_AUCUN, GROUPE_PLUSIEURS, regrouperParTransporteur } from '../bon-envoi-groupes';

const POWER = { id: 'p-power', nom: 'Power Delivery' };
const META = { id: 'p-meta', nom: 'Meta Livraison' };
const EST = { id: 'p-est', nom: 'EST Livraison' };

const colis = (ref: string, transporteursVille: { id: string; nom: string }[]) => ({ ref, transporteursVille });

test('un colis rejoint le groupe du transporteur qui dessert sa ville', () => {
  const groupes = regrouperParTransporteur([colis('a', [POWER]), colis('b', [META])], null);
  assert.deepEqual(
    groupes.map((g) => [g.cle, g.colis.map((c) => c.ref)]),
    [
      ['p-meta', ['b']],
      ['p-power', ['a']],
    ]
  );
});

// L'écran sert d'abord à composer le bon du transporteur choisi : sa liste
// passe devant, quel que soit l'ordre alphabétique.
test('le transporteur en cours de composition passe en tête', () => {
  const groupes = regrouperParTransporteur([colis('a', [META]), colis('b', [POWER])], POWER.id);
  assert.deepEqual(groupes.map((g) => g.cle), ['p-power', 'p-meta']);
});

test('les autres réseaux suivent par ordre alphabétique', () => {
  const groupes = regrouperParTransporteur([colis('a', [POWER]), colis('b', [META]), colis('c', [EST])], null);
  assert.deepEqual(groupes.map((g) => g.libelle), ['EST Livraison', 'Meta Livraison', 'Power Delivery']);
});

// Une ville sans transporteur est exactement ce qu'il faut voir AVANT de
// confier un colis : son groupe existe, il est dernier, et rien n'est masqué.
test('les villes non desservies forment le dernier groupe, et rien n’est perdu', () => {
  const entree = [colis('a', [POWER]), colis('b', []), colis('c', [POWER, META])];
  const groupes = regrouperParTransporteur(entree, null);
  assert.equal(groupes.at(-1)?.cle, GROUPE_AUCUN);
  assert.equal(groupes.flatMap((g) => g.colis).length, entree.length);
});

test('une ville partagée ne va dans le groupe d’aucun des deux réseaux', () => {
  const groupes = regrouperParTransporteur([colis('a', [POWER, META])], POWER.id);
  assert.equal(groupes.length, 1);
  assert.ok(groupes[0].cle.startsWith(GROUPE_PLUSIEURS));
  assert.match(groupes[0].libelle, /Power Delivery, Meta Livraison/);
});

// Deux combinaisons différentes ne doivent pas se fondre : le libellé du
// premier colis rencontré s'appliquerait alors à des villes d'autres réseaux.
test('deux combinaisons de réseaux donnent deux groupes', () => {
  const groupes = regrouperParTransporteur([colis('a', [POWER, META]), colis('b', [EST, META])], null);
  const partages = groupes.filter((g) => g.cle.startsWith(GROUPE_PLUSIEURS));
  assert.equal(partages.length, 2);
});

// L'ordre des réseaux dépend du référentiel, pas du sens de la question : la
// même ville ne doit pas produire deux groupes selon l'ordre de lecture.
test('l’ordre des réseaux d’une ville partagée ne crée pas de doublon', () => {
  const groupes = regrouperParTransporteur([colis('a', [POWER, META]), colis('b', [META, POWER])], null);
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].colis.length, 2);
});

test('une liste vide ne produit aucun groupe', () => {
  assert.deepEqual(regrouperParTransporteur([], null), []);
});
