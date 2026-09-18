import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geoContains, geoDistance } from 'd3';
import type { Feature, MultiPolygon } from 'geojson';

import carte from '../../components/admin/carte-maroc.json';
import { REFERENTIEL_COORDONNEES_VILLES, coordonneesVille } from '../coordonnees-villes';
import { normaliserVille } from '../hub-stock';

const maroc = carte as unknown as Feature<MultiPolygon>;
const RAYON_TERRE_KM = 6371;

// Les dix-sept villes d'implantation des agences chargées par `npm run db:reseau`
// (§ SOUS_TRAITANCE.md), sous la graphie exacte de la base.
const VILLES_AGENCES = [
  'Agadir',
  'Azrou',
  'Boulmane',
  'El Jadida',
  'Fès',
  'Guelmim',
  'Khemisset',
  'Marrakech',
  'Meknès',
  'Missour',
  'Oujda',
  'Rabat',
  'Safi',
  'Sefrou',
  'Tanger',
  'Taounate',
  'Taza',
];

test('chaque ville d’agence du référentiel réseau a ses coordonnées', () => {
  assert.deepEqual(
    VILLES_AGENCES.filter((ville) => !coordonneesVille(ville)),
    []
  );
});

// Attrape une coquille ou une latitude inversée avec la longitude : le point
// tomberait en mer ou hors du pays. La silhouette est au 50m, dont la côte est
// simplifiée : une ville littorale (Safi, Agadir, Tanger) peut tomber juste au
// large du tracé. D'où la tolérance de 25 km au sommet le plus proche — bien en
// deçà de l'erreur qu'une coquille produirait (un degré, c'est 111 km).
test('chaque point tombe sur le territoire dessiné', () => {
  const sommets = maroc.geometry.coordinates.flat(2) as [number, number][];
  for (const { ville, longitude, latitude } of REFERENTIEL_COORDONNEES_VILLES) {
    const point: [number, number] = [longitude, latitude];
    const dedans = geoContains(maroc, point);
    const auPlusPres = Math.min(...sommets.map((s) => geoDistance(point, s))) * RAYON_TERRE_KM;
    assert.ok(dedans || auPlusPres <= 25, `${ville} hors du territoire (${auPlusPres.toFixed(0)} km du tracé)`);
  }
});

test('la recherche ignore accents, casse et espaces autour', () => {
  assert.deepEqual(coordonneesVille('Fes'), coordonneesVille('Fès'));
  assert.deepEqual(coordonneesVille('  FÈS '), coordonneesVille('Fès'));
  assert.deepEqual(coordonneesVille('Khemisset'), coordonneesVille('Khémisset'));
});

test('une autre orthographe connue retrouve la même ville', () => {
  assert.deepEqual(coordonneesVille('Boulmane'), coordonneesVille('Boulemane'));
});

// Une ville inconnue n'est jamais placée au jugé : l'Accueil la signale à part.
test('une ville absente du référentiel renvoie null', () => {
  assert.equal(coordonneesVille('Dakhla'), null);
  assert.equal(coordonneesVille(''), null);
});

test('deux entrées ne se disputent pas le même nom', () => {
  const noms = REFERENTIEL_COORDONNEES_VILLES.flatMap((e) => [e.ville, ...(e.alias ?? [])]).map(normaliserVille);
  assert.equal(new Set(noms).size, noms.length);
});

test('modifier le résultat ne déplace pas la ville', () => {
  const fes = coordonneesVille('Fès');
  assert.ok(fes);
  fes.latitude = 0;
  assert.notEqual(coordonneesVille('Fès')?.latitude, 0);
});
