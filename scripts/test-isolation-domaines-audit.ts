import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { attendreServeur, creerClient } from './audit-http';
import { SESSION_COOKIE_NAMES, SPACE_HOSTS, racineEnregistrable, type SessionSpace } from '../lib/spaces';

// Audit de la SÉPARATION DES TROIS DOMAINES, exécutable via
//   npx tsx scripts/test-isolation-domaines-audit.ts
// avec un serveur de développement en cours (npm run dev).
//
// Il ne teste pas une fonctionnalité mais une FRONTIÈRE : que l'espace d'une
// requête découle du seul `Host`, qu'une session ne franchisse jamais cette
// frontière, et qu'aucun espace ne réponde pour un autre. Ces propriétés ne se
// voient pas à l'usage — tout continue de « marcher » quand elles tombent,
// c'est précisément ce qui les rend dangereuses à laisser sans test.
//
// Six volets :
//   1. Frontière d'hôte — un hôte inconnu, ou les pages d'un autre espace,
//      n'obtiennent rien, et sans même qu'un cookie soit lu.
//   2. Surface publique — les rares routes ouvertes sans session ne le sont
//      que sur les hôtes où elles ont un sens.
//   3. Contrôle d'origine — une écriture annoncée depuis un autre espace est
//      refusée (proxy.ts §2).
//   4. Connexion — un compte ne peut ouvrir de session que sur SON domaine, et
//      le back-office ne se laisse jamais deviner depuis un domaine public.
//   5. Cookies — un nom et des attributs par espace, et nettoyage des cookies
//      des découpages précédents.
//   6. Rejeu inter-espaces — LE test central : un cookie valide, recopié sur
//      l'hôte d'un autre espace et même renommé, reste refusé (claim `aud`).
//
// Ce que cet audit NE PEUT PAS couvrir en développement est listé en fin
// d'exécution : ces points-là demandent une préprod sur les vrais domaines.
//
// ------------------------------------------------------------
// Auditer un serveur de PRODUCTION lancé en local
// ------------------------------------------------------------
// Seul moyen d'exercer le préfixe `__Host-` et l'attribut `Secure`, inactifs
// hors production. Arrêter d'abord `npm run dev` (un build par-dessus corrompt
// `.next`), puis, avec les MÊMES variables aux trois étapes :
//
//   H="NEXT_PUBLIC_HOST_ADMIN=admin.localhost:3000 \
//      NEXT_PUBLIC_HOST_MARCHAND=marchand.localhost:3000 \
//      NEXT_PUBLIC_HOST_TERRAIN=app.localhost:3000"
//   env $H PARCEL_SERIAL_SALT_KEY=... npm run build
//   env $H PARCEL_SERIAL_SALT_KEY=... npm start
//   env $H NODE_ENV=production npx tsx scripts/test-isolation-domaines-audit.ts
//
// Les NEXT_PUBLIC_* sont figées à la COMPILATION : les changer au démarrage
// seul ne produit rien. Et le script doit partager le NODE_ENV du serveur,
// faute de quoi il cherche des cookies sans préfixe (cf. EN_PRODUCTION).
//
// Piège à connaître : en production, `originForHost` annonce TOUJOURS `https`.
// Un serveur servi en clair sur :3000 attend donc `Origin: https://…` et
// renvoie 307 vers `https://…`. Un NAVIGATEUR, lui, enverrait `http://…` :
// il se prend un 403 « Origine non autorisée » dès la connexion, et suit des
// redirections vers un port sans TLS. Autrement dit, ce mode s'audite au
// client forgé — pas au navigateur, qui exige un vrai terminaison TLS devant.
//
// Les trois comptes créés sont préfixés et supprimés en fin d'exécution,
// succès ou échec.

// Le mode du SCRIPT doit refléter celui du SERVEUR : les noms de cookies en
// dépendent (préfixe `__Host-` en production). Auditer un serveur de
// production avec un script en mode développement ferait chercher
// `pd_session_admin` là où la réponse porte `__Host-pd_session_admin` — des
// échecs partout, pour une raison sans rapport avec l'isolation.
const EN_PRODUCTION = process.env.NODE_ENV === 'production';

const MOT_DE_PASSE = 'Audit1234!';
const SUFFIXE = '@mathio.test';
const COMPTES = {
  admin: `admin.audit.isolation${SUFFIXE}`,
  marchand: `marchand.audit.isolation${SUFFIXE}`,
  terrain: `livreur.audit.isolation${SUFFIXE}`,
} as const;

