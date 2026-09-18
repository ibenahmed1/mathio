import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATALOGUE_SCOPES,
  ENTETE_CLE_REPLI,
  FENETRE_DEPRECIATION_MS,
  SCOPES_INTERDITS_EN_TEST,
  SCOPES_PLATEFORME,
  SCOPES_TRANSPORTEUR,
  SCOPES_VENTE,
  analyserCle,
  assainirScopes,
  depreciationImminente,
  extraireCle,
  genererCle,
  hashSecretCle,
  secretCorrespond,
} from '../plateforme-cles';

// ------------------------------------------------------------
// Format des clés
// ------------------------------------------------------------

test('une clé générée se relit elle-même', () => {
  for (const env of ['live', 'test'] as const) {
    const { cleComplete, prefixe, secretHash } = genererCle(env);
    const analysee = analyserCle(cleComplete);

    assert.ok(analysee, `clé ${env} illisible : ${cleComplete}`);
    assert.equal(analysee.environnement, env);
    assert.equal(analysee.prefixe, prefixe);
    assert.ok(secretCorrespond(analysee.secret, secretHash));
  }
});

test('le secret complet n’est jamais reconstituable depuis ce qui est stocké', () => {
  const { cleComplete, prefixe, secretHash } = genererCle('live');
  // Ce qui part en base, c'est le préfixe et le hash. Ni l'un ni l'autre ne
  // doit contenir le secret : c'est toute la raison pour laquelle la clé
  // complète n'est affichée qu'une fois.
  const secret = analyserCle(cleComplete)!.secret;
  assert.ok(!prefixe.includes(secret));
  assert.ok(!secretHash.includes(secret));
});

test('deux clés successives ne partagent ni préfixe ni secret', () => {
  const a = genererCle('live');
  const b = genererCle('live');
  assert.notEqual(a.prefixe, b.prefixe);
  assert.notEqual(a.secretHash, b.secretHash);
});

test('le préfixe est stable en longueur : c’est la clé de lookup', () => {
  // Le lookup se fait par `prefixe` (colonne UNIQUE indexée). Une longueur
  // variable passerait inaperçue ici et se paierait en index inutilisable.
  for (let i = 0; i < 20; i++) {
    assert.match(genererCle('test').prefixe, /^[0-9a-f]{8}$/);
  }
});

test('une clé malformée est refusée plutôt qu’interprétée', () => {
  const refusees = [
    '',
    '   ',
    'mtk_live_court_abc',
    // Bon format, mauvais marqueur produit.
    'xxx_live_a7f3c19e_' + 'a'.repeat(43),
    // Environnement inconnu : ni live ni test.
    'mtk_prod_a7f3c19e_' + 'a'.repeat(43),
    // Préfixe hors alphabet hexadécimal.
    'mtk_live_ZZZZZZZZ_' + 'a'.repeat(43),
    // Secret tronqué d'un caractère.
    'mtk_live_a7f3c19e_' + 'a'.repeat(42),
    // Le secret est en base64url : une espace n'y a pas sa place.
    'mtk_live_a7f3c19e_' + 'a'.repeat(42) + ' ',
  ];
  for (const brut of refusees) {
    assert.equal(analyserCle(brut), null, `aurait dû être refusée : « ${brut} »`);
  }
});

test('les espaces autour d’une clé sont tolérés', () => {
  // Une clé copiée-collée depuis un email ou un ticket traîne souvent une
  // espace ou un retour à la ligne : la refuser pour ça enverrait
  // l'intégrateur chercher un problème d'authentification inexistant.
  const { cleComplete, prefixe } = genererCle('live');
  assert.equal(analyserCle(`  ${cleComplete}\n`)?.prefixe, prefixe);
});

test('le secret peut contenir les caractères propres à base64url', () => {
  // `-` et `_` appartiennent à l'alphabet base64url, et `_` est aussi le
  // séparateur du format : découper la clé sur `_` serait donc faux. Ce test
  // fige la règle, parce que le bug ne se manifesterait qu'une fois sur
  // quelques dizaines de clés générées.
  const secret = '-_'.padEnd(43, 'a');
  const analysee = analyserCle(`mtk_test_00ff11ee_${secret}`);
  assert.equal(analysee?.secret, secret);
});

// ------------------------------------------------------------
// Vérification du secret
// ------------------------------------------------------------

