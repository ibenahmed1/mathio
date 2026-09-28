import 'dotenv/config';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

// § Intégration YouCan — scénario de bout en bout (INTEGRATION_YOUCAN.md).
//
//   npm run simuler:youcan              (pas besoin du serveur de dev)
//   npm run simuler:youcan -- --garder  (laisse les données pour les regarder)
//
// Aucun appel à la vraie API YouCan : un FAUX serveur local joue YouCan
// (jetons OAuth, /me, REST Hooks, produits, commandes), et lib/youcan.ts y est
// pointé par YOUCAN_API_BASE_URL. Ce qui est vérifié, c'est NOTRE côté :
// connexion, renouvellement du jeton, import, réception signée, idempotence,
// codes de réponse, désinstallation. Ce qui ne l'est pas : que YouCan envoie
// vraiment ce que sa doc décrit — seule une vraie boutique le dira.
//
// Tout est fait sous un marchand DÉDIÉ (youcan.simulation@mathio.test), purgé
// au début et à la fin.

const EMAIL = 'youcan.simulation@mathio.test';
const SECRET = 'secret-application-simulation';
const STORE_ID = 'aaaaaaaa-0000-4000-8000-00000000cafe';
const GARDER = process.argv.includes('--garder');

let echecs = 0;
function verifier(condition: boolean, libelle: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ✔ ${libelle}`);
  } else {
    echecs += 1;
    console.log(`  ✘ ${libelle}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

// --- Faux YouCan ----------------------------------------------------------------

const commandesYoucan = new Map<string, Record<string, unknown>>();
const appels: string[] = [];
let jetonCourant = 'jeton-1';
let rafraichissementCourant = 'refresh-1';
let generation = 1;

function commande(id: string, ref: string, surcharges: Record<string, unknown> = {}) {
  return {
    id,
    ref,
    total: 199,
    currency: 'MAD',
    status: 1,
    status_object: { slug: 'open' },
    created_at: new Date().toISOString(),
    customer: { first_name: 'Client', last_name: 'Simulation', phone: '0612345678', address: [] },
    payment: { status_object: { slug: 'pending' }, gateway_type_text: 'Cash on Delivery', address: [] },
    shipping: {
      address: { first_name: 'Client', last_name: 'Simulation', phone: '0612345678', first_line: '1 rue Test', city: 'Casa' },
    },
    variants: [{ quantity: 1, price: 199, variant: { id: 'var-1', sku: 'SIM-1', values: ['default'], product: { name: 'Article simulé' } } }],
    ...surcharges,
  };
}

function repondre(res: http.ServerResponse, statut: number, corps: unknown) {
  res.writeHead(statut, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corps));
}

const serveur = http.createServer((req, res) => {
  let brut = '';
  req.on('data', (m) => (brut += m));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://x');
    appels.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/oauth/token') {
      const p = new URLSearchParams(brut);
      if (p.get('client_secret') !== SECRET) {
        return repondre(res, 401, { error: 'invalid_client', error_description: 'Client authentication failed' });
      }
      const accepte =
        ((p.get('grant_type') === 'authorization_code' && p.get('code') === 'code-ok') ||
          (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === rafraichissementCourant));
      // Comme le vrai YouCan (constaté le 2026-09-26) : 400 invalid_grant.
      if (!accepte) return repondre(res, 400, { error: 'invalid_grant', error_description: 'The refresh token is invalid.' });
      generation += 1;
      jetonCourant = `jeton-${generation}`;
      rafraichissementCourant = `refresh-${generation}`;
      return repondre(res, 200, { token_type: 'Bearer', expires_in: 1295999, access_token: jetonCourant, refresh_token: rafraichissementCourant });
    }
    if (req.headers.authorization !== `Bearer ${jetonCourant}`) return repondre(res, 401, { status: 401, detail: 'Unauthenticated', meta: [] });
    if (url.pathname === '/me') {
      return repondre(res, 200, { id: STORE_ID, store_id: STORE_ID, slug: 'simu', name: 'Boutique Simu', domain: 'simu.youcan.store', currency: { code: 'MAD' } });
    }
    if (url.pathname === '/resthooks/subscribe') {
      return repondre(res, 200, { id: `hook-${JSON.parse(brut).event}` });
    }
    if (url.pathname.startsWith('/resthooks/unsubscribe/')) return repondre(res, 200, { message: 'ok', type: 'success' });
    if (url.pathname === '/products') {
      const page = Number(url.searchParams.get('page'));
      const data =
        page === 1
          ? [
              { id: 'p1', name: 'Article simulé', price: 199, variants: [{ id: 'var-1', sku: 'SIM-1', price: 199, values: ['default'] }] },
              { id: 'p2', name: 'T-shirt', price: 80, variants: [{ id: 'var-2', sku: 'TS-S', price: 80, values: ['S'] }, { id: 'var-3', sku: 'TS-M', price: 85, values: ['M'] }] },
            ]
          : [];
      return repondre(res, 200, { data, meta: { pagination: { current_page: page, total_pages: 1 } } });
    }
    if (url.pathname === '/orders') {
      return repondre(res, 200, { data: [...commandesYoucan.values()], meta: { pagination: { current_page: 1, total_pages: 1 } } });
    }
    const m = /^\/orders\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const c = commandesYoucan.get(m[1]);
      return c ? repondre(res, 200, c) : repondre(res, 404, { status: 404, detail: 'Order not found', meta: [] });
    }
    repondre(res, 404, { status: 404, detail: 'route inconnue du faux serveur', meta: [] });
  });
});

