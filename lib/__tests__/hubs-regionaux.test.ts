import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HUB_CENTRAL,
  HUBS_REGIONAUX,
  agencesARechercher,
  hubRegionalDeLAgence,
  nomHubActuel,
  resoudreParAgences,
} from '../hubs-regionaux';
import { CORRESPONDANCES_VILLES_COLIVRAISON, resoudreVilleColivraison } from '../colivraison-villes';
import { CORRESPONDANCES_VILLES_EST } from '../est-livraison-villes';
import { CORRESPONDANCES_VILLES_META, resoudreVilleMeta } from '../meta-livraison-villes';
import { CORRESPONDANCES_VILLES_POWER } from '../power-delivery-villes';
import { normaliserVille } from '../hub-stock';

test('les 11 hubs arrêtés le 06/10/2026, sans doublon, distincts du hub central', () => {
  assert.deepEqual(
    HUBS_REGIONAUX.map((h) => h.nom),
    [
      'Hub Tanger',
      'Hub Oujda',
      'Hub Agadir',
      'Hub Guelmim',
      'Hub Rabat',
      'Hub Casablanca',
      'Hub Béni Mellal',
      'Hub El Jadida',
      'Hub Safi',
      'Hub Fès',
      'Hub Marrakech',
    ]
  );
  assert.ok(!HUBS_REGIONAUX.some((h) => h.nom === HUB_CENTRAL));
});

test("une agence n'appartient qu'à un hub, et la ville du hub est celle d'une de ses agences", () => {
  const vues = new Set<string>();
  for (const h of HUBS_REGIONAUX) {
    assert.ok(h.agences.some((a) => normaliserVille(a.ville) === normaliserVille(h.ville)), h.nom);
    for (const a of h.agences) {
      assert.ok(!vues.has(a.nom), `${a.nom} dans deux hubs`);
      vues.add(a.nom);
    }
  }
});

// Le garde-fou qui compte : une agence citée par une table de villes mais
// absente du découpage rendrait ses villes introuvables à la remise.
test('chaque agence des tables de villes des transporteurs est rangée dans un hub de CE transporteur', () => {
  const tables: [string, readonly { agence: string }[]][] = [
    ['Meta Livraison', CORRESPONDANCES_VILLES_META],
    ['Power Delivery', CORRESPONDANCES_VILLES_POWER],
    ['Colivraison', CORRESPONDANCES_VILLES_COLIVRAISON],
    ['EST Livraison', CORRESPONDANCES_VILLES_EST],
  ];
  for (const [prestataire, table] of tables) {
    for (const agence of new Set(table.map((c) => c.agence))) {
      const hub = hubRegionalDeLAgence(agence);
      assert.ok(hub, `${prestataire} / ${agence} : aucun hub régional`);
      assert.equal(hub.prestataire, prestataire, `${agence} rangée chez ${hub.prestataire}`);
    }
  }
});

test('nomHubActuel : une ancienne agence désigne son hub, tout autre nom reste tel quel', () => {
  assert.equal(nomHubActuel('Agence Taza'), 'Hub Fès');
  assert.equal(nomHubActuel('Agence Khouribga'), 'Hub Béni Mellal');
  assert.equal(nomHubActuel('Agence Casablanca'), 'Hub Casablanca');
  assert.equal(nomHubActuel(HUB_CENTRAL), HUB_CENTRAL);
});

test('agencesARechercher : celles du hub, toutes celles du transporteur pour un bon direct', () => {
  assert.equal(agencesARechercher({ hubNom: 'Hub Fès', prestataire: 'Meta Livraison' }).length, 9);
  assert.equal(agencesARechercher({ hubNom: null, prestataire: 'Meta Livraison' }).length, 9);
  assert.equal(agencesARechercher({ hubNom: null, prestataire: 'Power Delivery' }).length, 5);
  // Base pas encore regroupée : l'agence elle-même.
  assert.deepEqual(agencesARechercher({ hubNom: 'Agence Taza', prestataire: 'Meta Livraison' }), ['Agence Taza']);
  assert.deepEqual(agencesARechercher({ hubNom: HUB_CENTRAL, prestataire: 'Meta Livraison' }), []);
});

test('Meta : une ville de l’ancienne Agence Taza se résout via Hub Fès comme en direct', () => {
  const taza = CORRESPONDANCES_VILLES_META.find((c) => c.agence === 'Agence Taza');
  assert.ok(taza);
  for (const hubNom of ['Hub Fès', null]) {
    const r = resoudreParAgences(
      agencesARechercher({ hubNom, prestataire: 'Meta Livraison' }),
      taza.ville,
      resoudreVilleMeta,
      (c) => String(c.cityId)
    );
    assert.equal(r?.resultat.cityId, taza.cityId);
    assert.equal(r?.agence, 'Agence Taza');
  }
});

test('Colivraison : une ville de l’ancienne Agence Khouribga se résout via Hub Béni Mellal', () => {
  const ligne = CORRESPONDANCES_VILLES_COLIVRAISON.find((c) => c.agence === 'Agence Khouribga');
  assert.ok(ligne);
  const r = resoudreParAgences(
    agencesARechercher({ hubNom: 'Hub Béni Mellal', prestataire: 'Colivraison' }),
    ligne.ville,
    resoudreVilleColivraison,
    (c) => String(c.cityId)
  );
  assert.equal(r?.resultat.cityId, ligne.cityId);
});

test('resoudreParAgences : deux identifiants différents → null, jamais un choix au hasard', () => {
  const table: Record<string, number> = { A: 1, B: 2, C: 1 };
  const resoudre = (agence: string) => (agence in table ? { id: table[agence] } : null);
  assert.equal(resoudreParAgences(['A', 'C'], 'x', resoudre, (r) => String(r.id))?.resultat.id, 1);
  assert.equal(resoudreParAgences(['A', 'B'], 'x', resoudre, (r) => String(r.id)), null);
  assert.equal(resoudreParAgences(['Z'], 'x', resoudre, (r) => String(r.id)), null);
});