test('un secret faux ne passe jamais, même d’un seul caractère', () => {
  const { cleComplete, secretHash } = genererCle('live');
  const secret = analyserCle(cleComplete)!.secret;
  const altere = (secret[0] === 'a' ? 'b' : 'a') + secret.slice(1);

  assert.ok(secretCorrespond(secret, secretHash));
  assert.ok(!secretCorrespond(altere, secretHash));
});

test('un hash mal formé en base renvoie false au lieu de lever', () => {
  // timingSafeEqual LÈVE quand les deux buffers n'ont pas la même taille. Un
  // hash tronqué (migration à la main, colonne éditée) ferait donc un 500 au
  // lieu d'un 401 — c'est-à-dire une panne au lieu d'un refus.
  const { cleComplete } = genererCle('live');
  const secret = analyserCle(cleComplete)!.secret;

  assert.equal(secretCorrespond(secret, ''), false);
  assert.equal(secretCorrespond(secret, 'abcd'), false);
  assert.equal(secretCorrespond(secret, 'pas du tout hexadécimal'), false);
});

test('le hash d’un secret est stable et ne dépend que de lui', () => {
  assert.equal(hashSecretCle('abc'), hashSecretCle('abc'));
  assert.notEqual(hashSecretCle('abc'), hashSecretCle('abd'));
  assert.match(hashSecretCle('abc'), /^[0-9a-f]{64}$/);
});

// ------------------------------------------------------------
// Scopes
// ------------------------------------------------------------

test('assainirScopes ne garde que les clés du catalogue', () => {
  assert.deepEqual(assainirScopes(['colis:creation', 'colis:suppression']), ['colis:creation']);
  assert.deepEqual(assainirScopes([]), []);
  // Une valeur retirée du catalogue n'accorde plus rien, même si elle traîne
  // encore en base : c'est la règle qui rend un retrait effectif sans
  // migration de données.
  assert.deepEqual(assainirScopes(['scope:disparu']), []);
});

test('assainirScopes déduplique et survit à n’importe quelle entrée', () => {
  assert.deepEqual(assainirScopes(['colis:creation', 'colis:creation']), ['colis:creation']);
  for (const entree of [null, undefined, 'colis:creation', 42, {}]) {
    assert.deepEqual(assainirScopes(entree), [], `entrée non tableau : ${String(entree)}`);
  }
  assert.deepEqual(assainirScopes([null, 3, {}, 'colis:creation']), ['colis:creation']);
});

test('chaque scope du catalogue porte un libellé', () => {
  assert.ok(SCOPES_PLATEFORME.length > 0);
  for (const scope of SCOPES_PLATEFORME) {
    assert.ok(CATALOGUE_SCOPES[scope]?.length > 0, `libellé manquant : ${scope}`);
  }
});

test('créer un marchand et créer un marchand VALIDÉ sont deux scopes distincts', () => {
  // La séparation est le pivot du bac à sable : une clé de test peut créer un
  // marchand (il reste en attente d'approbation, RF-22 est respecté), mais
  // jamais un marchand actif. Les fusionner rendrait soit le bac à sable
  // inutile — il ne pourrait pas exercer la synchronisation du tout — soit
  // dangereux, en laissant une clé de test ouvrir des comptes actifs.
  assert.ok(SCOPES_PLATEFORME.includes('marchands:creation'));
  assert.ok(SCOPES_PLATEFORME.includes('marchands:creation_validee'));
  assert.ok(SCOPES_PLATEFORME.includes('colis:creation'));

  // Et ils ne se recouvrent pas : détenir l'un n'accorde pas l'autre. C'est
  // `exigeUnScopeParmi` qui choisit lequel s'applique, jamais un préfixe
  // commun interprété comme une hiérarchie.
  assert.equal(new Set(SCOPES_PLATEFORME).size, SCOPES_PLATEFORME.length);
});

// ------------------------------------------------------------
// Extraction de l'en-tête
// ------------------------------------------------------------

test('la clé se lit dans Authorization: Bearer, quelle que soit la casse', () => {
  assert.equal(extraireCle(new Headers({ authorization: 'Bearer abc' })), 'abc');
  assert.equal(extraireCle(new Headers({ authorization: 'bearer abc' })), 'abc');
  assert.equal(extraireCle(new Headers({ authorization: 'BEARER   abc  ' })), 'abc');
});

test('l’en-tête de repli sert quand Authorization est absent', () => {
  // Repli toléré et NON documenté, pour les clients dont le proxy d'entreprise
  // réécrit `Authorization`.
  assert.equal(extraireCle(new Headers({ [ENTETE_CLE_REPLI]: 'abc' })), 'abc');
  // Authorization garde la priorité quand les deux sont là.
  const deux = new Headers({ authorization: 'Bearer vrai', [ENTETE_CLE_REPLI]: 'autre' });
  assert.equal(extraireCle(deux), 'vrai');
});

