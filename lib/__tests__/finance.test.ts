import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATEGORIES_TRANSACTION,
  LABELS_CATEGORIE_TRANSACTION,
  LABELS_TYPE_TRANSACTION,
  TYPES_TRANSACTION,
  formatMontantTransaction,
  formatSolde,
  MIMES_PREUVE_COMPTABLE,
  TAILLE_MAX_PREUVE_COMPTABLE,
  analyserPreuveComptable,
  dataUrlPreuve,
  nomFichierPreuve,
} from '../finance';

// Ce module n'a que deux fonctions, et elles ne font que du formatage — mais
// c'est le formatage du JOURNAL COMPTABLE. Un signe inversé n'y provoque
// aucune erreur : il fait juste lire un déficit comme un excédent, ce qui est
// pire qu'un plantage.

// ------------------------------------------------------------
// Montant d'une écriture
// ------------------------------------------------------------

// `Transaction.montant` est TOUJOURS positif en base : le sens de l'écriture
// est porté par `type`. C'est donc le type, et lui seul, qui décide du signe
// affiché.
test('le signe vient du type, jamais du montant', () => {
  assert.equal(formatMontantTransaction(1500, 'revenu'), '+ 1500.00 DH');
  assert.equal(formatMontantTransaction(1500, 'depense'), '- 1500.00 DH');
});

// Si un montant négatif traverse malgré tout la validation, une dépense ne
// doit pas se transformer en recette par double négation — même règle que
// effetAjustement sur les bons de paiement.
test('un montant négatif ne renverse pas le sens de l’écriture', () => {
  assert.equal(formatMontantTransaction(-1500, 'depense'), '- 1500.00 DH');
  assert.equal(formatMontantTransaction(-1500, 'revenu'), '+ 1500.00 DH');
});

// Prisma rend les Decimal sous forme de chaîne : le formatage doit accepter ce
// que la base renvoie réellement.
test('un montant en chaîne (Decimal Prisma) est accepté', () => {
  assert.equal(formatMontantTransaction('249.5', 'revenu'), '+ 249.50 DH');
});

test('deux décimales toujours affichées', () => {
  assert.equal(formatMontantTransaction(7, 'revenu'), '+ 7.00 DH');
  assert.equal(formatMontantTransaction(0.5, 'depense'), '- 0.50 DH');
  assert.equal(formatMontantTransaction(1234.567, 'revenu'), '+ 1234.57 DH');
});

// ------------------------------------------------------------
// Solde
// ------------------------------------------------------------

// Contrairement au montant d'une écriture, le solde est un résultat : c'est
// SON signe qui fait foi, pas un champ à côté.
test('le solde porte son propre signe', () => {
  assert.equal(formatSolde(3200), '+ 3200.00 DH');
  assert.equal(formatSolde(-3200), '- 3200.00 DH');
});

// Un solde nul est un équilibre, pas un déficit : il doit s'afficher « + »,
// sinon un journal à zéro se lit comme une perte.
test('un solde nul s’affiche en positif', () => {
  assert.equal(formatSolde(0), '+ 0.00 DH');
});

// ------------------------------------------------------------
// Référentiels
// ------------------------------------------------------------

// Un enum élargi côté Prisma sans son libellé ici afficherait `undefined` dans
// l'écran de comptabilité. Le test le rappelle au moment de la migration
// plutôt qu'en production.
test('chaque type et chaque catégorie a un libellé', () => {
  for (const t of TYPES_TRANSACTION) {
    assert.equal(typeof LABELS_TYPE_TRANSACTION[t], 'string', `libellé manquant pour le type ${t}`);
    assert.ok(LABELS_TYPE_TRANSACTION[t].length > 0, `libellé vide pour le type ${t}`);
  }
  for (const c of CATEGORIES_TRANSACTION) {
    assert.equal(typeof LABELS_CATEGORIE_TRANSACTION[c], 'string', `libellé manquant pour ${c}`);
    assert.ok(LABELS_CATEGORIE_TRANSACTION[c].length > 0, `libellé vide pour ${c}`);
  }
});

test('aucun doublon dans les référentiels', () => {
  assert.equal(new Set(TYPES_TRANSACTION).size, TYPES_TRANSACTION.length);
  assert.equal(new Set(CATEGORIES_TRANSACTION).size, CATEGORIES_TRANSACTION.length);
});

// ------------------------------------------------------------
// Justificatif d'une écriture
// ------------------------------------------------------------

// Une preuve comptable est stockée en data URL dans la ligne elle-même
// (§ Transaction.preuveUrl) et ressortie par une route qui sert ses octets
// depuis notre origine. Ce qui se joue dans cette analyse n'est donc pas du
// confort de saisie : c'est le seul endroit qui empêche d'écrire en base un
// fichier que le navigateur du comptable exécuterait ensuite, ou un base64 de
// plusieurs dizaines de mégaoctets dans une colonne relue à chaque audit.

/** Data URL d'une image minuscule mais réelle : 8 octets décodés. */
const PREUVE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkY=';

