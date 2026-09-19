import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normaliserCodePlateforme, raisonSuppression } from '../plateformes';
import { ApiError } from '../api-utils';

// Le code d'une plateforme finit dans les URL d'administration et dans les
// journaux : on le contraint à la saisie plutôt que de le nettoyer en silence.
// Sa règle est donc un contrat, et c'est ce contrat qu'on fige ici.

function accepte(valeur: unknown): string | null {
  try {
    return normaliserCodePlateforme(valeur);
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

test('un code valide est accepté et normalisé', () => {
  assert.equal(accepte('shipeh'), 'shipeh');
  assert.equal(accepte('  SHIPEH  '), 'shipeh');
  assert.equal(accepte('canal-2'), 'canal-2');
});

test('les bornes de longueur sont celles que le message annonce', () => {
  // Le motif précédent — `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$` — acceptait
  // un code d'UN caractère et refusait ceux de DEUX, l'inverse exact de la
  // règle que son propre message d'erreur énonçait. Ces quatre assertions
  // fixent les bornes réelles.
  assert.equal(accepte('a'), null, 'un caractère : sous la borne annoncée');
  assert.equal(accepte('ab'), 'ab', 'deux caractères : la borne basse, acceptée');
  assert.equal(accepte('a'.repeat(32)), 'a'.repeat(32), '32 caractères : la borne haute');
  assert.equal(accepte('a'.repeat(33)), null, '33 caractères : au-delà');
});

test('un tiret ne peut être ni en tête ni en queue', () => {
  // Il finirait dans une URL, où un segment qui commence ou se termine par un
  // tiret se lit mal et se recopie encore plus mal.
  assert.equal(accepte('-shipeh'), null);
  assert.equal(accepte('shipeh-'), null);
  assert.equal(accepte('ship-eh'), 'ship-eh');
});

test('tout ce qui n’est pas minuscule, chiffre ou tiret est refusé', () => {
  for (const code of ['Shipeh!', 'ship eh', 'shipéh', 'ship_eh', 'ship.eh', '']) {
    assert.equal(accepte(code), null, `aurait dû être refusé : « ${code} »`);
  }
  // Les majuscules ne sont pas refusées mais NORMALISÉES : un admin qui saisit
  // le nom de la plateforme telle qu'il l'écrit ne doit pas buter dessus.
  assert.equal(accepte('Shipeh'), 'shipeh');
});

test('une valeur qui n’est pas une chaîne est refusée sans lever autre chose', () => {
  for (const valeur of [undefined, null, 42, {}, ['shipeh']]) {
    assert.equal(accepte(valeur), null, `entrée : ${JSON.stringify(valeur)}`);
  }
});

// --- Ce qui interdit de supprimer un compte machine -------------------------
//
// `raisonSuppression` est la SEULE source de cette décision : l'écran s'en sert
// pour cacher le bouton (via `modifiables.suppression`) et la route pour
// refuser. Les figer ici, c'est garantir qu'ils ne pourront pas diverger —
// c'est-à-dire qu'aucun bouton ne proposera une suppression qui finira en 409.

const RIEN = { nbEcrituresSignees: 0, nbMarchandsLive: 0, nbMarchandsTest: 0 };

test('un compte qui n’a rien laissé derrière lui est supprimable', () => {
  assert.equal(raisonSuppression(RIEN), null);
});

test('une seule écriture signée suffit à bloquer la suppression', () => {
  // La borne est à UN, pas à « quelques » : `HistoriqueStatutCommande.utilisateurId`
  // est non nullable, donc une ligne unique rend déjà la suppression du compte
  // de service impossible en base. La règle applicative ne fait que le dire
  // avant que Postgres ne le refuse.
  const raison = raisonSuppression({ ...RIEN, nbEcrituresSignees: 1 });
  assert.ok(raison);
  assert.match(raison, /historique/i);
});

test('des marchands de production bloquent aussi, même sans écriture signée', () => {
  const raison = raisonSuppression({ ...RIEN, nbMarchandsLive: 3 });
  assert.ok(raison);
  assert.match(raison, /production/i);
});

test('des données de bac à sable bloquent, en renvoyant vers la purge', () => {
  // Cas distinct des deux précédents : il se DÉBLOQUE, et le message doit
  // nommer le geste qui débloque. Un « suppression impossible » sec enverrait
  // chercher une cause là où il n’y a qu’une étape à faire d’abord.
  const raison = raisonSuppression({ ...RIEN, nbMarchandsTest: 2 });
  assert.ok(raison);
  assert.match(raison, /Purger/);
});

test('l’écriture signée l’emporte sur les autres causes', () => {
  // L’ordre des causes n’est pas cosmétique : la première est la seule
  // définitive. Annoncer « purgez le bac à sable » à quelqu’un dont le compte a
  // déjà signé de vraies écritures lui ferait faire une purge irréversible pour
  // rien, et la suppression échouerait quand même.
  const raison = raisonSuppression({
    nbEcrituresSignees: 5,
    nbMarchandsLive: 2,
    nbMarchandsTest: 7,
  });
  assert.ok(raison);
  assert.match(raison, /historique/i);
  assert.doesNotMatch(raison, /Purger/);
});