test('un schéma d’autorisation étranger ne vaut pas une clé', () => {
  assert.equal(extraireCle(new Headers({ authorization: 'Basic YWJjOmRlZg==' })), null);
  assert.equal(extraireCle(new Headers()), null);
  assert.equal(extraireCle(new Headers({ authorization: 'Bearer' })), null);
  assert.equal(extraireCle(new Headers({ [ENTETE_CLE_REPLI]: '   ' })), null);
});

// ------------------------------------------------------------
// Dépréciation
// ------------------------------------------------------------

test('la dépréciation ne s’annonce que dans la fenêtre de grâce', () => {
  const maintenant = new Date('2026-09-02T10:00:00Z');
  const dans = (ms: number) => new Date(maintenant.getTime() + ms);

  // Une clé sans échéance ne se déprécie jamais.
  assert.equal(depreciationImminente(null, maintenant), false);
  // Trop loin : rien à annoncer, l'annoncer trop tôt banalise l'avertissement.
  assert.equal(depreciationImminente(dans(FENETRE_DEPRECIATION_MS + 1000), maintenant), false);
  // Dans la fenêtre.
  assert.equal(depreciationImminente(dans(FENETRE_DEPRECIATION_MS - 1000), maintenant), true);
  assert.equal(depreciationImminente(dans(60_000), maintenant), true);
  // Déjà expirée : ce n'est plus une dépréciation, c'est un refus — et c'est
  // `requirePlateforme` qui le prononce.
  assert.equal(depreciationImminente(dans(-1000), maintenant), false);
  assert.equal(depreciationImminente(maintenant, maintenant), false);
});

// ------------------------------------------------------------
// Partition vente / transporteur
// ------------------------------------------------------------

test('les deux natures de compte partitionnent le catalogue, sans trou ni recouvrement', () => {
  // C'est cette partition que `creerCleApi` applique dans les deux sens. Un
  // scope qui tomberait dans les deux ensembles serait accordable partout ;
  // un scope qui ne serait dans aucun ne serait accordable nulle part, et
  // l'écran l'afficherait sans qu'aucune case ne puisse le cocher.
  const recouvrement = SCOPES_TRANSPORTEUR.filter((s) => SCOPES_VENTE.includes(s));
  assert.deepEqual(recouvrement, []);

  assert.deepEqual(
    [...SCOPES_TRANSPORTEUR, ...SCOPES_VENTE].sort(),
    [...SCOPES_PLATEFORME].sort()
  );
});

test('tout scope de transporteur existe bien au catalogue', () => {
  // Sans ce contrôle, une faute de frappe dans SCOPES_TRANSPORTEUR le sortirait
  // silencieusement de la partition : le scope basculerait côté vente, et une
  // clé de canal de vente pourrait le recevoir.
  for (const scope of SCOPES_TRANSPORTEUR) {
    assert.ok(CATALOGUE_SCOPES[scope]?.length > 0, `scope hors catalogue : ${scope}`);
  }
});

// ------------------------------------------------------------
// Ce qu'une clé de bac à sable ne peut pas recevoir
// ------------------------------------------------------------

test('les scopes interdits en test existent au catalogue', () => {
  // Une faute de frappe ici serait silencieuse : le scope sortirait de la
  // liste des interdits, et une clé de test pourrait le recevoir.
  for (const scope of SCOPES_INTERDITS_EN_TEST) {
    assert.ok(CATALOGUE_SCOPES[scope]?.length > 0, `scope hors catalogue : ${scope}`);
  }
});

test('les deux écritures irréversibles sont fermées au bac à sable', () => {
  // `marchands:creation_validee` court-circuite l'approbation d'un admin.
  // `livraisons:statut` mute des colis RÉELS : rien à marquer ni à purger
  // derrière, contrairement aux marchands créés en test. Deux raisons
  // différentes, une même conséquence.
  assert.ok(SCOPES_INTERDITS_EN_TEST.includes('marchands:creation_validee'));
  assert.ok(SCOPES_INTERDITS_EN_TEST.includes('livraisons:statut'));
});

test('le dépôt de colis reste ouvert au bac à sable', () => {
  // Le contre-exemple qui donne son sens à la règle : déposer un colis en test
  // crée un artefact marqué et purgeable, donc réversible.
  assert.ok(!SCOPES_INTERDITS_EN_TEST.includes('colis:creation'));
});