test('une image acceptée ressort avec son mime, son base64 et son poids', () => {
  const resultat = analyserPreuveComptable(PREUVE_JPEG);
  assert.equal(resultat.statut, 'ok');
  if (resultat.statut !== 'ok') return;
  assert.equal(resultat.preuve.mime, 'image/jpeg');
  assert.equal(resultat.preuve.base64, '/9j/4AAQSkY=');
  assert.equal(resultat.preuve.poids, 8);
});

// `image/jpg` n'existe pas au registre des mimes, mais des appareils photo et
// des bibliothèques d'export l'écrivent. Le refuser renverrait le comptable à
// sa galerie pour un fichier parfaitement valide.
test('les alias de mime sont ramenés au format réel', () => {
  for (const [alias, attendu] of [
    ['image/jpg', 'image/jpeg'],
    ['image/pjpeg', 'image/jpeg'],
    ['image/x-png', 'image/png'],
    ['image/tif', 'image/tiff'],
  ]) {
    const resultat = analyserPreuveComptable(`data:${alias};base64,/9j/4AAQSkY=`);
    assert.equal(resultat.statut, 'ok', `${alias} devrait être accepté`);
    if (resultat.statut !== 'ok') continue;
    assert.equal(resultat.preuve.mime, attendu);
  }
});

// LE test de sécurité de ce module. Un SVG est une image pour l'utilisateur,
// mais un document scriptable pour le navigateur : servi par la route de
// contenu sous notre domaine, son `<script>` tournerait avec le cookie de
// session du comptable. Il n'entre pas, quel que soit le confort perdu.
test('un SVG est refusé, image ou non', () => {
  const svg = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+';
  const resultat = analyserPreuveComptable(svg);
  assert.equal(resultat.statut, 'refus');
});

// « Tout type d'image » ne veut pas dire tout type de fichier : un PDF ou un
// tableur n'est pas un justificatif photo, et la route de contenu ne sait pas
// les afficher dans la visionneuse.
test('un fichier qui n’est pas une image est refusé', () => {
  for (const mime of ['application/pdf', 'text/html', 'application/zip', 'text/plain']) {
    const resultat = analyserPreuveComptable(`data:${mime};base64,JVBERi0xLjQK`);
    assert.equal(resultat.statut, 'refus', `${mime} devrait être refusé`);
  }
});

// Une preuve qui vit chez un tiers peut disparaître entre la saisie et le
// contrôle fiscal — et un `javascript:` posé dans un `src` du back-office n'y
// aurait rien à faire non plus.
test('un lien externe n’est pas un justificatif', () => {
  assert.equal(analyserPreuveComptable('https://exemple.ma/recu.jpg').statut, 'refus');
  assert.equal(analyserPreuveComptable('javascript:alert(1)').statut, 'refus');
});

test('une image vide est refusée', () => {
  assert.equal(analyserPreuveComptable('data:image/png;base64,').statut, 'refus');
  assert.equal(analyserPreuveComptable('   ').statut, 'refus');
});

// Le plafond protège la base ET les sauvegardes : la colonne est relue à
// chaque écriture de la ligne.
test('au-delà du plafond, le message dit le poids et la limite', () => {
  const trop = 'A'.repeat(4 * Math.ceil((TAILLE_MAX_PREUVE_COMPTABLE + 1024) / 3));
  const resultat = analyserPreuveComptable(`data:image/jpeg;base64,${trop}`);
  assert.equal(resultat.statut, 'refus');
  if (resultat.statut !== 'refus') return;
  assert.match(resultat.message, /trop lourde/);
  assert.match(resultat.message, /3\.0 Mo/);
});

// Un base64 recopié depuis un presse-papier arrive parfois coupé en lignes.
// C'est la forme normalisée qui part en base, pas la saisie.
test('les blancs du base64 sont tolérés puis normalisés', () => {
  const resultat = analyserPreuveComptable('data:image/png;base64,iVBOR\nw0KGgo=');
  assert.equal(resultat.statut, 'ok');
  if (resultat.statut !== 'ok') return;
  assert.equal(dataUrlPreuve(resultat.preuve), 'data:image/png;base64,iVBORw0KGgo=');
});

// Un enum de mime élargi sans son extension ferait télécharger « .bin ».
test('chaque format accepté a une extension', () => {
  for (const [mime, extension] of Object.entries(MIMES_PREUVE_COMPTABLE)) {
    assert.ok(extension.length > 0, `extension manquante pour ${mime}`);
    assert.ok(mime.startsWith('image/'), `${mime} n’est pas une image`);
  }
  assert.equal(MIMES_PREUVE_COMPTABLE['image/svg+xml'], undefined);
});

// Le nom part dans un en-tête `Content-Disposition` : un guillemet ou un saut
// de ligne y ouvrirait un second en-tête.
test('le nom de téléchargement ne peut pas injecter d’en-tête', () => {
  const nom = nomFichierPreuve('abc-123"\r\nX-Injecte: 1', 'image/jpeg');
  assert.equal(/["\r\n]/.test(nom), false);
  assert.match(nom, /^justificatif-[a-z0-9-]+\.jpg$/i);
});

// Un identifiant entièrement filtré ne doit pas produire un nom vide.
test('un identifiant illisible garde un nom de fichier utilisable', () => {
  assert.equal(nomFichierPreuve('«»', 'image/png'), 'justificatif-transaction.png');
});
