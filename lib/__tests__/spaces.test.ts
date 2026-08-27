import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_SPACES,
  SESSION_COOKIE_NAMES,
  LEGACY_SESSION_COOKIE_NAMES,
  SPACE_HOSTS,
  racineEnregistrable,
  spaceForHost,
} from '../spaces';

// § Séparation des espaces par domaine (lib/spaces.ts).
//
// Ces tests couvrent le VOLET PUR de l'isolation : la table des hôtes, celle
// des cookies, et le calcul de racine enregistrable qui garde le démarrage en
// production. Ils tournent sans serveur ni base — donc à chaque `npm test`.
//
// Ce qu'ils ne peuvent PAS couvrir, et qui relève de
// scripts/test-isolation-domaines-audit.ts (proxy réel) ou d'une préprod sur
// les vrais domaines (comportement du navigateur) :
//   • le 404 du proxy sur un hôte inconnu ou une page servie au mauvais espace ;
//   • le rejet d'un cookie recopié d'un espace à l'autre (claim `aud`) ;
//   • les attributs Secure / `__Host-` / SameSite, qui dépendent de
//     NODE_ENV=production et du navigateur.

test('trois espaces, trois hôtes distincts', () => {
  assert.deepEqual(SESSION_SPACES, ['admin', 'marchand', 'terrain']);

  const hotes = SESSION_SPACES.map((s) => SPACE_HOSTS[s]);
  assert.equal(new Set(hotes).size, 3, 'deux espaces ne doivent jamais partager un hôte');
});

test('un cookie par espace, aucun nom en commun', () => {
  const noms = SESSION_SPACES.map((s) => SESSION_COOKIE_NAMES[s]);
  assert.equal(new Set(noms).size, 3);
});

// L'ancien cookie du Planner doit rester dans la liste des noms à supprimer :
// un planificateur déjà connecté garderait sinon indéfiniment un cookie posé
// sur un domaine qui ne répond plus.
test('les cookies des découpages précédents restent à nettoyer', () => {
  assert.ok(LEGACY_SESSION_COOKIE_NAMES.includes('pd_session_planner'));
  assert.ok(LEGACY_SESSION_COOKIE_NAMES.includes('pd_session'));

  // Aucun nom courant ne doit figurer dans la liste de nettoyage : hors
  // production le préfixe `__Host-` est vide et les deux listes se
  // recouvrent, d'où le filtrage à la construction.
  for (const s of SESSION_SPACES) {
    assert.ok(
      !LEGACY_SESSION_COOKIE_NAMES.includes(SESSION_COOKIE_NAMES[s]),
      `${SESSION_COOKIE_NAMES[s]} serait supprimé à chaque connexion`
    );
  }
});

test("l'hôte détermine l'espace, et seul un hôte connu en désigne un", () => {
  for (const s of SESSION_SPACES) {
    assert.equal(spaceForHost(SPACE_HOSTS[s]), s);
    assert.equal(spaceForHost(SPACE_HOSTS[s].toUpperCase()), s, 'le Host est insensible à la casse');
  }

  assert.equal(spaceForHost('inconnu.example.com'), null);
  assert.equal(spaceForHost('127.0.0.1:3000'), null, 'un accès direct par IP ne vaut aucun espace');
  assert.equal(spaceForHost(''), null);
  assert.equal(spaceForHost(null), null);
  assert.equal(spaceForHost(undefined), null);
});

// Un hôte d'espace ne doit pas être reconnu à cause d'un préfixe ou d'un
// suffixe : `spaceForHost` compare l'hôte ENTIER, jamais un `endsWith`.
test('un hôte voisin ne se fait pas passer pour un espace', () => {
  const admin = SPACE_HOSTS.admin.split(':')[0];
  assert.equal(spaceForHost(`evil-${admin}:3000`), null);
  assert.equal(spaceForHost(`${admin}.evil.com:3000`), null);
  assert.equal(spaceForHost(`sous.${admin}:3000`), null);
});

test('racineEnregistrable : deux étiquettes par défaut', () => {
  assert.equal(racineEnregistrable('ops-exemple.com'), 'ops-exemple.com');
  assert.equal(racineEnregistrable('www.ops-exemple.com'), 'ops-exemple.com');
  assert.equal(racineEnregistrable('a.b.c.ops-exemple.com'), 'ops-exemple.com');
  assert.equal(racineEnregistrable('OPS-EXEMPLE.COM:443'), 'ops-exemple.com', 'port et casse ignorés');
});

test('racineEnregistrable : trois étiquettes sous un suffixe de second niveau', () => {
  assert.equal(racineEnregistrable('exemple.co.ma'), 'exemple.co.ma');
  assert.equal(racineEnregistrable('boutique.exemple.co.ma'), 'exemple.co.ma');
  assert.equal(racineEnregistrable('exemple.co.uk'), 'exemple.co.uk');
});

// Le cas que le garde-fou de démarrage doit attraper : deux espaces sous une
// même racine sont *same-site*, donc SameSite cesse de les séparer.
test('racineEnregistrable distingue ce qui doit être distingué', () => {
  assert.notEqual(
    racineEnregistrable('exemple-marchands.ma'),
    racineEnregistrable('exemple-livraison.ma'),
    'deux racines achetées séparément'
  );
  assert.equal(
    racineEnregistrable('marchand.exemple.ma'),
    racineEnregistrable('app.exemple.ma'),
    'deux sous-domaines frères : same-site, précisément ce que le garde-fou refuse'
  );
});

// Le développement est la seule entorse assumée au modèle : les trois hôtes y
// sont frères sous `.localhost`, là où la production exige trois racines sans
// parent commun. Ce test EXISTE pour que l'entorse reste visible et
// intentionnelle plutôt que d'être découverte un jour par surprise.
//
// Il documente aussi une limite du garde-fou : `localhost` n'étant pas un
// suffixe reconnu, racineEnregistrable croit voir trois racines distinctes.
// C'est pourquoi l'exemption `.localhost` d'assertSpaceHostsConfigured est
// écrite explicitement au lieu de s'en remettre à ce calcul.
test('les hôtes de développement sont frères sous `.localhost` — entorse connue', () => {
  const enLocal = SESSION_SPACES.filter((s) => SPACE_HOSTS[s].includes('.localhost'));
  if (enLocal.length === 0) return; // hôtes surchargés par l'environnement

  for (const s of enLocal) {
    assert.match(
      SPACE_HOSTS[s],
      /\.localhost(:\d+)?$/,
      "en local l'isolation repose sur le contrôle d'Origin du proxy, pas sur la frontière cross-site"
    );
  }

  const racines = new Set(enLocal.map((s) => racineEnregistrable(SPACE_HOSTS[s])));
  assert.equal(racines.size, enLocal.length, 'limite connue : le calcul ne modélise pas le parent `localhost`');
});
