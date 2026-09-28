import 'dotenv/config';
import http from 'node:http';
import { createHmac, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { HOST_API, SPACE_HOSTS } from '../lib/spaces';
import { chiffrer } from '../lib/chiffrement';
import { CHEMIN_WEBHOOK_SHOPIFY, connecterBoutique, deconnecterBoutique, validerSaisie } from '../lib/shopify';

// § Intégration Shopify — scénario de bout en bout (INTEGRATION_SHOPIFY.md).
//
//   npm run simuler:shopify              (serveur de dev lancé : npm run dev)
//   npm run simuler:shopify -- --garder  (laisse les données pour les regarder)
//
// Deux phases :
//   A. CONNEXION RÉELLE à la boutique décrite par SHOPIFY_STORE_DOMAIN,
//      SHOPIFY_ACCESS_TOKEN et SHOPIFY_API_SECRET_KEY (.env) : test des
//      identifiants et import des produits. Sautée si ces variables manquent,
//      ou si la boutique est déjà connectée à un vrai marchand.
//   B. WEBHOOKS SIMULÉS : de fausses commandes, signées comme Shopify les
//      signe, postées au serveur local sur l'hôte de l'API machine. Les
//      identifiants de commande commencent par 999 : aucune collision possible
//      avec une vraie commande.
//
// Tout est fait sous un marchand DÉDIÉ (shopify.simulation@mathio.test), purgé
// au début et à la fin : aucun vrai marchand n'est touché, et la boutique
// réelle est libérée pour être connectée depuis l'écran marchand.

const CIBLE = new URL(process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000');
const HOTE_API = HOST_API ?? 'api.localhost:3000';
const EMAIL = 'shopify.simulation@mathio.test';
const DOMAINE_FICTIF = 'simulation-mathio.myshopify.com';
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

function poster(corps: string, entetes: Record<string, string>, hote = HOTE_API): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const requete = http.request(
      {
        hostname: CIBLE.hostname,
        port: CIBLE.port,
        path: CHEMIN_WEBHOOK_SHOPIFY,
        method: 'POST',
        headers: { host: hote, 'content-type': 'application/json', 'content-length': Buffer.byteLength(corps), ...entetes },
      },
      (reponse) => {
        reponse.resume();
        reponse.on('end', () => resoudre(reponse.statusCode ?? 0));
      }
    );
    requete.on('error', rejeter);
    requete.end(corps);
  });
}

function signer(corps: string, secret: string): string {
  return createHmac('sha256', secret).update(corps).digest('base64');
}

async function purger(marchandId: string): Promise<void> {
  const commandes = await prisma.commande.findMany({ where: { marchandId }, select: { id: true } });
  const ids = commandes.map((c) => c.id);
  await prisma.historiqueStatutCommande.deleteMany({ where: { commandeId: { in: ids } } });
  await prisma.commentaireCommande.deleteMany({ where: { commandeId: { in: ids } } });
  await prisma.commande.deleteMany({ where: { id: { in: ids } } });
  // La boutique emporte ses liens (commandes, marchandises) et son journal.
  await prisma.boutiqueShopify.deleteMany({ where: { marchandId } });
  await prisma.marchandise.deleteMany({ where: { marchandId } });
}

async function marchandDeSimulation(): Promise<{ id: string }> {
  const utilisateur = await prisma.utilisateur.upsert({
    where: { email: EMAIL },
    update: {},
    create: {
      nomComplet: 'Simulation Shopify',
      email: EMAIL,
      motDePasseHash: await bcrypt.hash(`Simu-${randomInt(1e9)}!`, 10),
      role: 'marchand',
    },
  });
  return prisma.marchand.upsert({
    where: { utilisateurId: utilisateur.id },
    update: {},
    create: { utilisateurId: utilisateur.id, nomBoutique: 'Boutique Simulation Shopify', statut: 'actif' },
    select: { id: true },
  });
}