// --- Scénario -------------------------------------------------------------------

async function main() {
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const port = (serveur.address() as AddressInfo).port;
  // AVANT l'import de lib/youcan.ts, qui lit l'URL de l'API au chargement.
  process.env.YOUCAN_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.YOUCAN_WEBHOOK_BASE_URL = 'https://simulation.invalid';

  const { prisma } = await import('../lib/prisma');
  const yc = await import('../lib/youcan');
  // Identifiants de l'application YouCan du marchand, tels qu'il les saisit.
  const ids = { clientId: 'cl_simulation', clientSecret: SECRET };

  const utilisateur = await prisma.utilisateur.upsert({
    where: { email: EMAIL },
    update: {},
    create: { nomComplet: 'Simulation YouCan', email: EMAIL, motDePasseHash: await bcrypt.hash(`Simu-${randomInt(1e9)}!`, 10), role: 'marchand' },
  });
  const marchand = await prisma.marchand.upsert({
    where: { utilisateurId: utilisateur.id },
    update: {},
    create: { utilisateurId: utilisateur.id, nomBoutique: 'Boutique Simulation YouCan', statut: 'actif' },
    select: { id: true },
  });

  const purger = async () => {
    const ids = (await prisma.commande.findMany({ where: { marchandId: marchand.id }, select: { id: true } })).map((c) => c.id);
    await prisma.historiqueStatutCommande.deleteMany({ where: { commandeId: { in: ids } } });
    await prisma.commentaireCommande.deleteMany({ where: { commandeId: { in: ids } } });
    await prisma.commande.deleteMany({ where: { id: { in: ids } } });
    await prisma.boutiqueYoucan.deleteMany({ where: { marchandId: marchand.id } });
    await prisma.webhookYoucanRecu.deleteMany({ where: { storeId: STORE_ID } });
    await prisma.marchandise.deleteMany({ where: { marchandId: marchand.id } });
  };

  const webhook = (evenement: string, data: Record<string, unknown>, secret = SECRET) => {
    const corps = JSON.stringify({ event_name: evenement, event_happened_at: new Date().toISOString(), data });
    return yc.recevoirWebhookYoucan({
      corpsBrut: Buffer.from(corps),
      signature: createHmac('sha256', secret).update(corps).digest('hex'),
      sujet: evenement,
      idLivraison: randomUUID(),
    });
  };
  const colisDe = (idCommandeYoucan: string) =>
    prisma.commandeYoucan.findFirst({ where: { idCommandeYoucan }, include: { commande: true } });

  await purger();
  try {
    console.log('\n1. Connexion OAuth');
    await yc.testerIdentifiantsYoucan(ids, 'https://x/cb').then(
      () => verifier(true, '« Tester » : identifiants justes acceptés'),
      (e) => verifier(false, '« Tester » : identifiants justes acceptés', String(e))
    );
    await yc.testerIdentifiantsYoucan({ ...ids, clientSecret: 'mauvais-secret-de-test' }, 'https://x/cb').then(
      () => verifier(false, '« Tester » : secret faux refusé'),
      (e) => verifier(e instanceof yc.ErreurYoucan && e.code === 'identifiants_refuses', '« Tester » : secret faux refusé')
    );
    await yc.connecterBoutiqueYoucan(marchand.id, ids, 'code-faux', 'https://x/cb').then(
      () => verifier(false, 'un code refusé ne connecte rien'),
      async (e) => verifier(e instanceof yc.ErreurYoucan && !(await prisma.boutiqueYoucan.findUnique({ where: { marchandId: marchand.id } })), 'un code refusé ne connecte rien et n’écrit rien')
    );
    const connexion = await yc.connecterBoutiqueYoucan(marchand.id, ids, 'code-ok', 'https://x/cb');
    let boutique = await prisma.boutiqueYoucan.findUniqueOrThrow({ where: { marchandId: marchand.id } });
    verifier(boutique.storeId === STORE_ID && boutique.nom === 'Boutique Simu', 'boutique identifiée par /me');
    verifier(!boutique.jetonAccesChiffre.includes('jeton-'), 'jetons stockés chiffrés');
    verifier(boutique.clientId === 'cl_simulation' && !boutique.clientSecretChiffre?.includes(SECRET), 'identifiants du marchand enregistrés, secret chiffré');
    verifier(boutique.webhookCommandesId === 'hook-order.created' && boutique.webhookDesinstallId === 'hook-app.uninstalled', 'webhooks order.created et app.uninstalled abonnés');
    verifier(connexion.synchro?.variantes === 3 && connexion.synchro.creees === 3, 'catalogue importé : 3 variantes → 3 marchandises', connexion.synchro);
    const noms = (await prisma.marchandise.findMany({ where: { marchandId: marchand.id }, select: { nom: true } })).map((m) => m.nom).sort();
    verifier(JSON.stringify(noms) === JSON.stringify(['Article simulé', 'T-shirt — M', 'T-shirt — S']), 'noms des marchandises', noms);
    const resynchro = await yc.synchroniserProduitsYoucan(boutique);
    verifier(resynchro.misesAJour === 3 && resynchro.creees === 0, 'resynchronisation sans doublon');

    console.log('\n2. Réception des commandes');
    const id1 = randomUUID();
    commandesYoucan.set(id1, commande(id1, 'SIM-001'));
    let r = await webhook('order.created', { id: id1, ref: 'SIM-001', store_id: STORE_ID });
    const c1 = await colisDe(id1);
    verifier(r.statut === 200 && r.issue === 'cree', 'commande abrégée dans le webhook → relue par l’API → colis créé', r);
    verifier(
      !!c1 && Number(c1.commande.montantCod) === 199 && c1.commande.clientTelephone === '0612345678' && c1.commande.statut === 'nouveau_colis',
      'colis : COD 199, téléphone, statut nouveau_colis'
    );
    verifier(!!c1?.commande.marchandiseId, 'colis rattaché à la marchandise importée (commande à un article)');
    verifier(c1?.commande.villeId !== null, `ville « Casa » rapprochée du référentiel (${c1?.commande.ville})`);

    r = await webhook('order.created', { id: id1, ref: 'SIM-001', store_id: STORE_ID });
    verifier(r.statut === 200 && r.issue === 'deja_recu', 'relivraison → déjà reçue, pas de doublon');

    const id2 = randomUUID();
    commandesYoucan.set(id2, commande(id2, 'SIM-002'));
    const simultanes = await Promise.all([1, 2, 3].map(() => webhook('order.created', { id: id2, store_id: STORE_ID })));
    verifier(
      simultanes.filter((x) => x.issue === 'cree').length === 1 && (await prisma.commandeYoucan.count({ where: { idCommandeYoucan: id2 } })) === 1,
      'trois livraisons simultanées → un seul colis',
      simultanes
    );

    const id3 = randomUUID();
    commandesYoucan.set(id3, commande(id3, 'SIM-003', { payment: { status_object: { slug: 'paid' } } }));
    await webhook('order.created', { id: id3, store_id: STORE_ID });
    verifier(Number((await colisDe(id3))?.commande.montantCod) === 0, 'commande payée en ligne → COD 0');

    const id4 = randomUUID();
    commandesYoucan.set(id4, commande(id4, 'SIM-004', { status_object: { slug: 'canceled' } }));
    r = await webhook('order.created', { id: id4, store_id: STORE_ID });
    verifier(r.issue === 'ignore' && !(await colisDe(id4)), 'commande annulée → ignorée');

    r = await webhook('order.created', { id: randomUUID(), store_id: STORE_ID }, 'mauvais-secret');
    verifier(r.statut === 401, 'signature faite avec un autre secret que celui du marchand → 401');
    r = await webhook('order.created', { id: randomUUID(), store_id: randomUUID() });
    verifier(r.statut === 410, 'boutique inconnue → 410 (désactive l’abonnement chez YouCan)');
    r = await webhook('order.updated', { id: id1, store_id: STORE_ID });
    verifier(r.statut === 200 && r.issue === 'ignore', 'autre événement → 200 ignoré');

    console.log('\n3. Jeton expiré');
    await prisma.boutiqueYoucan.update({ where: { id: boutique.id }, data: { jetonExpireLe: new Date(Date.now() - 1000) } });
    const avant = generation;
    const id5 = randomUUID();
    commandesYoucan.set(id5, commande(id5, 'SIM-005'));
    r = await webhook('order.created', { id: id5, store_id: STORE_ID });
    boutique = await prisma.boutiqueYoucan.findUniqueOrThrow({ where: { id: boutique.id } });
    verifier(generation === avant + 1 && boutique.jetonExpireLe > new Date(Date.now() + 10 * 86400e3), 'jeton renouvelé et nouvelle échéance enregistrée');
    verifier(r.issue === 'cree', 'la commande passe avec le nouveau jeton');

    // Deux renouvellements concurrents : le second jeton de rafraîchissement est déjà consommé.
    await prisma.boutiqueYoucan.update({ where: { id: boutique.id }, data: { jetonExpireLe: new Date(Date.now() - 1000) } });
    const perimee = await prisma.boutiqueYoucan.findUniqueOrThrow({ where: { id: boutique.id } });
    const jetons = await Promise.allSettled([yc.jetonAcces(perimee), yc.jetonAcces(perimee)]);
    verifier(jetons.every((j) => j.status === 'fulfilled'), 'deux renouvellements simultanés : aucun n’échoue', jetons);

    console.log('\n4. Rattrapage');
    const id6 = randomUUID();
    commandesYoucan.set(id6, commande(id6, 'SIM-006'));
    // Relue : les jetons ont changé au renouvellement ci-dessus (comme les routes, qui relisent toujours).
    boutique = await prisma.boutiqueYoucan.findUniqueOrThrow({ where: { id: boutique.id } });
    const rattrapage = await yc.rattraperCommandesYoucan(boutique);
    verifier(rattrapage.creees === 1 && rattrapage.ignorees === 1 && rattrapage.dejaRecues === 4, 'seule la commande manquée est créée', rattrapage);

    console.log('\n5. Désinstallation puis déconnexion');
    r = await webhook('app.uninstalled', { store_id: STORE_ID, store_slug: 'simu' });
    boutique = await prisma.boutiqueYoucan.findUniqueOrThrow({ where: { id: boutique.id } });
    verifier(r.statut === 200 && !!boutique.deconnecteeLe, 'app.uninstalled → boutique déconnectée');
    r = await webhook('order.created', { id: randomUUID(), store_id: STORE_ID });
    verifier(r.statut === 410, 'commande sur boutique déconnectée → 410');
    await yc.connecterBoutiqueYoucan(marchand.id, ids, 'code-ok', 'https://x/cb');
    await yc.deconnecterBoutiqueYoucan(marchand.id);
    verifier(appels.filter((a) => a.startsWith('POST /resthooks/unsubscribe/')).length === 2, 'déconnexion : les deux webhooks supprimés chez YouCan');
    const nbColis = await prisma.commandeYoucan.count({ where: { boutiqueId: boutique.id } });
    verifier(nbColis === 5, `les colis restent liés (tag conservé) : ${nbColis}`);
  } finally {
    if (GARDER) console.log(`\nDonnées conservées (--garder) sous le marchand ${EMAIL}.`);
    else await purger();
    await prisma.$disconnect();
    serveur.close();
  }
  console.log(echecs === 0 ? '\nTous les contrôles passent.' : `\n${echecs} contrôle(s) en échec.`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
