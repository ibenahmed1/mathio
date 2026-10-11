import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRODUITS_MAX_PAR_COLIS, TAILLE_MAX_LOT, analyserEntreeColis } from '../plateforme-colis';
import { ErreurPlateforme } from '../plateforme-auth';

// Comme pour les marchands, seule la VALIDATION est testée ici : l'ingestion
// écrit en base et relève du scénario de bout en bout
// (scripts/simuler-shipeh.ts).

const VALIDE = {
  idExterneMarchand: 'shipeh-12345',
  reference: 'SHP-2026-0001',
  clientNom: 'Karim Idrissi',
  clientTelephone: '0655443322',
  ville: 'Rabat',
  adresse: '18 avenue Mohammed V',
  montantCod: 349.9,
  produits: [{ sku: 'TSH-NOIR-M', quantite: 2 }],
};

function codeRefus(corps: unknown): string | null {
  try {
    analyserEntreeColis(corps);
    return null;
  } catch (error) {
    if (error instanceof ErreurPlateforme) return error.code;
    throw error;
  }
}

test('un colis minimal valide est accepté, avec ses défauts', () => {
  const colis = analyserEntreeColis(VALIDE);
  assert.equal(colis.reference, 'SHP-2026-0001');
  assert.equal(colis.montantCod, 349.9);
  assert.deepEqual(colis.produits, [{ sku: 'TSH-NOIR-M', quantite: 2 }]);
  assert.equal(colis.poidsKg, null);
  assert.equal(colis.ouvrir, false);
  assert.equal(colis.fragile, false);
});

test('la référence est requise : c’est la clé d’idempotence', () => {
  // La colonne codeSuiviPartenaire est NULLABLE en base — volontairement, pour
  // laisser les colis saisis à la main hors de la contrainte d'unicité. Sur
  // cette voie-ci, l'accepter vide reviendrait à désactiver la protection
  // anti-doublon pour toute la plateforme.
  assert.equal(codeRefus({ ...VALIDE, reference: undefined }), 'champ_requis');
  assert.equal(codeRefus({ ...VALIDE, reference: '  ' }), 'champ_requis');
});

test('les champs d’acheminement sont tous requis', () => {
  for (const champ of ['idExterneMarchand', 'clientNom', 'clientTelephone', 'ville', 'adresse']) {
    assert.equal(codeRefus({ ...VALIDE, [champ]: undefined }), 'champ_requis', `${champ} manquant`);
    assert.equal(codeRefus({ ...VALIDE, [champ]: '   ' }), 'champ_requis', `${champ} vide`);
  }
});

test('le montant COD doit être strictement positif', () => {
  // Zéro n'est pas « gratuit » ici mais « non renseigné » : accepter 0
  // ferait entrer un colis qu'aucun livreur ne saurait encaisser, et qui
  // fausserait la facturation du marchand.
  for (const montant of [undefined, null, 0, -10, 'beaucoup', NaN]) {
    assert.equal(codeRefus({ ...VALIDE, montantCod: montant }), 'montant_invalide', String(montant));
  }
  // Un montant en chaîne reste accepté : c'est ce que produit un sérialiseur
  // Decimal côté partenaire, et le refuser casserait l'intégration sur un
  // détail de représentation.
  assert.equal(analyserEntreeColis({ ...VALIDE, montantCod: '120.50' }).montantCod, 120.5);
});

test('un colis contient au moins un produit de stock', () => {
  assert.equal(codeRefus({ ...VALIDE, produits: undefined }), 'champ_requis');
  assert.equal(codeRefus({ ...VALIDE, produits: [] }), 'produits_invalides');
  assert.equal(codeRefus({ ...VALIDE, produits: 'TSH-NOIR-M' }), 'produits_invalides');
  const trop = Array.from({ length: PRODUITS_MAX_PAR_COLIS + 1 }, (_, i) => ({ sku: `S${i}`, quantite: 1 }));
  assert.equal(codeRefus({ ...VALIDE, produits: trop }), 'produits_invalides');
});

test('chaque ligne porte un SKU et une quantité entière positive', () => {
  assert.equal(codeRefus({ ...VALIDE, produits: [{ quantite: 1 }] }), 'champ_requis');
  assert.equal(codeRefus({ ...VALIDE, produits: [{ sku: '  ', quantite: 1 }] }), 'champ_requis');
  for (const q of [undefined, 0, -1, 2.5, 'deux', 3_000_000_000]) {
    assert.equal(codeRefus({ ...VALIDE, produits: [{ sku: 'A', quantite: q }] }), 'quantite_invalide', String(q));
  }
});