// --- Phase A ------------------------------------------------------------------

async function phaseConnexionReelle(marchandId: string): Promise<{ domaine: string; secret: string } | null> {
  console.log('\nA. Connexion réelle à la boutique Shopify');
  const brut = {
    domaine: process.env.SHOPIFY_STORE_DOMAIN,
    jeton: process.env.SHOPIFY_ACCESS_TOKEN,
    cleSecrete: process.env.SHOPIFY_API_SECRET_KEY,
  };
  if (!brut.domaine || !brut.jeton || !brut.cleSecrete) {
    console.log('  – sautée : SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN / SHOPIFY_API_SECRET_KEY absents');
    return null;
  }
  const saisie = validerSaisie(brut);
  const occupee = await prisma.boutiqueShopify.findUnique({ where: { domaine: saisie.domaine } });
  if (occupee && occupee.marchandId !== marchandId) {
    console.log(`  – sautée : ${saisie.domaine} est déjà connectée à un marchand réel`);
    return null;
  }

  const resultat = await connecterBoutique(marchandId, saisie);
  verifier(resultat.infos.domaine === saisie.domaine, `identifiants acceptés par Shopify (${resultat.infos.nom}, ${resultat.infos.devise})`);
  verifier(resultat.synchro !== null, 'produits importés', resultat.erreurSynchro);
  if (resultat.synchro) {
    console.log(`    ${resultat.synchro.variantes} variante(s) : ${resultat.synchro.creees} créée(s), ${resultat.synchro.misesAJour} mise(s) à jour`);
  }
  const boutique = await prisma.boutiqueShopify.findUniqueOrThrow({
    where: { marchandId },
    include: { _count: { select: { marchandises: true } } },
  });
  verifier(!boutique.jetonAccesChiffre.includes('shpat_') && !boutique.cleSecreteChiffree.includes(saisie.cleSecrete), 'secrets chiffrés en base');
  verifier(boutique._count.marchandises === (resultat.synchro?.variantes ?? -1), 'une marchandise liée par variante');
  console.log(
    boutique.webhookId
      ? `    webhook ORDERS_CREATE enregistré chez Shopify → ${boutique.webhookUri}`
      : `    webhook non enregistré : ${boutique.derniereErreur}`
  );

  // Rejouer l'import ne duplique rien.
  const { synchroniserProduits } = await import('../lib/shopify');
  const rejeu = await synchroniserProduits(boutique);
  verifier(rejeu.creees === 0 && rejeu.misesAJour === rejeu.variantes, 'réimport idempotent (aucune création)', rejeu);

  return { domaine: saisie.domaine, secret: saisie.cleSecrete };
}

// --- Phase B ------------------------------------------------------------------

function commande(id: string, surcharges: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: Number(id),
    name: `#S${id.slice(-4)}`,
    currency: 'MAD',
    total_price: '349.00',
    total_outstanding: '349.00',
    financial_status: 'pending',
    payment_gateway_names: ['Cash on Delivery (COD)'],
    total_weight: 800,
    cancelled_at: null,
    shipping_address: {
      name: 'Karim Idrissi',
      phone: '+212 6 55 44 33 22',
      address1: '18 avenue Mohammed V',
      city: 'Casa',
      zip: '20000',
    },
    line_items: [{ title: 'Article simulé', quantity: 1, variant_id: 1, requires_shipping: true }],
    ...surcharges,
  };
}

