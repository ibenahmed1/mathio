import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyserEntreeMarchand } from '../plateforme-marchands';
import { ErreurPlateforme } from '../plateforme-auth';

// Seule la VALIDATION est testée ici : `synchroniserMarchand` écrit en base et
// relève du scénario de bout en bout (scripts/simuler-shipeh.ts). C'est
// pourtant la validation qui décide de ce qui entre dans le système, donc
// l'endroit où une régression coûte le plus cher.

const VALIDE = {
  idExterne: 'shipeh-12345',
  nomComplet: 'Ahmed Benali',
  nomBoutique: 'Atlas Store',
  telephone: '0612345678',
  email: 'ahmed@atlas-store.ma',
};

/** Code d'erreur levé par `analyserEntreeMarchand`, ou null si elle a accepté. */
function codeRefus(corps: unknown): string | null {
  try {
    analyserEntreeMarchand(corps);
    return null;
  } catch (error) {
    if (error instanceof ErreurPlateforme) return error.code;
    throw error;
  }
}

test('une entrée minimale valide est acceptée', () => {
  const entree = analyserEntreeMarchand(VALIDE);
  assert.equal(entree.idExterne, 'shipeh-12345');
  assert.equal(entree.nomBoutique, 'Atlas Store');
  // Type de compte par défaut : la plateforme n'a pas à le connaître.
  assert.equal(entree.typeCompte, 'marchand');
  // Tout le reste est optionnel et vaut null, jamais une chaîne vide : c'est
  // ce que le schéma attend, et « inconnu » ne doit pas se confondre avec
  // « renseigné à vide ».
  assert.equal(entree.ville, null);
  assert.equal(entree.rib, null);
});

test('les cinq champs requis le sont vraiment', () => {
  for (const champ of ['idExterne', 'nomComplet', 'nomBoutique', 'telephone', 'email']) {
    const ampute = { ...VALIDE, [champ]: undefined };
    assert.equal(codeRefus(ampute), 'champ_requis', `${champ} devrait être requis`);
    // Une chaîne d'espaces ne vaut pas mieux qu'une absence.
    assert.equal(codeRefus({ ...VALIDE, [champ]: '   ' }), 'champ_requis', `${champ} : espaces`);
  }
});

test('l’email est requis parce qu’il est le seul chemin vers le compte', () => {
  // Sans email, pas de lien « définir mon mot de passe » — donc un compte que
  // personne ne peut jamais ouvrir. C'est la raison pour laquelle il est le
  // seul champ de coordonnées obligatoire.
  assert.equal(codeRefus({ ...VALIDE, email: undefined }), 'champ_requis');
  assert.equal(codeRefus({ ...VALIDE, email: 'pas-un-email' }), 'email_invalide');
  assert.equal(codeRefus({ ...VALIDE, email: 'a@b' }), 'email_invalide');
});

test('l’email est normalisé en minuscules', () => {
  // La colonne est UNIQUE : sans normalisation, « A@B.ma » et « a@b.ma »
  // créeraient deux comptes pour la même personne.
  assert.equal(analyserEntreeMarchand({ ...VALIDE, email: '  Ahmed@Atlas-Store.MA ' }).email, 'ahmed@atlas-store.ma');
});

test('le téléphone est accepté dans ses écritures usuelles et stocké normalisé', () => {
  for (const saisie of ['0612345678', '+212612345678', '212612345678', '06 12 34 56 78']) {
    assert.equal(
      analyserEntreeMarchand({ ...VALIDE, telephone: saisie }).telephone,
      '0612345678',
      `écriture refusée : ${saisie}`
    );
  }
});

test('un téléphone non marocain est refusé, pas rangé tel quel', () => {
  // Le stocker brut le rendrait introuvable au rattachement suivant : la même
  // personne reviendrait sous une autre écriture et on lui créerait un second
  // compte.
  for (const saisie of ['12345', '+33612345678', 'zéro six']) {
    assert.equal(codeRefus({ ...VALIDE, telephone: saisie }), 'telephone_invalide', saisie);
  }
});

test('le RIB, s’il est fourni, doit faire exactement 24 chiffres', () => {
  assert.equal(codeRefus({ ...VALIDE, rib: '1'.repeat(23) }), 'rib_invalide');
  assert.equal(codeRefus({ ...VALIDE, rib: '1'.repeat(25) }), 'rib_invalide');
  assert.equal(codeRefus({ ...VALIDE, rib: 'abc' }), 'rib_invalide');
  assert.equal(analyserEntreeMarchand({ ...VALIDE, rib: '1'.repeat(24) }).rib, '1'.repeat(24));
  // Absent reste absent : une plateforme n'a pas toujours le RIB de ses
  // marchands, et l'exiger bloquerait toute la synchronisation.
  assert.equal(analyserEntreeMarchand(VALIDE).rib, null);
});

test('un typeCompte hors enum est refusé', () => {
  assert.equal(codeRefus({ ...VALIDE, typeCompte: 'grossiste' }), 'type_compte_invalide');
  assert.equal(analyserEntreeMarchand({ ...VALIDE, typeCompte: 'entreprise' }).typeCompte, 'entreprise');
});

test('un corps qui n’est pas un objet JSON est refusé proprement', () => {
  // Sans ce garde, `corps.idExterne` sur un tableau ou un null produirait un
  // 500 — « le problème est chez nous » — pour une requête mal formée par
  // l'appelant.
  for (const corps of [null, undefined, 'texte', 42, [], [VALIDE]]) {
    assert.equal(codeRefus(corps), 'corps_invalide', `corps : ${JSON.stringify(corps)}`);
  }
});

test('les champs optionnels sont recopiés en étant élagués', () => {
  const entree = analyserEntreeMarchand({
    ...VALIDE,
    ville: '  Casablanca ',
    adresse: ' 12 rue X ',
    cin: 'AB12345',
    siteWeb: '',
    nomBanque: '  CIH  ',
  });
  assert.equal(entree.ville, 'Casablanca');
  assert.equal(entree.adresse, '12 rue X');
  assert.equal(entree.cin, 'AB12345');
  // Chaîne vide → null, comme une absence.
  assert.equal(entree.siteWeb, null);
  assert.equal(entree.nomBanque, 'CIH');
});