let reussis = 0;
let echoues = 0;
let limiteAtteinte = false;

function ok(label: string) {
  reussis++;
  console.log(`  OK   ${label}`);
}

function ko(label: string, err: unknown) {
  echoues++;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`  KO   ${label} — ${message}`);
}

async function verifie(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    ko(label, err);
  }
}

function attendu(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Les trois clients : un par espace, chacun avec son propre bocal à cookies et
// son propre `Host` annoncé. C'est le dispositif qui rend l'audit possible —
// cf. l'en-tête de audit-http.ts pour la raison du node:http brut.
const clients: Record<SessionSpace, ReturnType<typeof creerClient>> = {
  admin: creerClient('admin'),
  marchand: creerClient('marchand'),
  terrain: creerClient('terrain'),
};

const ESPACES: SessionSpace[] = ['admin', 'marchand', 'terrain'];

// Le 404 du proxy (hôte ou espace refusé) a un corps VIDE ; celui du routeur
// Next, quand la route n'existe pas, ramène une page HTML de plusieurs Ko.
// Confondre les deux fait chercher un bug de code là où il y a un refus voulu
// — ou l'inverse.
function estRefusProxy(r: { status: number; texte: string }): boolean {
  return r.status === 404 && r.texte.length === 0;
}

async function seed() {
  const motDePasseHash = await bcrypt.hash(MOT_DE_PASSE, 10);

  await prisma.utilisateur.upsert({
    where: { email: COMPTES.admin },
    update: { role: 'admin', actif: true, motDePasseHash },
    create: { nomComplet: 'Admin Audit Isolation', email: COMPTES.admin, motDePasseHash, role: 'admin' },
  });

  // Compte marchand SANS boutique rattachée : la connexion ne regarde que
  // `Utilisateur`, et cet audit n'ouvre jamais une page /marchand — il vérifie
  // des frontières, pas le portail.
  await prisma.utilisateur.upsert({
    where: { email: COMPTES.marchand },
    update: { role: 'marchand', actif: true, motDePasseHash },
    create: { nomComplet: 'Marchand Audit Isolation', email: COMPTES.marchand, motDePasseHash, role: 'marchand' },
  });

  await prisma.utilisateur.upsert({
    where: { email: COMPTES.terrain },
    update: { role: 'livreur', actif: true, motDePasseHash },
    create: { nomComplet: 'Livreur Audit Isolation', email: COMPTES.terrain, motDePasseHash, role: 'livreur' },
  });
}

async function nettoyer() {
  await prisma.utilisateur.deleteMany({ where: { email: { in: Object.values(COMPTES) } } });
}

// Une connexion, en distinguant le refus MÉTIER du quota anti-bruteforce
// (5/minute/IP/espace, cf. app/api/auth/login) : deux exécutions rapprochées
// de cet audit toucheraient sinon la limite et rapporteraient des échecs qui
// n'en sont pas.
async function connexion(espace: SessionSpace, email: string, options?: { ignorerCookies?: boolean }) {
  const r = await clients[espace].api(
    'POST',
    '/api/auth/login',
    { telephone: email, secret: MOT_DE_PASSE },
    { ignorerCookies: options?.ignorerCookies }
  );
  if (r.status === 429) {
    limiteAtteinte = true;
    throw new Error('quota de connexion atteint (5/min/IP/espace) — relancer dans une minute');
  }
  return r;
}

async function main() {
  await attendreServeur();
  await seed();

  console.log('\nIsolation des trois domaines');
  console.log(`  admin    ${SPACE_HOSTS.admin}`);
  console.log(`  marchand ${SPACE_HOSTS.marchand}`);
  console.log(`  terrain  ${SPACE_HOSTS.terrain}\n`);

  // --- 1. Frontière d'hôte ---------------------------------------------------
  console.log('1. Frontière d\'hôte');

  await verifie('un hôte inconnu n\'obtient rien (404 sans corps)', async () => {
    // Accès direct par IP, ancien domaine encore pointé, sondage automatisé
    // sur un vhost non prévu : aucun ne doit rien obtenir.
    for (const host of ['127.0.0.1:3000', 'exemple-inconnu.com', `evil-${SPACE_HOSTS.admin}`]) {
      const r = await clients.admin.api('GET', '/login', undefined, { host, origin: null });
      attendu(estRefusProxy(r), `Host: ${host} : attendu 404 vide, reçu ${r.status} (${r.texte.length} o)`);
    }

    // Contrôle positif : sans lui, ce test passerait aussi avec un serveur
    // qui répondrait 404 à tout.
    const direct = await clients.admin.api('GET', '/login', undefined, { origin: null });
    attendu(direct.status === 200, `/login doit répondre 200 sur un hôte connu, reçu ${direct.status}`);
  });

  await verifie('les pages d\'un espace n\'existent que sur son hôte', async () => {
    const croisements: [SessionSpace, string][] = [
      ['marchand', '/admin/commandes'],
      ['terrain', '/admin/commandes'],
      ['admin', '/marchand/colis'],
      ['terrain', '/marchand/colis'],
      ['admin', '/livreur'],
      ['marchand', '/ramasseur'],
    ];
    for (const [espace, chemin] of croisements) {
      const r = await clients[espace].api('GET', chemin);
      attendu(
        estRefusProxy(r),
        `${chemin} sur ${SPACE_HOSTS[espace]} : attendu 404 vide, reçu ${r.status} (${r.texte.length} o)`
      );
    }
  });

  await verifie('le refus précède la lecture du cookie (404, pas 401 ni redirection)', async () => {
    // Un cookie quelconque ne change rien : l'hôte tranche AVANT.
    const r = await clients.marchand.api('GET', '/admin/commandes', undefined, {
      cookie: `${SESSION_COOKIE_NAMES.admin}=peu-importe`,
    });
    attendu(estRefusProxy(r), `attendu 404 vide, reçu ${r.status}`);
  });

  await verifie('l\'ancienne web app Planner a disparu du routage', async () => {
    const r = await clients.admin.api('GET', '/planner');
    attendu(r.status === 404, `attendu 404, reçu ${r.status}`);
    attendu(
      r.texte.length > 0,
      'un 404 à corps vide viendrait du proxy, pas du routeur : la route existerait encore'
    );
  });

  // --- 2. Surface publique par espace ---------------------------------------
  console.log('\n2. Surface publique');

  await verifie('/api/marchands/inscription n\'est ouvert que côté marchand', async () => {
    for (const espace of ['admin', 'terrain'] as SessionSpace[]) {
      const r = await clients[espace].api('POST', '/api/marchands/inscription', {});
      attendu(estRefusProxy(r), `ouvert sur ${SPACE_HOSTS[espace]} : ${r.status}`);
    }
    const r = await clients.marchand.api('POST', '/api/marchands/inscription', {});
    attendu(!estRefusProxy(r), 'doit rester atteignable sur le domaine marchand');
  });

  await verifie('/api/session-handoff/consume n\'est ouvert que côté marchand', async () => {
    for (const espace of ['admin', 'terrain'] as SessionSpace[]) {
      const r = await clients[espace].api('GET', '/api/session-handoff/consume?t=x');
      attendu(estRefusProxy(r), `ouvert sur ${SPACE_HOSTS[espace]} : ${r.status}`);
    }
  });

  await verifie('une route API protégée répond 401, jamais 404', async () => {
    // Contrôle positif du volet 1 : si le proxy renvoyait 404 partout, tous
    // les tests ci-dessus passeraient pour de mauvaises raisons.
    for (const espace of ESPACES) {
      const r = await clients[espace].api('GET', '/api/auth/me');
      attendu(r.status === 401, `${SPACE_HOSTS[espace]} : attendu 401, reçu ${r.status}`);
    }
  });

  // --- 3. Contrôle d'origine (CSRF) ------------------------------------------
  console.log('\n3. Contrôle d\'origine');

  await verifie('une écriture annoncée depuis un autre espace est refusée', async () => {
    for (const [cible, usurpe] of [
      ['admin', 'marchand'],
      ['marchand', 'terrain'],
      ['terrain', 'admin'],
    ] as [SessionSpace, SessionSpace][]) {
      const r = await clients[cible].api(
        'POST',
        '/api/auth/login',
        { telephone: 'x', secret: 'y' },
        { origin: `http://${SPACE_HOSTS[usurpe]}`, ignorerCookies: true }
      );
      attendu(r.status === 403, `${usurpe} -> ${cible} : attendu 403, reçu ${r.status}`);
      attendu(
        String(r.json?.error ?? '').includes('Origine'),
        `message inattendu : ${JSON.stringify(r.json)}`
      );
    }
  });

  await verifie('une écriture sans en-tête Origin est refusée', async () => {
    const r = await clients.admin.api(
      'POST',
      '/api/auth/login',
      { telephone: 'x', secret: 'y' },
      { origin: null, ignorerCookies: true }
    );
    attendu(r.status === 403, `attendu 403, reçu ${r.status}`);
  });

  await verifie('une LECTURE cross-origin reste permise (rien à protéger)', async () => {
    const r = await clients.admin.api('GET', '/login', undefined, {
      origin: `http://${SPACE_HOSTS.marchand}`,
    });
    attendu(r.status === 200, `attendu 200, reçu ${r.status}`);
  });

  // --- 4. Connexion : chaque compte sur son domaine --------------------------
  console.log('\n4. Connexion');

  await verifie('un compte back-office ne se trahit pas depuis un domaine public', async () => {
    for (const espace of ['marchand', 'terrain'] as SessionSpace[]) {
      const r = await connexion(espace, COMPTES.admin, { ignorerCookies: true });
      attendu(r.status === 401, `${SPACE_HOSTS[espace]} : attendu 401 générique, reçu ${r.status}`);
      attendu(
        !JSON.stringify(r.json).includes(SPACE_HOSTS.admin),
        "la réponse ne doit jamais nommer le domaine du back-office"
      );
      attendu(r.json?.redirectTo === undefined, 'aucune redirection ne doit être proposée');
    }
  });

  await verifie('un compte public saisi sur le mauvais domaine public est ORIENTÉ', async () => {
    // Ici l'utilisateur s'est authentifié avec succès : lui indiquer son
    // domaine ne lui apprend rien qu'il ne sache, et sans ça il reste bloqué.
    const r = await connexion('marchand', COMPTES.terrain, { ignorerCookies: true });
    attendu(r.status === 403, `attendu 403, reçu ${r.status}`);
    attendu(
      String(r.json?.redirectTo ?? '').includes(SPACE_HOSTS.terrain),
      `redirectTo attendu vers ${SPACE_HOSTS.terrain}, reçu ${JSON.stringify(r.json?.redirectTo)}`
    );
  });

  await verifie('un compte public ne s\'ouvre pas sur le back-office', async () => {
    const r = await connexion('admin', COMPTES.marchand, { ignorerCookies: true });
    attendu(r.status === 401, `attendu 401 générique, reçu ${r.status}`);
    attendu(r.json?.redirectTo === undefined, 'le back-office ne redirige jamais ailleurs');
  });

  // --- 5. Cookies : un par espace, attributs attendus ------------------------
  console.log('\n5. Cookies');

  const sessions: Partial<Record<SessionSpace, string>> = {};
  // UNE connexion par espace, dont les trois contrôles ci-dessous se
  // partagent la réponse : le quota anti-bruteforce (5/min/IP/espace) doit
  // laisser de la marge pour rejouer l'audit sans attendre.
  const connexions: Partial<Record<SessionSpace, Awaited<ReturnType<typeof connexion>>>> = {};

  await verifie('chaque espace pose SON cookie, et lui seul', async () => {
    for (const espace of ESPACES) {
      const r = await connexion(espace, COMPTES[espace]);
      connexions[espace] = r;
      attendu(r.status === 200, `${SPACE_HOSTS[espace]} : connexion refusée (${r.status})`);

      const attendus = r.setCookie.filter((c) => c.startsWith(`${SESSION_COOKIE_NAMES[espace]}=`));
      attendu(attendus.length === 1, `cookie de session absent sur ${SPACE_HOSTS[espace]}`);

      // Aucun cookie d'un AUTRE espace ne doit être posé au passage.
      for (const autre of ESPACES.filter((e) => e !== espace)) {
        attendu(
          !r.setCookie.some((c) => c.startsWith(`${SESSION_COOKIE_NAMES[autre]}=`)),
          `${SPACE_HOSTS[espace]} pose le cookie de ${autre}`
        );
      }

      const valeur = clients[espace].cookie(SESSION_COOKIE_NAMES[espace]);
      attendu(Boolean(valeur), 'valeur de cookie illisible');
      sessions[espace] = valeur;
    }
  });

  await verifie('attributs du cookie : HttpOnly, Path=/, SameSite par espace', async () => {
    for (const espace of ESPACES) {
      const brut = connexions[espace]?.setCookie.find((c) =>
        c.startsWith(`${SESSION_COOKIE_NAMES[espace]}=`)
      );
      attendu(Boolean(brut), `${espace} : pas de cookie à inspecter`);
      attendu(/HttpOnly/i.test(brut!), `${espace} : HttpOnly manquant`);
      attendu(/Path=\//i.test(brut!), `${espace} : Path=/ manquant`);

      // Le back-office n'a jamais besoin d'être atteint depuis un lien
      // externe ; le marchand et le terrain, si (email, SMS).
      const attendue = espace === 'admin' ? 'strict' : 'lax';
      attendu(
        new RegExp(`SameSite=${attendue}`, 'i').test(brut!),
        `${espace} : SameSite=${attendue} attendu, reçu « ${brut} »`
      );
    }
  });

  // Le préfixe `__Host-` et l'attribut `Secure` ne s'activent qu'en
  // production (cf. lib/spaces.ts). Ce contrôle a donc DEUX faces plutôt
  // qu'un saut : en production il exige les deux, en développement il exige
  // leur ABSENCE — sinon les cookies seraient refusés par le navigateur sur
  // un serveur local en clair, et on chercherait longtemps pourquoi la
  // connexion ne « prend » pas.
  await verifie(
    EN_PRODUCTION
      ? 'production : préfixe __Host- et attribut Secure exigés'
      : 'développement : ni préfixe __Host- ni Secure (serveur en clair)',
    async () => {
      for (const espace of ESPACES) {
        const nom = SESSION_COOKIE_NAMES[espace];
        const brut = connexions[espace]?.setCookie.find((c) => c.startsWith(`${nom}=`));
        attendu(Boolean(brut), `${espace} : pas de cookie à inspecter`);

        if (EN_PRODUCTION) {
          attendu(nom.startsWith('__Host-'), `${espace} : préfixe __Host- absent du nom « ${nom} »`);
          attendu(/;\s*Secure/i.test(brut!), `${espace} : attribut Secure manquant`);
          // `__Host-` impose Path=/ ET l'absence de Domain : un navigateur
          // REFUSE le cookie autrement, et la session ne s'ouvrirait jamais.
          attendu(!/;\s*Domain=/i.test(brut!), `${espace} : Domain interdit sous le préfixe __Host-`);
        } else {
          attendu(!nom.startsWith('__Host-'), `${espace} : préfixe __Host- inattendu hors production`);
          attendu(!/;\s*Secure/i.test(brut!), `${espace} : Secure inattendu sur un serveur en clair`);
        }
      }
    }
  );

  await verifie('les cookies des découpages précédents sont supprimés', async () => {
    const suppression = connexions.admin?.setCookie.find((c) => c.startsWith('pd_session_planner='));
    attendu(Boolean(suppression), 'le cookie de l\'ancien espace Planner n\'est pas nettoyé');
    attendu(
      /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(suppression!),
      `attendu une suppression, reçu « ${suppression} »`
    );
  });

  // --- 6. Rejeu d'une session sur l'hôte d'un autre espace -------------------
  console.log('\n6. Rejeu inter-espaces');

  await verifie('contrôle positif : chaque session vaut sur SON hôte', async () => {
    for (const espace of ESPACES) {
      const r = await clients[espace].api('GET', '/api/auth/me', undefined, {
        cookie: `${SESSION_COOKIE_NAMES[espace]}=${sessions[espace]}`,
      });
      attendu(r.status === 200, `${SPACE_HOSTS[espace]} : session refusée chez elle (${r.status})`);
    }
  });

  await verifie('une session recopiée telle quelle sur un autre hôte est ignorée', async () => {
    for (const source of ESPACES) {
      for (const cible of ESPACES.filter((e) => e !== source)) {
        const r = await clients[cible].api('GET', '/api/auth/me', undefined, {
          cookie: `${SESSION_COOKIE_NAMES[source]}=${sessions[source]}`,
        });
        attendu(r.status === 401, `${source} -> ${cible} : attendu 401, reçu ${r.status}`);
      }
    }
  });

  await verifie('une session RENOMMÉE au cookie de l\'hôte cible est rejetée (claim `aud`)', async () => {
    // Le test central. Le cloisonnement par NOM de cookie ne suffirait pas :
    // un attaquant qui contrôle le navigateur renomme le cookie. Ce qui tient,
    // c'est que l'espace est scellé dans le claim `aud` du JWT — la signature
    // est vérifiée CONTRE l'espace déduit du Host.
    for (const source of ESPACES) {
      for (const cible of ESPACES.filter((e) => e !== source)) {
        const r = await clients[cible].api('GET', '/api/auth/me', undefined, {
          cookie: `${SESSION_COOKIE_NAMES[cible]}=${sessions[source]}`,
        });
        attendu(
          r.status === 401,
          `jeton ${source} accepté sur ${SPACE_HOSTS[cible]} sous le nom local (${r.status})`
        );
      }
    }
  });

  await verifie('une page gardée renvoie au /login de SON domaine, pas d\'un autre', async () => {
    const r = await clients.marchand.api('GET', '/marchand', undefined, {
      cookie: `${SESSION_COOKIE_NAMES.marchand}=${sessions.admin}`,
    });
    attendu(r.status === 307, `attendu une redirection, reçu ${r.status}`);
    attendu(
      (r.location ?? '').includes(SPACE_HOSTS.marchand),
      `redirection hors du domaine marchand : ${r.location}`
    );
  });

  // --- État des racines, et ce qui reste hors de portée d'un audit local -----
  //
  // Ce volet ne compte pas dans le score : il RAPPORTE la configuration au
  // lieu de la juger. Sur un poste de développement, les hôtes ne sont pas
  // ceux de la production (surcharges d'environnement, tunnel ngrok pour
  // tester au téléphone) — échouer là-dessus reviendrait à crier au loup à
  // chaque session de travail. Le vrai verdict est rendu au démarrage en
  // production par assertSpaceHostsConfigured(), qui refuse de servir si deux
  // espaces partagent une racine.
  console.log('\nRacines enregistrables des hôtes configurés :');
  for (const espace of ESPACES) {
    console.log(`  ${espace.padEnd(9)} ${SPACE_HOSTS[espace].padEnd(42)} → ${racineEnregistrable(SPACE_HOSTS[espace])}`);
  }

  const parRacine = new Map<string, SessionSpace[]>();
  for (const espace of ESPACES) {
    const racine = racineEnregistrable(SPACE_HOSTS[espace]);
    parRacine.set(racine, [...(parRacine.get(racine) ?? []), espace]);
  }
  const partagees = [...parRacine].filter(([, espaces]) => espaces.length > 1);
  const freresLocaux = ESPACES.filter((e) => SPACE_HOSTS[e].includes('.localhost'));

  if (partagees.length > 0) {
    for (const [racine, espaces] of partagees) {
      console.log(`  ⚠ ${espaces.join(' et ')} partagent « ${racine} » : same-site, donc non isolés.`);
    }
    console.log('    Acceptable en développement ; en production le démarrage échouerait.');
  } else {
    console.log('  ✓ aucune racine partagée dans cette configuration.');
  }
  if (freresLocaux.length > 1) {
    console.log(
      `  ⚠ ${freresLocaux.join(', ')} sont frères sous .localhost : ici l'isolation tient au`
    );
    console.log("    contrôle d'Origin, pas à la frontière cross-site (entorse connue, cf. lib/spaces.ts).");
  }

  console.log('\nNon couvert ici — demande une préprod sur les vrais domaines :');
  if (EN_PRODUCTION) {
    console.log('  • rien de plus côté cookies : ce serveur tourne en production,');
    console.log('    le préfixe __Host- et Secure viennent d\'être exercés (voir ci-dessous).');
  } else {
    console.log('  • préfixe __Host- et attribut Secure : inactifs hors production.');
    console.log('    Les exercer : `npm run build` puis `npm start`, et rejouer ce script');
    console.log('    avec NODE_ENV=production et les mêmes NEXT_PUBLIC_HOST_*.');
  }
  console.log("  • comportement réel de SameSite : c'est le navigateur qui l'applique,");
  console.log('    aucun client HTTP ne le reproduit.');
  console.log("  • filtrage IP/VPN du domaine ops : affaire d'infrastructure, hors app.");
  console.log('  • certificat TLS par domaine.');

  if (EN_PRODUCTION) {
    console.log('\nCookies réellement posés :');
    for (const espace of ESPACES) {
      const brut = connexions[espace]?.setCookie.find((c) =>
        c.startsWith(`${SESSION_COOKIE_NAMES[espace]}=`)
      );
      // Valeur remplacée : c'est un jeton de session encore valide, il n'a
      // rien à faire dans un journal de console ni dans une capture d'écran.
      console.log(`  ${(brut ?? '—').replace(/=[^;]+/, '=<jeton>')}`);
    }
  }
}

main()
  .catch((err) => {
    echoues++;
    console.error('\nInterrompu :', err instanceof Error ? err.message : err);
  })
  .finally(async () => {
    await nettoyer().catch(() => {});
    await prisma.$disconnect();
    console.log(`\n${reussis} OK, ${echoues} KO`);
    if (limiteAtteinte) {
      console.log('Quota de connexion touché : relancer dans une minute pour un verdict propre.');
    }
    process.exit(echoues > 0 ? 1 : 0);
  });