async function phaseWebhooks(marchandId: string, boutiqueReelle: { domaine: string; secret: string } | null) {
  console.log('\nB. Webhooks simulés');
  let domaine: string;
  let secret: string;
  if (boutiqueReelle) {
    ({ domaine, secret } = boutiqueReelle);
    console.log(`  (boutique réelle ${domaine}, signée avec la vraie clé secrète)`);
  } else {
    domaine = DOMAINE_FICTIF;
    secret = `shpss_simulation_${randomInt(1e9)}`;
    await prisma.boutiqueShopify.create({
      data: {
        marchandId,
        domaine,
        nom: 'Simulation',
        devise: 'MAD',
        jetonAccesChiffre: chiffrer('shpat_fictif'),
        cleSecreteChiffree: chiffrer(secret),
      },
    });
    console.log(`  (boutique fictive ${domaine})`);
  }
  const boutique = await prisma.boutiqueShopify.findUniqueOrThrow({ where: { domaine } });
  const lienVariante = await prisma.marchandiseShopify.findFirst({ where: { boutiqueId: boutique.id } });

  const base = `999${Date.now().toString().slice(-9)}`;
  let compteur = 0;
  const nouvelId = () => `${base}${String(++compteur).padStart(2, '0')}`;
  const envoyer = (corps: Record<string, unknown> | string, options: { sujet?: string; signature?: string | null; domaine?: string; hote?: string } = {}) => {
    const texte = typeof corps === 'string' ? corps : JSON.stringify(corps);
    const entetes: Record<string, string> = {
      'x-shopify-shop-domain': options.domaine ?? domaine,
      'x-shopify-topic': options.sujet ?? 'orders/create',
      'x-shopify-webhook-id': `simu-${randomInt(1e9)}`,
      'x-shopify-api-version': '2026-07',
    };
    const signature = options.signature === undefined ? signer(texte, secret) : options.signature;
    if (signature !== null) entetes['x-shopify-hmac-sha256'] = signature;
    return poster(texte, entetes, options.hote);
  };
  const colisDe = (idCommande: string) =>
    prisma.commande.findMany({
      where: { shopify: { boutiqueId: boutique.id, idCommandeShopify: idCommande } },
      include: { historique: true, shopify: true },
    });

  // 1. Commande COD nominale.
  const id1 = nouvelId();
  const corps1 = commande(id1, lienVariante
    ? { line_items: [{ title: 'Article importé', quantity: 2, variant_id: Number(lienVariante.idVarianteShopify), requires_shipping: true }] }
    : {});
  verifier((await envoyer(corps1)) === 200, 'commande COD : 200');
  const [c1] = await colisDe(id1);
  verifier(!!c1, 'colis créé dans l’espace du marchand');
  if (c1) {
    verifier(c1.marchandId === marchandId, 'rattaché au marchand propriétaire de la boutique');
    verifier(c1.statut === 'nouveau_colis' && c1.codeSuivi.startsWith('PD-'), `statut initial et code de suivi (${c1.codeSuivi})`);
    verifier(Number(c1.montantCod) === 349, 'COD = montant restant dû', c1.montantCod);
    verifier(c1.ville === 'Casablanca' && c1.villeId !== null, '« Casa » normalisée en Casablanca (villeId renseigné)', c1.ville);
    verifier(c1.clientTelephone === '0655443322', 'téléphone ramené au format marocain', c1.clientTelephone);
    verifier(c1.codeSuiviPartenaire === corps1.name, 'référence = numéro de commande Shopify', c1.codeSuiviPartenaire);
    verifier(c1.historique.length === 1, 'état initial historisé');
    verifier(c1.notes?.includes('Ville saisie par le client : « Casa »') ?? false, 'saisie d’origine conservée dans la note', c1.notes);
    if (lienVariante) verifier(c1.marchandiseId === lienVariante.marchandiseId, 'rattaché à la marchandise importée');
  }

  // 2. Rejeu à l'identique.
  verifier((await envoyer(corps1)) === 200, 'rejeu : 200');
  verifier((await colisDe(id1)).length === 1, 'rejeu : aucun doublon');

  // 3. Double livraison SIMULTANÉE.
  const id3 = nouvelId();
  const statuts = await Promise.all([envoyer(commande(id3)), envoyer(commande(id3)), envoyer(commande(id3))]);
  verifier(statuts.every((s) => s === 200), 'trois livraisons simultanées : 200', statuts);
  verifier((await colisDe(id3)).length === 1, 'trois livraisons simultanées : un seul colis');

  // 4-6. Refus d'authenticité.
  const id4 = nouvelId();
  verifier((await envoyer(commande(id4), { signature: signer('autre', secret) })) === 401, 'signature fausse : 401');
  verifier((await envoyer(commande(id4), { signature: null })) === 401, 'signature absente : 401');
  verifier((await envoyer(commande(id4), { domaine: 'inconnue.myshopify.com' })) === 401, 'boutique inconnue : 401');
  verifier((await colisDe(id4)).length === 0, 'aucun colis créé par une requête refusée');

  // 7. Commande prépayée.
  const id7 = nouvelId();
  await envoyer(commande(id7, { total_outstanding: '0.00', financial_status: 'paid', payment_gateway_names: ['shopify_payments'] }));
  const [c7] = await colisDe(id7);
  verifier(!!c7 && Number(c7.montantCod) === 0, 'prépayée : colis à COD 0');
  verifier(c7?.notes?.includes('rien à encaisser') ?? false, 'prépayée : signalée dans la note');

  // 8. Autre devise.
  const id8 = nouvelId();
  await envoyer(commande(id8, { currency: 'USD', total_outstanding: '949.95' }));
  const [c8] = await colisDe(id8);
  verifier(!!c8 && Number(c8.montantCod) === 949.95 && (c8.notes?.includes('USD') ?? false), 'USD : montant repris tel quel, devise en note');

  // 9. Ville inconnue.
  const id9 = nouvelId();
  await envoyer(commande(id9, { shipping_address: { name: 'A', phone: '0611223344', address1: 'x', city: 'Xyzvillé' } }));
  const [c9] = await colisDe(id9);
  verifier(!!c9 && c9.villeId === null && (c9.notes?.includes('non reconnue') ?? false), 'ville inconnue : colis créé quand même, signalé');

  // 10-12. Accusés sans effet.
  const id10 = nouvelId();
  verifier((await envoyer(commande(id10, { cancelled_at: '2026-09-26T10:00:00Z' }))) === 200, 'commande annulée : 200');
  verifier((await colisDe(id10)).length === 0, 'commande annulée : aucun colis');
  verifier((await envoyer(commande(nouvelId()), { sujet: 'products/update' })) === 200, 'autre sujet : 200 sans effet');
  verifier((await envoyer('{ pas du json')) === 200, 'corps illisible mais signé : 200 (rejouer n’y changerait rien)');

  // 13. Cloisonnement : la route n'existe que sur l'hôte de l'API machine.
  verifier((await envoyer(commande(nouvelId()), { hote: SPACE_HOSTS.marchand })) === 404, 'sur l’hôte marchand : 404');

  const journal = await prisma.webhookShopifyRecu.groupBy({
    by: ['issue'],
    where: { boutiqueId: boutique.id },
    _count: true,
  });
  console.log(`    journal : ${journal.map((j) => `${j.issue} × ${j._count}`).join(', ')}`);
  verifier(journal.some((j) => j.issue === 'rejete'), 'les refus sont journalisés');
}

async function main() {
  const marchand = await marchandDeSimulation();
  await purger(marchand.id);
  try {
    const boutiqueReelle = await phaseConnexionReelle(marchand.id);
    await phaseWebhooks(marchand.id, boutiqueReelle);
    if (boutiqueReelle) {
      // Supprime le webhook éventuellement créé chez Shopify.
      await deconnecterBoutique(marchand.id);
    }
  } finally {
    if (GARDER) {
      console.log(`\nDonnées conservées (--garder) sous le marchand ${EMAIL}.`);
    } else {
      await purger(marchand.id);
    }
    await prisma.$disconnect();
  }
  console.log(echecs === 0 ? '\nTous les contrôles passent.' : `\n${echecs} contrôle(s) en échec.`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
