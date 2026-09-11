import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TAILLE_MAX_PIECE_JOINTE,
  analyserPieceJointe,
  libelleTaille,
  mimeDeDataUrl,
  nomParDefaut,
  nomTelechargeable,
  octetsDepuisBase64,
  typeDeMime,
  type PieceAnalysee,
} from '../pieces-jointes';

/** Data URL d'un fichier de `octets` octets, du mime demandé. */
function fichier(mime: string, octets: number): string {
  return `data:${mime};base64,${Buffer.alloc(octets, 7).toString('base64')}`;
}

/** La pièce d'une analyse qu'on attend acceptée — échoue sinon, plutôt que de
 *  laisser le test suivant planter sur un `undefined`. */
function acceptee(brut: string): PieceAnalysee {
  const res = analyserPieceJointe(brut);
  assert.equal(res.statut, 'ok', res.statut === 'refus' ? res.message : '');
  return res.statut === 'ok' ? res.piece : (undefined as never);
}

function messageDeRefus(brut: string): string {
  const res = analyserPieceJointe(brut);
  assert.equal(res.statut, 'refus');
  return res.statut === 'refus' ? res.message : '';
}

test('un fichier accepté est classé par son mime', () => {
  const piece = acceptee(fichier('image/png', 900));
  assert.equal(piece.kind, 'fichier');
  assert.equal(piece.type, 'image');
  assert.equal(piece.kind === 'fichier' && piece.poids, 900);
});

test('un PDF est un document, pas une image', () => {
  assert.equal(acceptee(fichier('application/pdf', 64)).type, 'document');
});

// Un SVG s'exécute dans l'origine qui le sert : la route de contenu renvoie
// les octets avec leur Content-Type, donc il n'entre pas.
test('les formats exécutables sont refusés', () => {
  for (const mime of ['image/svg+xml', 'text/html', 'application/javascript']) {
    assert.match(messageDeRefus(fichier(mime, 64)), /Format non accepté/, `${mime} aurait dû être refusé`);
  }
});

test('au-delà du plafond, le fichier est refusé', () => {
  assert.match(messageDeRefus(fichier('image/png', TAILLE_MAX_PIECE_JOINTE + 1)), /trop lourd/);
});

test('un fichier vide est refusé', () => {
  assert.equal(messageDeRefus('data:image/png;base64,'), 'Fichier vide');
});

// C'était la première cause de rejet du formulaire : une adresse collée depuis
// la barre du navigateur n'a pas toujours son schéma.
test('un lien sans schéma est complété en https', () => {
  const piece = acceptee('mathio.ma/grille.pdf');
  assert.equal(piece.kind, 'lien');
  assert.equal(piece.kind === 'lien' && piece.url, 'https://mathio.ma/grille.pdf');
});

test('un schéma autre que http(s) est refusé', () => {
  assert.equal(analyserPieceJointe('javascript:alert(1)').statut, 'refus');
  assert.equal(analyserPieceJointe('file:///etc/passwd').statut, 'refus');
});

test('une saisie vide est refusée', () => {
  assert.equal(analyserPieceJointe('   ').statut, 'refus');
});

test('poids déduit du base64', () => {
  assert.equal(octetsDepuisBase64(Buffer.alloc(10).toString('base64')), 10);
  assert.equal(octetsDepuisBase64(Buffer.alloc(11).toString('base64')), 11);
  assert.equal(octetsDepuisBase64(Buffer.alloc(12).toString('base64')), 12);
});

test("le mime se lit sur l'en-tête seul, sans le corps", () => {
  assert.equal(mimeDeDataUrl('data:application/pdf;base64,JVBERi0xLj'), 'application/pdf');
  assert.equal(mimeDeDataUrl('https://mathio.ma/grille.pdf'), null);
  assert.equal(typeDeMime(null), 'lien');
});

test('nom de repli : hôte pour un lien, extension pour un fichier', () => {
  assert.equal(nomParDefaut(acceptee('https://www.mathio.ma/a.pdf')), 'mathio.ma');
  assert.equal(nomParDefaut(acceptee(fichier('application/pdf', 32))), 'Fichier.pdf');
});

test('poids lisible', () => {
  assert.equal(libelleTaille(512), '512 o');
  assert.equal(libelleTaille(2048), '2.0 Ko');
  assert.equal(libelleTaille(3 * 1024 * 1024), '3.0 Mo');
});

// Un guillemet ou un saut de ligne dans le nom permettrait d'injecter un
// second en-tête dans la réponse de la route de contenu.
test('le nom de téléchargement est assaini et extensionné', () => {
  assert.equal(nomTelechargeable('Grille "2026"\r\nX', 'application/pdf'), 'Grille _2026___X.pdf');
  assert.equal(nomTelechargeable('déjà.pdf', 'application/pdf'), 'déjà.pdf');
  assert.equal(nomTelechargeable('', null), 'piece-jointe');
});
