import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyserEntreeProduit } from '../plateforme-produits';
import { ErreurPlateforme } from '../plateforme-auth';

// Seule la VALIDATION est testée ici ; la déclaration écrit en base et relève
// du scénario de bout en bout (scripts/simuler-shipeh.ts).

const SIMPLE = {
  idExterneMarchand: 'shipeh-12345',
  nom: 'Mug blanc',
  reference: 'MUG-01',
  quantiteEnCours: 20,
};

const A_VARIANTES = {
  idExterneMarchand: 'shipeh-12345',
  nom: 'Robe d’été',
  reference: 'PRD-K7M2Q9XA',
  note: 'Tissu léger, lavage à 30°',
  variantesActivees: true,
  variantes: [
    { nom: 'Rouge / M', reference: 'PRD-K7M2Q9XA-ROUGE-M', quantiteEnCours: 10 },
    { nom: 'Bleu / M', reference: 'PRD-K7M2Q9XA-BLEU-M', quantiteEnCours: 8 },
  ],
};

function codeRefus(corps: unknown): string | null {
  try {
    analyserEntreeProduit(corps);
    return null;
  } catch (error) {
    if (error instanceof ErreurPlateforme) return error.code;
    throw error;
  }
}

test('un produit simple porte sa quantité annoncée', () => {
  const p = analyserEntreeProduit(SIMPLE);
  assert.equal(p.reference, 'MUG-01');
  assert.equal(p.quantiteEnCours, 20);
  assert.equal(p.variantesActivees, false);
  assert.deepEqual(p.variantes, []);
  assert.equal(p.note, null);
  assert.equal(p.photoUrl, null);
});

test('un produit à variantes : le stock vit sur les variantes, le produit reste à 0', () => {
  const p = analyserEntreeProduit({ ...A_VARIANTES, quantiteEnCours: 99 });
  assert.equal(p.quantiteEnCours, 0);
  assert.equal(p.variantes.length, 2);
  assert.deepEqual(p.variantes[0], { nom: 'Rouge / M', reference: 'PRD-K7M2Q9XA-ROUGE-M', quantiteEnCours: 10 });
});

test('les champs requis le sont, y compris la quantité d’un produit simple', () => {
  for (const champ of ['idExterneMarchand', 'nom', 'reference', 'quantiteEnCours']) {
    assert.equal(codeRefus({ ...SIMPLE, [champ]: undefined }), 'champ_requis', champ);
  }
  assert.equal(codeRefus({ ...SIMPLE, reference: '   ' }), 'champ_requis');
});

test('une quantité est un entier positif ou nul', () => {
  assert.equal(analyserEntreeProduit({ ...SIMPLE, quantiteEnCours: 0 }).quantiteEnCours, 0);
  for (const q of [-1, 2.5, 'vingt', 3_000_000_000]) {
    assert.equal(codeRefus({ ...SIMPLE, quantiteEnCours: q }), 'quantite_invalide', String(q));
  }
  const variante = { ...A_VARIANTES.variantes[0], quantiteEnCours: -3 };
  assert.equal(codeRefus({ ...A_VARIANTES, variantes: [variante] }), 'quantite_invalide');
});

test('variantes activées sans variante : refus', () => {
  assert.equal(codeRefus({ ...A_VARIANTES, variantes: [] }), 'champ_requis');
  assert.equal(codeRefus({ ...A_VARIANTES, variantes: undefined }), 'champ_requis');
  assert.equal(codeRefus({ ...A_VARIANTES, variantes: [{ nom: 'Rouge', quantiteEnCours: 1 }] }), 'champ_requis');
});

test('un SKU ne peut servir deux fois dans la requête, produit compris, sans casse', () => {
  const doublon = { nom: 'Bis', reference: 'prd-k7m2q9xa-rouge-m', quantiteEnCours: 1 };
  assert.equal(codeRefus({ ...A_VARIANTES, variantes: [...A_VARIANTES.variantes, doublon] }), 'sku_duplique');
  const commeProduit = { nom: 'Même SKU', reference: 'PRD-K7M2Q9XA', quantiteEnCours: 1 };
  assert.equal(codeRefus({ ...A_VARIANTES, variantes: [commeProduit] }), 'sku_duplique');
});

test('la photo est une URL https ou une image embarquée, rien d’autre', () => {
  assert.equal(analyserEntreeProduit({ ...SIMPLE, photoUrl: 'https://cdn.exemple.ma/mug.jpg' }).photoUrl, 'https://cdn.exemple.ma/mug.jpg');
  assert.ok(analyserEntreeProduit({ ...SIMPLE, photoUrl: 'data:image/jpeg;base64,/9j/4AAQ' }).photoUrl);
  assert.equal(codeRefus({ ...SIMPLE, photoUrl: 'javascript:alert(1)' }), 'photo_invalide');
  assert.equal(codeRefus({ ...SIMPLE, photoUrl: 'data:text/html;base64,PGI+' }), 'photo_invalide');
  const enorme = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;
  assert.equal(codeRefus({ ...SIMPLE, photoUrl: enorme }), 'photo_invalide');
});

test('un corps qui n’est pas un objet est refusé proprement', () => {
  for (const corps of [null, 'texte', 42, [SIMPLE]]) {
    assert.equal(codeRefus(corps), 'corps_invalide', JSON.stringify(corps));
  }
});
