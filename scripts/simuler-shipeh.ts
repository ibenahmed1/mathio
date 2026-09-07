import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { HOST_API } from '../lib/spaces';
import { genererCle } from '../lib/plateforme-cles';
import { TAILLE_MAX_LOT } from '../lib/plateforme-colis';
import { purgerDonneesTest } from '../lib/plateformes';
import { creerClient, type Reponse } from './audit-http';

// SIMULATEUR DE PLATEFORME PARTENAIRE — joue le rôle de Shipeh de bout en bout.
//
//   npx tsx scripts/simuler-shipeh.ts
//
// avec un serveur de développement en cours (`npm run dev`).
//
// Ce script n'est pas une démonstration : c'est le SEUL endroit où le chemin
// complet est exercé — proxy, cloisonnement d'hôte, authentification par clé,
// scopes, quotas, transactions, contrainte d'unicité. Les tests de `lib/`
// couvrent la validation des charges utiles ; tout le reste ne se vérifie
// qu'en tapant les vraies routes.
//
// Il crée sa propre plateforme, ses clés, ses marchands et ses colis, tous
// préfixés, et les supprime en fin d'exécution — succès ou échec.
//
// ------------------------------------------------------------
// Ce qu'il vérifie, dans l'ordre
// ------------------------------------------------------------
//   1. Cloisonnement d'hôte — l'API n'existe que sur son hôte, et réciproquement
//   2. Authentification — clé absente, malformée, inconnue, révoquée, expirée
//   3. Scopes et quotas
//   4. Synchronisation des marchands — création, rejeu, rattachement, conflits
//   5. Ingestion des colis — unitaire, rejeu, lot, lot partiel, plafond
//   6. Cloisonnement bac à sable / production, et bascule vers la production
//  10. Purge des données de bac à sable

const PREFIXE = 'SIM-SHIPEH';
const CODE_PLATEFORME = 'shipeh-simulation';

let reussis = 0;
let echoues = 0;

function ok(label: string) {
  reussis++;
  console.log(`  OK   ${label}`);
}

function ko(label: string, err: unknown) {
  echoues++;
  console.error(`  KO   ${label} — ${err instanceof Error ? err.message : String(err)}`);
}

async function verifie(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    ko(label, err);
  }
}

function attendu(reponse: Reponse, statut: number, code?: string) {
  if (reponse.status !== statut) {
    throw new Error(`statut ${reponse.status} au lieu de ${statut} (${reponse.texte.slice(0, 200)})`);
  }
  if (code && reponse.json?.code !== code) {
    throw new Error(`code « ${String(reponse.json?.code)} » au lieu de « ${code} »`);
  }
}

// ------------------------------------------------------------
// Transport : on parle à l'hôte de l'API, jamais à un hôte d'espace
// ------------------------------------------------------------
//
// Le bocal à cookies du client d'audit ne sert à rien ici, et c'est le point :
// une plateforme partenaire s'authentifie par en-tête, sans cookie et sans
// `Origin` — c'est exactement ce qui rend l'exemption de contrôle CSRF
// correcte sur cet hôte (cf. proxy.ts §1 bis).
const client = creerClient('admin');
const hoteApi = HOST_API ?? 'api.localhost:3000';

function appel(methode: string, chemin: string, cle: string | null, corps?: unknown): Promise<Reponse> {
  return client.api(methode, chemin, corps, {
    host: hoteApi,
    origin: null,
    cookie: null,
    entetes: cle ? { Authorization: `Bearer ${cle}` } : {},
  });
}