test('un même SKU répété (casse comprise) ne fait qu’une ligne, quantités additionnées', () => {
  const colis = analyserEntreeColis({
    ...VALIDE,
    produits: [
      { sku: ' TSH-NOIR-M ', quantite: 2 },
      { sku: 'MUG-01', quantite: 1 },
      { sku: 'tsh-noir-m', quantite: 3 },
    ],
  });
  assert.deepEqual(colis.produits, [
    { sku: 'TSH-NOIR-M', quantite: 5 },
    { sku: 'MUG-01', quantite: 1 },
  ]);
});

test('les valeurs numériques hors bornes SQL sont refusées en 400, pas en 500', () => {
  // Sans borne haute, ces valeurs traversaient la validation, atteignaient
  // PostgreSQL et y déclenchaient un « numeric field overflow » : l'appelant
  // recevait un 500 — « le problème est chez nous » — pour une valeur qu'il
  // avait mal formée, et sans rien pour la corriger.
  assert.equal(codeRefus({ ...VALIDE, montantCod: 1e12 }), 'montant_invalide'); // > Decimal(10,2)
  assert.equal(codeRefus({ ...VALIDE, poidsKg: 100000 }), 'poids_invalide'); // > Decimal(6,2)

  // Les valeurs limites, elles, restent acceptées.
  assert.equal(analyserEntreeColis({ ...VALIDE, montantCod: 99999999.99 }).montantCod, 99999999.99);
  assert.equal(analyserEntreeColis({ ...VALIDE, poidsKg: 9999.99 }).poidsKg, 9999.99);
});

test('les montants sont arrondis à deux décimales à l’entrée', () => {
  // PostgreSQL arrondirait de toute façon, mais SILENCIEUSEMENT : un
  // partenaire qui envoie 10.999 verrait sa réconciliation COD dériver sans
  // jamais savoir d'où. On arrondit ici, comme partout où de l'argent entre
  // dans ce dépôt.
  assert.equal(analyserEntreeColis({ ...VALIDE, montantCod: 10.999 }).montantCod, 11);
  assert.equal(analyserEntreeColis({ ...VALIDE, montantCod: 10.994 }).montantCod, 10.99);
  assert.equal(analyserEntreeColis({ ...VALIDE, poidsKg: 1.239 }).poidsKg, 1.24);
});

test('le poids est optionnel mais jamais nul ou négatif', () => {
  assert.equal(analyserEntreeColis(VALIDE).poidsKg, null);
  assert.equal(analyserEntreeColis({ ...VALIDE, poidsKg: null }).poidsKg, null);
  assert.equal(analyserEntreeColis({ ...VALIDE, poidsKg: 1.4 }).poidsKg, 1.4);
  assert.equal(codeRefus({ ...VALIDE, poidsKg: 0 }), 'poids_invalide');
  assert.equal(codeRefus({ ...VALIDE, poidsKg: -2 }), 'poids_invalide');
});

test('les drapeaux sont lus tels quels, sans piège de véracité', () => {
  assert.equal(analyserEntreeColis({ ...VALIDE, fragile: true, ouvrir: true }).fragile, true);
  assert.equal(analyserEntreeColis({ ...VALIDE, fragile: false }).fragile, false);
  assert.equal(analyserEntreeColis(VALIDE).ouvrir, false);
});

test('un colis qui n’est pas un objet JSON est refusé proprement', () => {
  for (const corps of [null, undefined, 'texte', 42, []]) {
    assert.equal(codeRefus(corps), 'corps_invalide', JSON.stringify(corps));
  }
});

test('les champs texte optionnels sont élagués, vide valant absent', () => {
  const colis = analyserEntreeColis({
    ...VALIDE,
    codePostal: ' 10000 ',
    notes: '   ',
  });
  assert.equal(colis.codePostal, '10000');
  assert.equal(colis.notes, null);
});

test('le plafond d’un lot est une valeur exportée, pas un nombre perdu', () => {
  // Le simulateur et la documentation partenaire s'appuient dessus : le
  // dupliquer ferait diverger ce qu'on annonce et ce qu'on applique.
  assert.ok(Number.isInteger(TAILLE_MAX_LOT));
  assert.ok(TAILLE_MAX_LOT > 0);
});