// ------------------------------------------------------------
// Attente du serveur — sondée sur l'hôte de l'API, pas sur celui du back-office
// ------------------------------------------------------------
//
// `attendreServeur()` (audit-http) sonde l'hôte de l'espace ADMIN, que la
// configuration de développement pointe parfois sur un tunnel ngrok pour
// tester au téléphone (cf. .env.example). Ce script ne parle jamais à cet
// hôte : le diagnostic doit donc porter sur celui qu'il utilise vraiment,
// sinon un échec accuse un hôte hors sujet.
//
// La sonde est un appel SANS clé : un `401 cle_absente` prouve toute la
// chaîne d'un coup — le serveur répond, l'hôte de l'API est reconnu, et la
// route existe. C'est aussi ce qui rend les deux pannes courantes
// distinguables, là où « injoignable » les confondait :
//
//   connexion refusée → le serveur n'est pas lancé
//   404               → le serveur tourne, mais cet hôte n'est pas l'hôte de
//                       l'API (port différent, ou HOST_API mal configuré)
async function attendreApi(): Promise<void> {
  let dernier = '';

  for (let i = 0; i < 15; i++) {
    try {
      const r = await appel('POST', '/api/v1/colis', null, {});
      if (r.status === 401) return;
      if (r.status === 404) {
        throw new Error(
          `Le serveur répond, mais « ${hoteApi} » n'est pas l'hôte de son API.\n` +
            '       Vérifier le port (Next bascule sur 3001 si 3000 est pris) et HOST_API.\n' +
            `       Surcharges : AUDIT_BASE_URL=http://127.0.0.1:<port> HOST_API=${hoteApi}`
        );
      }
      dernier = `statut ${r.status}`;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Le serveur répond')) throw err;
      dernier = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(
    `Serveur injoignable (${dernier}).\n` +
      '       Lancer `npm run dev` dans un autre terminal, puis relancer ce script.\n' +
      '       Si le serveur écoute sur un autre port : AUDIT_BASE_URL=http://127.0.0.1:<port>'
  );
}

// ------------------------------------------------------------
// Amorçage : la plateforme et ses clés, posées directement en base
// ------------------------------------------------------------
//
// Ce que ferait un admin depuis /admin/integrations. On passe par Prisma pour
// que le script reste exécutable sans session de back-office — il simule le
// PARTENAIRE, pas notre propre personnel.
interface Amorce {
  plateformeId: string;
  cleLive: string;
  cleTest: string;
  cleSansScopeColis: string;
  cleRevoquee: string;
  cleExpiree: string;
  cleQuota: string;
  idCleQuota: string;
}

async function amorcer(): Promise<Amorce> {
  await nettoyer();

  const technique = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Shipeh`,
      motDePasseHash: 'simulation-sans-connexion-possible',
      role: 'plateforme',
      actif: false,
    },
  });

  const plateforme = await prisma.plateformePartenaire.create({
    data: {
      code: CODE_PLATEFORME,
      nom: `${PREFIXE} Shipeh`,
      utilisateurTechniqueId: technique.id,
    },
  });

  async function poser(
    environnement: 'live' | 'test',
    scopes: string[],
    extra: { revoqueeLe?: Date; expireLe?: Date; quotaParMinute?: number } = {}
  ) {
    const { cleComplete, prefixe, secretHash } = genererCle(environnement);
    const creee = await prisma.cleApiPlateforme.create({
      data: { plateformeId: plateforme.id, prefixe, secretHash, environnement, scopes, ...extra },
    });
    return { cleComplete, id: creee.id };
  }

  const live = await poser('live', ['marchands:creation_validee', 'colis:creation']);
  const test = await poser('test', ['marchands:creation', 'colis:creation']);
  const sansColis = await poser('live', ['marchands:creation']);
  const revoquee = await poser('live', ['colis:creation'], { revoqueeLe: new Date() });
  const expiree = await poser('live', ['colis:creation'], { expireLe: new Date(Date.now() - 60_000) });
  const quota = await poser('live', ['colis:creation'], { quotaParMinute: 2 });

  return {
    plateformeId: plateforme.id,
    cleLive: live.cleComplete,
    cleTest: test.cleComplete,
    cleSansScopeColis: sansColis.cleComplete,
    cleRevoquee: revoquee.cleComplete,
    cleExpiree: expiree.cleComplete,
    cleQuota: quota.cleComplete,
    idCleQuota: quota.id,
  };
}

// ------------------------------------------------------------
// Nettoyage
// ------------------------------------------------------------
//
// Dans l'ordre des dépendances : les colis avant les marchands, l'historique
// avant les colis. `onDelete: Cascade` couvre les tables du chantier, pas
// `commandes` — qui n'a justement reçu aucun lien vers les plateformes.
async function nettoyer() {
  const plateforme = await prisma.plateformePartenaire.findUnique({
    where: { code: CODE_PLATEFORME },
    include: { comptesMarchands: { select: { marchandId: true } } },
  });

  const marchandIds = plateforme?.comptesMarchands.map((c) => c.marchandId) ?? [];
  const marchandsDirects = await prisma.marchand.findMany({
    where: { nomBoutique: { startsWith: PREFIXE } },
    select: { id: true },
  });
  const tous = [...new Set([...marchandIds, ...marchandsDirects.map((m) => m.id)])];

  if (tous.length > 0) {
    const commandes = await prisma.commande.findMany({
      where: { marchandId: { in: tous } },
      select: { id: true },
    });
    const ids = commandes.map((c) => c.id);
    if (ids.length > 0) {
      await prisma.historiqueStatutCommande.deleteMany({ where: { commandeId: { in: ids } } });
      await prisma.commentaireCommande.deleteMany({ where: { commandeId: { in: ids } } });
      await prisma.commande.deleteMany({ where: { id: { in: ids } } });
    }
  }

  if (plateforme) {
    // Cascade : clés, liens marchands et journal partent avec la plateforme.
    await prisma.plateformePartenaire.delete({ where: { id: plateforme.id } });
    await prisma.utilisateur.delete({ where: { id: plateforme.utilisateurTechniqueId } }).catch(() => {});
  }

  if (tous.length > 0) {
    const marchands = await prisma.marchand.findMany({
      where: { id: { in: tous } },
      select: { utilisateurId: true },
    });
    await prisma.marchand.deleteMany({ where: { id: { in: tous } } });
    await prisma.utilisateur.deleteMany({
      where: { id: { in: marchands.map((m) => m.utilisateurId) } },
    });
  }

  await prisma.utilisateur.deleteMany({ where: { nomComplet: { startsWith: PREFIXE } } });
  // `plateforme:` (quota par clé) ET `plateforme-ip:` (plafond par adresse) :
  // le préfixe est volontairement court pour couvrir les deux.
  await prisma.rateLimitEntry.deleteMany({ where: { cle: { startsWith: 'plateforme' } } });
}

// ------------------------------------------------------------
// Jeux de données
// ------------------------------------------------------------

function marchand(suffixe: string, telephone: string) {
  return {
    idExterne: `${PREFIXE}-M-${suffixe}`,
    nomComplet: `${PREFIXE} Vendeur ${suffixe}`,
    nomBoutique: `${PREFIXE} Boutique ${suffixe}`,
    telephone,
    email: `sim-shipeh-${suffixe.toLowerCase()}@mathio.test`,
    ville: 'Casablanca',
    adresse: '12 rue de la Simulation',
  };
}

function colis(reference: string, idExterneMarchand: string, surcharges: Record<string, unknown> = {}) {
  return {
    idExterneMarchand,
    reference,
    clientNom: 'Client Simulation',
    clientTelephone: '0655443322',
    ville: 'Rabat',
    adresse: '18 avenue Mohammed V',
    montantCod: 299.9,
    ...surcharges,
  };
}

async function main() {
  console.log('\nSimulation d’une plateforme partenaire (Shipeh)');
  console.log(`  hôte API   ${hoteApi}`);
  console.log(`  plateforme ${CODE_PLATEFORME}\n`);

  await attendreApi();
  const a = await amorcer();

  // ----------------------------------------------------------
  console.log('1. Cloisonnement d’hôte');

  await verifie('l’API machine n’existe pas sur le domaine du back-office', async () => {
    const r = await client.api('POST', '/api/v1/colis', colis('X', 'Y'), { cookie: null });
    attendu(r, 404);
  });

  await verifie('l’hôte de l’API n’atteint que /api/v1/**', async () => {
    attendu(await appel('GET', '/api/commandes', a.cleLive), 404);
    attendu(await appel('GET', '/admin', a.cleLive), 404);
    attendu(await appel('GET', '/login', a.cleLive), 404);
  });

  // ----------------------------------------------------------
  console.log('\n2. Authentification par clé');

  await verifie('sans clé : 401', async () => {
    attendu(await appel('POST', '/api/v1/colis', null, colis('X', 'Y')), 401, 'cle_absente');
  });

  await verifie('clé malformée : 401, sans dire pourquoi', async () => {
    attendu(await appel('POST', '/api/v1/colis', 'pas-une-cle', colis('X', 'Y')), 401, 'cle_invalide');
  });

  await verifie('clé bien formée mais inconnue : 401 identique', async () => {
    // Même code que ci-dessus : distinguer « préfixe inconnu » de « secret
    // faux » ferait de cet endpoint un oracle d'énumération de préfixes.
    const inconnue = genererCle('live').cleComplete;
    attendu(await appel('POST', '/api/v1/colis', inconnue, colis('X', 'Y')), 401, 'cle_invalide');
  });

  await verifie('clé révoquée : refus DUR, et il se distingue', async () => {
    attendu(await appel('POST', '/api/v1/colis', a.cleRevoquee, colis('X', 'Y')), 401, 'cle_revoquee');
  });

  await verifie('clé expirée : refus, distinct d’une révocation', async () => {
    attendu(await appel('POST', '/api/v1/colis', a.cleExpiree, colis('X', 'Y')), 401, 'cle_expiree');
  });

  // ----------------------------------------------------------
  console.log('\n3. Scopes');

  await verifie('déposer un colis sans le scope colis:creation : 403', async () => {
    attendu(await appel('POST', '/api/v1/colis', a.cleSansScopeColis, colis('X', 'Y')), 403, 'scope_manquant');
  });

  // ----------------------------------------------------------
  console.log('\n4. Synchronisation des marchands');

  const mA = marchand('A', '0612000001');

  await verifie('création d’un marchand : 201, et il est ACTIF (clé live)', async () => {
    const r = await appel('POST', '/api/v1/marchands', a.cleLive, mA);
    attendu(r, 201);
    if (r.json?.issue !== 'cree') throw new Error(`issue « ${String(r.json?.issue)} »`);
    if (r.json?.statut !== 'actif') throw new Error(`statut « ${String(r.json?.statut)} » au lieu de actif`);
  });

  await verifie('rejeu à l’identique : 200, aucune écriture', async () => {
    const r = await appel('POST', '/api/v1/marchands', a.cleLive, mA);
    attendu(r, 200);
    if (r.json?.issue !== 'deja_synchronise') throw new Error(`issue « ${String(r.json?.issue)} »`);
    const n = await prisma.marchand.count({ where: { nomBoutique: mA.nomBoutique } });
    if (n !== 1) throw new Error(`${n} marchands portent ce nom au lieu d'un seul`);
  });

  await verifie('une clé de test crée un marchand EN ATTENTE, jamais actif', async () => {
    const r = await appel('POST', '/api/v1/marchands', a.cleTest, marchand('T', '0612000009'));
    attendu(r, 201);
    if (r.json?.statut !== 'en_attente_validation') {
      throw new Error(`statut « ${String(r.json?.statut)} » : une clé de test ne doit pas activer un compte`);
    }
  });

  await verifie('une clé LIVE ne se rattache pas à un marchand de bac à sable', async () => {
    // Sans ce refus, la clé de production retrouvait le compte de test par son
    // téléphone et s'y rattachait : la plateforme croyait obtenir un marchand
    // actif, elle héritait d'un compte resté en attente — et ce marchand
    // devenait NON PURGEABLE, le résidu d'essai s'installant pour de bon.
    const r = await appel('POST', '/api/v1/marchands', a.cleLive, marchand('T', '0612000009'));
    attendu(r, 409, 'marchand_de_test');
  });

  await verifie('une clé TEST ne se rattache pas à un marchand réel', async () => {
    // La traversée la plus coûteuse, et la seule qui ne se rattrape pas : les
    // colis déposés ensuite atterriraient chez un VRAI marchand, dans son
    // tableau de bord, et la purge ne pourrait pas les en retirer —
    // `commandes` ne porte aucune marque d'environnement. On ferme donc à la
    // source, ce qui garantit qu'un marchand lié en test reste toujours
    // purgeable.
    const direct = await prisma.utilisateur.create({
      data: {
        nomComplet: `${PREFIXE} Reel`,
        telephone: '0612000007',
        email: 'sim-shipeh-reel@mathio.test',
        motDePasseHash: 'simulation',
        role: 'marchand',
        marchand: { create: { nomBoutique: `${PREFIXE} Boutique Reelle`, statut: 'actif' } },
      },
      include: { marchand: true },
    });
    if (!direct.marchand) throw new Error('marchand réel non créé');

    const r = await appel('POST', '/api/v1/marchands', a.cleTest, marchand('R', '0612000007'));
    attendu(r, 409, 'marchand_de_production');
  });

  await verifie('marchand déjà inscrit en direct : rattaché, pas dupliqué', async () => {
    // Il s'inscrit chez nous AVANT que la plateforme ne le déclare — le cas
    // qu'une plateforme ne peut pas résoudre de son côté.
    const direct = await prisma.utilisateur.create({
      data: {
        nomComplet: `${PREFIXE} Direct`,
        telephone: '0612000002',
        email: 'sim-shipeh-direct@mathio.test',
        motDePasseHash: 'simulation',
        role: 'marchand',
        marchand: { create: { nomBoutique: `${PREFIXE} Boutique Direct`, statut: 'actif' } },
      },
      include: { marchand: true },
    });

    const r = await appel('POST', '/api/v1/marchands', a.cleLive, {
      ...marchand('D', '0612000002'),
      email: 'sim-shipeh-direct@mathio.test',
    });
    attendu(r, 200);
    if (r.json?.issue !== 'rattache') throw new Error(`issue « ${String(r.json?.issue)} »`);
    if (r.json?.marchandId !== direct.marchand!.id) {
      throw new Error('rattaché au mauvais marchand');
    }
  });

  await verifie('coordonnées d’un compte non marchand : 409, pas de conversion', async () => {
    await prisma.utilisateur.create({
      data: {
        nomComplet: `${PREFIXE} Livreur`,
        telephone: '0612000003',
        email: 'sim-shipeh-livreur@mathio.test',
        motDePasseHash: 'simulation',
        role: 'livreur',
      },
    });
    const r = await appel('POST', '/api/v1/marchands', a.cleLive, marchand('L', '0612000003'));
    attendu(r, 409, 'compte_non_marchand');
  });

  await verifie('téléphone et email désignant deux comptes : 409, pas de choix arbitraire', async () => {
    const r = await appel('POST', '/api/v1/marchands', a.cleLive, {
      ...marchand('C', '0612000002'),
      email: 'sim-shipeh-livreur@mathio.test',
    });
    attendu(r, 409, 'conflit_identifiants');
  });

  await verifie('charge utile invalide : 400 avec le champ nommé', async () => {
    const r = await appel('POST', '/api/v1/marchands', a.cleLive, { idExterne: 'x' });
    attendu(r, 400, 'champ_requis');
    if (!String(r.json?.message ?? '').includes('nomComplet')) {
      throw new Error(`message peu utile : ${String(r.json?.message)}`);
    }
  });

  // ----------------------------------------------------------
  console.log('\n5. Ingestion des colis');

  let codeSuiviInitial = '';

  await verifie('dépôt unitaire : 201 avec un code de suivi', async () => {
    const r = await appel('POST', '/api/v1/colis', a.cleLive, colis(`${PREFIXE}-C-1`, mA.idExterne));
    attendu(r, 201);
    codeSuiviInitial = String(r.json?.codeSuivi ?? '');
    if (!codeSuiviInitial.startsWith('PD-')) throw new Error(`code de suivi inattendu : ${codeSuiviInitial}`);
  });

  await verifie('rejeu de la même référence : 200 et LE MÊME code de suivi', async () => {
    const r = await appel('POST', '/api/v1/colis', a.cleLive, colis(`${PREFIXE}-C-1`, mA.idExterne));
    attendu(r, 200);
    if (r.json?.issue !== 'deja_ingere') throw new Error(`issue « ${String(r.json?.issue)} »`);
    if (r.json?.codeSuivi !== codeSuiviInitial) {
      throw new Error('un rejeu a produit un second colis : l’idempotence est cassée');
    }
  });

  await verifie('un montant hors bornes SQL est refusé en 400, pas en 500', async () => {
    // Sans borne haute côté validation, cette valeur traversait jusqu'à
    // PostgreSQL, y déclenchait un « numeric field overflow » et ressortait en
    // 500 — un « le problème est chez nous » pour une valeur mal formée par
    // l'appelant, et sans rien pour la corriger.
    const r = await appel(
      'POST',
      '/api/v1/colis',
      a.cleLive,
      colis(`${PREFIXE}-OVF`, mA.idExterne, { montantCod: 1e12 })
    );
    attendu(r, 400, 'montant_invalide');
  });

  await verifie('marchand inconnu : 404, aucun colis orphelin', async () => {
    const r = await appel('POST', '/api/v1/colis', a.cleLive, colis(`${PREFIXE}-C-X`, 'inexistant'));
    attendu(r, 404, 'marchand_inconnu');
  });

  await verifie('lot de 50 : 207, 50 créés', async () => {
    const lot = Array.from({ length: 50 }, (_, i) => colis(`${PREFIXE}-LOT-${i}`, mA.idExterne));
    const r = await appel('POST', '/api/v1/colis/lot', a.cleLive, lot);
    attendu(r, 207);
    if (r.json?.crees !== 50) throw new Error(`${String(r.json?.crees)} créés au lieu de 50`);
    if (r.json?.refuses !== 0) throw new Error(`${String(r.json?.refuses)} refusés`);
  });

  await verifie('rejeu du lot : 207, 50 déjà ingérés et aucun doublon', async () => {
    const lot = Array.from({ length: 50 }, (_, i) => colis(`${PREFIXE}-LOT-${i}`, mA.idExterne));
    const r = await appel('POST', '/api/v1/colis/lot', a.cleLive, lot);
    attendu(r, 207);
    if (r.json?.dejaIngeres !== 50) throw new Error(`${String(r.json?.dejaIngeres)} déjà ingérés au lieu de 50`);
    const n = await prisma.commande.count({
      where: { codeSuiviPartenaire: { startsWith: `${PREFIXE}-LOT-` } },
    });
    if (n !== 50) throw new Error(`${n} colis en base au lieu de 50`);
  });

  await verifie('lot partiellement invalide : les lignes saines passent quand même', async () => {
    // LE comportement qui justifie le 207 : une machine ne peut pas corriger
    // et réessayer comme un humain devant un tableur.
    const lot: Record<string, unknown>[] = Array.from({ length: 10 }, (_, i) =>
      colis(`${PREFIXE}-MIX-${i}`, mA.idExterne)
    );
    lot[2] = colis(`${PREFIXE}-MIX-2`, mA.idExterne, { ville: '' });
    lot[5] = colis(`${PREFIXE}-MIX-5`, mA.idExterne, { montantCod: 0 });
    lot[8] = colis(`${PREFIXE}-MIX-8`, 'marchand-inexistant');

    const r = await appel('POST', '/api/v1/colis/lot', a.cleLive, lot);
    attendu(r, 207);
    if (r.json?.crees !== 7) throw new Error(`${String(r.json?.crees)} créés au lieu de 7`);
    if (r.json?.refuses !== 3) throw new Error(`${String(r.json?.refuses)} refusés au lieu de 3`);

    // Chaque ligne refusée doit être désignable : sans index ni référence, le
    // partenaire ne saurait pas laquelle rejouer.
    const lignes = r.json?.lignes as { index: number; ok: boolean; code?: string }[];
    const refusees = lignes.filter((l) => !l.ok).map((l) => l.index);
    if (refusees.join(',') !== '2,5,8') throw new Error(`lignes refusées : ${refusees.join(',')}`);
  });

  await verifie(`lot au-delà de ${TAILLE_MAX_LOT} colis : 413`, async () => {
    const lot = Array.from({ length: TAILLE_MAX_LOT + 1 }, (_, i) =>
      colis(`${PREFIXE}-TROP-${i}`, mA.idExterne)
    );
    attendu(await appel('POST', '/api/v1/colis/lot', a.cleLive, lot), 413, 'lot_trop_grand');
  });

  await verifie('lot vide : 400 plutôt qu’un 207 vide', async () => {
    attendu(await appel('POST', '/api/v1/colis/lot', a.cleLive, []), 400, 'lot_vide');
  });

  await verifie('JSON malformé : 400, pas 500', async () => {
    const r = await client.api('POST', '/api/v1/colis', undefined, {
      host: hoteApi,
      origin: null,
      cookie: null,
      entetes: { Authorization: `Bearer ${a.cleLive}` },
    });
    attendu(r, 400, 'json_invalide');
  });

  // ----------------------------------------------------------
  console.log('\n6. Cloisonnement bac à sable / production');

  await verifie('une clé de test ne voit pas les marchands de production', async () => {
    // Le cloisonnement est porté par le LIEN marchand, pas par un drapeau sur
    // le colis : la clé de test ne trouve simplement pas ce marchand-là.
    const r = await appel('POST', '/api/v1/colis', a.cleTest, colis(`${PREFIXE}-ENV-1`, mA.idExterne));
    attendu(r, 404, 'marchand_inconnu');
  });

  const ID_DOUBLE = `${PREFIXE}-M-DOUBLE`;

  await verifie('un même idExterne peut vivre dans les DEUX environnements', async () => {
    // Depuis que `environnement` fait partie des contraintes d'unicité, test et
    // production sont deux espaces de noms distincts. Les coordonnées, elles,
    // restent uniques globalement : d'où deux téléphones différents.
    const enTest = await appel('POST', '/api/v1/marchands', a.cleTest, {
      ...marchand('DOUBLE', '0612000004'),
      idExterne: ID_DOUBLE,
    });
    attendu(enTest, 201);

    const enLive = await appel('POST', '/api/v1/marchands', a.cleLive, {
      ...marchand('DOUBLE-L', '0612000005'),
      idExterne: ID_DOUBLE,
      email: 'sim-shipeh-double-l@mathio.test',
    });
    attendu(enLive, 201);
    if (enLive.json?.issue !== 'cree') {
      throw new Error(
        `issue « ${String(enLive.json?.issue)} » : la clé live a retrouvé le lien de TEST — ` +
          'la bascule vers la production est cassée'
      );
    }
    if (enLive.json?.marchandId === enTest.json?.marchandId) {
      throw new Error('les deux environnements pointent sur le même marchand');
    }
  });

  await verifie('la bascule test → production laisse déposer des colis', async () => {
    // C'est le scénario qui échouait en 404 avant que l'environnement entre
    // dans les clés d'unicité : la synchronisation live répondait « déjà
    // synchronisé » puis le dépôt refusait le marchand.
    const r = await appel('POST', '/api/v1/colis', a.cleLive, colis(`${PREFIXE}-BASC-1`, ID_DOUBLE));
    attendu(r, 201);
  });

  // ----------------------------------------------------------
  console.log('\n7. Quota');

  await verifie('quota de 2 appels/minute : le troisième est refusé', async () => {
    await appel('POST', '/api/v1/colis', a.cleQuota, colis(`${PREFIXE}-Q-1`, mA.idExterne));
    await appel('POST', '/api/v1/colis', a.cleQuota, colis(`${PREFIXE}-Q-2`, mA.idExterne));
    const r = await appel('POST', '/api/v1/colis', a.cleQuota, colis(`${PREFIXE}-Q-3`, mA.idExterne));
    attendu(r, 429, 'quota_depasse');
  });

  // ----------------------------------------------------------
  console.log('\n8. Plateforme suspendue');

  await verifie('suspendre la plateforme coupe TOUTES ses clés d’un coup', async () => {
    await prisma.plateformePartenaire.update({ where: { id: a.plateformeId }, data: { actif: false } });
    const r = await appel('POST', '/api/v1/colis', a.cleLive, colis(`${PREFIXE}-SUSP`, mA.idExterne));
    attendu(r, 403, 'plateforme_desactivee');
    await prisma.plateformePartenaire.update({ where: { id: a.plateformeId }, data: { actif: true } });
  });

  // ----------------------------------------------------------
  console.log('\n9. Journal et traçabilité');

  await verifie('les appels reçus sont journalisés, refus compris', async () => {
    const total = await prisma.journalAppelApi.count({ where: { plateformeId: a.plateformeId } });
    if (total === 0) throw new Error('aucun appel journalisé');
    const refus = await prisma.journalAppelApi.count({
      where: { plateformeId: a.plateformeId, statut: { gte: 400 } },
    });
    if (refus === 0) throw new Error('les refus ne sont pas journalisés');
    console.log(`       ${total} appels journalisés, dont ${refus} refus`);
  });

  await verifie('les compteurs de la clé sont tenus à jour', async () => {
    const cle = await prisma.cleApiPlateforme.findUnique({ where: { id: a.idCleQuota } });
    if (!cle?.derniereUtilisationLe) throw new Error('derniereUtilisationLe jamais renseigné');
    if (cle.nbAppels < 2) throw new Error(`nbAppels = ${cle.nbAppels}`);
  });

  await verifie('l’historique du colis porte la plateforme comme auteur', async () => {
    const commande = await prisma.commande.findFirst({
      where: { codeSuivi: codeSuiviInitial },
      include: { historique: { include: { utilisateur: { select: { nomComplet: true, role: true } } } } },
    });
    const entree = commande?.historique[0];
    if (!entree) throw new Error('aucune entrée d’historique');
    if (entree.utilisateur.role !== 'plateforme') {
      throw new Error(`auteur de rôle « ${entree.utilisateur.role} »`);
    }
    if (!entree.note?.includes(CODE_PLATEFORME)) {
      throw new Error(`note peu explicite : ${entree.note}`);
    }
  });

  await verifie('les colis ingérés portent bien source = api', async () => {
    const n = await prisma.commande.count({
      where: { codeSuiviPartenaire: { startsWith: PREFIXE }, source: 'api' },
    });
    const total = await prisma.commande.count({
      where: { codeSuiviPartenaire: { startsWith: PREFIXE } },
    });
    if (n !== total) throw new Error(`${total - n} colis sur ${total} n’ont pas source = api`);
    console.log(`       ${total} colis ingérés au total`);
  });

  // ----------------------------------------------------------
  console.log('\n10. Purge des données de bac à sable');

  await verifie('la purge efface les marchands et colis de TEST, et eux seuls', async () => {
    const avantTest = await prisma.compteMarchandExterne.count({
      where: { plateformeId: a.plateformeId, environnement: 'test' },
    });
    const avantLive = await prisma.compteMarchandExterne.count({
      where: { plateformeId: a.plateformeId, environnement: 'live' },
    });
    if (avantTest === 0) throw new Error('aucune donnée de test à purger : le scénario n’a rien créé');

    const volume = await purgerDonneesTest(a.plateformeId);
    console.log(`       purgé : ${volume.marchands} marchand(s), ${volume.colis} colis`);

    const apresTest = await prisma.compteMarchandExterne.count({
      where: { plateformeId: a.plateformeId, environnement: 'test' },
    });
    const apresLive = await prisma.compteMarchandExterne.count({
      where: { plateformeId: a.plateformeId, environnement: 'live' },
    });

    if (apresTest !== 0) throw new Error(`${apresTest} lien(s) de test survivent à la purge`);
    if (apresLive !== avantLive) {
      throw new Error(`la purge a touché la production : ${avantLive} → ${apresLive} liens live`);
    }
  });

  await verifie('la purge ne supprime JAMAIS un marchand qu’elle n’a pas créé', async () => {
    // Le marchand « Direct » s'était inscrit chez nous avant d'être rattaché.
    // Son lien de test disparaît, lui reste. C'est ce que garantit
    // CompteMarchandExterne.creeParSynchro, et c'est la raison d'être de cette
    // colonne : sans elle, la purge reposerait sur une heuristique, et une
    // heuristique qui se trompe efface un vrai client.
    const direct = await prisma.marchand.findFirst({
      where: { nomBoutique: `${PREFIXE} Boutique Direct` },
    });
    if (!direct) throw new Error('le marchand inscrit en direct a été supprimé par la purge');
  });

  await verifie('les colis de production survivent à la purge', async () => {
    const restants = await prisma.commande.count({
      where: { codeSuiviPartenaire: { startsWith: `${PREFIXE}-LOT-` } },
    });
    if (restants !== 50) throw new Error(`${restants} colis live restants au lieu de 50`);
  });

  console.log('\nNon couvert ici :');
  console.log('  • l’envoi réel de l’email d’invitation (SMTP non configuré en dev,');
  console.log('    et court-circuité en environnement de test par construction).');
  console.log('  • le retour de statuts vers la plateforme (webhooks) : hors périmètre.');
}

main()
  .catch((err) => {
    echoues++;
    console.error('\nInterrompu :', err instanceof Error ? err.message : err);
  })
  .finally(async () => {
    await nettoyer().catch((err) => console.error('Nettoyage incomplet :', err));
    await prisma.$disconnect();
    console.log(`\n${reussis} OK, ${echoues} KO`);
    process.exit(echoues > 0 ? 1 : 0);
  });
