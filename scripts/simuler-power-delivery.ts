import 'dotenv/config';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { prisma } from '../lib/prisma';

/**
 * Simulateur Power Delivery — `npx tsx scripts/simuler-power-delivery.ts`.
 *
 * Toute la chaîne, de bout en bout, contre un FAUX serveur Power démarré ici
 * même : remise d'un bon d'envoi, webhooks passés par le vrai handler (avec
 * signature), suivi, relivraison, retour, correction du COD. Pendant de
 * `simuler-prestataire` pour l'intégration dont c'est NOUS qui appelons.
 *
 * Il n'appelle JAMAIS le vrai Power (POWERDELIVERY_BASE_URL est forcée vers le
 * faux serveur) : chaque vrai `addparcelsnew` déclencherait un ramassage.
 *
 * ⚠️ Il ÉCRIT en base (un marchand et quatre colis de test, à chaque passage),
 * et refuse donc de tourner ailleurs que sur la base de test dédiée
 * `institut_db_power`. Ce qu'il vérifie et que les tests unitaires ne peuvent
 * pas vérifier : l'index partiel sous deux remises simultanées, un historique
 * non doublé au rejeu, la signature du compte de service, la réouverture d'un
 * colis annulé.
 */

const BASE_ATTENDUE = 'institut_db_power';
const PORT = 4010;
const SECRET = 'secret-webhook-de-test-0123456789abcdef';

let ok = 0;
let ko = 0;
function verifier(libelle: string, condition: boolean, detail = ''): void {
  if (condition) ok += 1;
  else ko += 1;
  console.log(`${condition ? '✔' : '✘'} ${libelle}${!condition && detail ? ` — ${detail}` : ''}`);
}

// --- Faux Power ------------------------------------------------------------
const etatsFaux = new Map<string, string>();
const appels: string[] = [];
function fauxPower(): Promise<Server> {
  const serveur = createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      appels.push(`${req.method} ${url.pathname}`);
      const json = corps ? JSON.parse(corps) : {};
      const repondre = (statut: number, o: unknown) => {
        res.writeHead(statut, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      // Leur vraie API ne lit pas l'autorisation de la même façon des deux
      // côtés : `/files/*` n'accepte que « Bearer … », le reste prend le token
      // nu (vérifié le 23/09/2026 contre leur production). Ce faux serveur
      // reproduit l'écart — sinon il confirme notre client au lieu de le mettre
      // à l'épreuve, ce qui est précisément ce qui a laissé passer l'erreur.
      const attendu = url.pathname.startsWith('/files/') ? 'Bearer faux-token' : 'faux-token';
      if (req.headers.authorization !== attendu) return repondre(401, { success: false, message: 'Token invalide' });
      if (url.pathname === '/addparcelsnew') {
        if (json.parcel_receiver === 'REFUS') return repondre(422, { success: false, message: 'Ville invalide' });
        etatsFaux.set(json.parcel_code, 'NEW_PARCEL');
        return repondre(200, { success: true, parcel: { code: json.parcel_code } });
      }
      if (url.pathname === '/trackparcel') {
        const code = url.searchParams.get('parcel_code') ?? '';
        return repondre(200, { success: true, parcel: { code, delivery_status: etatsFaux.get(code) ?? 'NEW_PARCEL', payment_status: 'PAID' } });
      }
      if (['/request-return', '/request-redelivery', '/updateparcel'].includes(url.pathname)) {
        return repondre(200, { success: true, message: 'ok' });
      }
      repondre(404, { success: false, message: 'inconnu' });
    });
  });
  return new Promise((r) => serveur.listen(PORT, '127.0.0.1', () => r(serveur)));
}

async function main(): Promise<void> {
  const base = (await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`)[0].db;
  if (base !== BASE_ATTENDUE) throw new Error(`Refus : base « ${base} », attendue « ${BASE_ATTENDUE} »`);

  process.env.POWERDELIVERY_BASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.POWERDELIVERY_TOKEN = 'faux-token';
  process.env.POWERDELIVERY_WEBHOOK_SECRET = SECRET;
  const serveur = await fauxPower();

  const { remettreBonEnvoiPower } = await import('../lib/remise-power-delivery');
  const actions = await import('../lib/actions-power-delivery');
  const { creerPlateforme } = await import('../lib/plateformes');
  const { POST: webhook } = await import('../app/api/v1/webhooks/power-delivery/route');

  // --- Données --------------------------------------------------------------
  const power = await prisma.prestataire.findUniqueOrThrow({ where: { nom: 'Power Delivery' } });
  if (!(await prisma.plateformePartenaire.findUnique({ where: { prestataireId: power.id } }))) {
    await creerPlateforme('power-delivery', 'Power Delivery', power.id);
  }
  const compte = await prisma.plateformePartenaire.findUniqueOrThrow({ where: { prestataireId: power.id } });
  const admin = await prisma.utilisateur.findFirstOrThrow({ where: { role: 'admin' } });
  const agence = await prisma.hub.findUniqueOrThrow({ where: { nom: 'Agence Rabat' } });

  const suffixe = Date.now().toString().slice(-6);
  const userMarchand = await prisma.utilisateur.create({
    data: { nomComplet: 'Marchand E2E', email: `e2e-${suffixe}@test.local`, motDePasseHash: 'x', role: 'marchand' },
  });
  const marchand = await prisma.marchand.create({ data: { utilisateurId: userMarchand.id, nomBoutique: `Boutique E2E ${suffixe}` } });

  let n = 0;
  const colis = async (ville: string, clientNom = 'Client E2E') =>
    prisma.commande.create({
      data: {
        codeSuivi: `E2E-${suffixe}-${++n}`,
        marchandId: marchand.id,
        clientNom,
        clientTelephone: '0600000000',
        ville,
        adresse: 'Rue test',
        montantCod: 250,
        statut: 'en_transit',
      },
    });
  const kenitra = await colis('Kénitra');
  const temsena = await colis('TEMSENA');
  const refus = await colis('Rabat', 'REFUS');
  const bon = await prisma.bonEnvoi.create({
    data: {
      numero: `BE-E2E-${suffixe}`,
      hubDestinationId: agence.id,
      nbColis: 3,
      commandes: { connect: [{ id: kenitra.id }, { id: temsena.id }, { id: refus.id }] },
    },
  });

  // --- 1. Remise --------------------------------------------------------------
  const r1 = await remettreBonEnvoiPower(bon.id, admin.id);
  const issue = (id: string) => r1.resultats.find((r) => r.commandeId === id)?.issue;
  verifier('Kénitra est remis', issue(kenitra.id) === 'remis', JSON.stringify(r1.resultats));
  verifier('TEMSENA refusée faute d’identifiant', issue(temsena.id) === 'ville_sans_correspondance');
  verifier('un refus de Power est rapporté', issue(refus.id) === 'refuse_par_power');
  const cK = await prisma.commande.findUniqueOrThrow({ where: { id: kenitra.id } });
  verifier('le colis remis passe « Remis à un transporteur »', cK.statut === 'expedier_par_amana', cK.statut);
  const remiseK = await prisma.remisePrestataire.findFirstOrThrow({ where: { commandeId: kenitra.id, active: true } });
  verifier('le code envoyé porte le préfixe MTH-', remiseK.codeEnvoye === `MTH-${kenitra.codeSuivi}`);
  verifier('le COD confié est figé', Number(remiseK.montantCodConfie) === 250);
  const remiseRefus = await prisma.remisePrestataire.findFirstOrThrow({ where: { commandeId: refus.id } });
  verifier('la remise refusée n’est pas active', !remiseRefus.active && remiseRefus.etat === 'refusee');

  // Double clic simultané sur un nouveau bon
  const double = await colis('Temara');
  const bon2 = await prisma.bonEnvoi.create({
    data: { numero: `BE-E2E2-${suffixe}`, hubDestinationId: agence.id, nbColis: 1, commandes: { connect: [{ id: double.id }] } },
  });
  const [a, b] = await Promise.all([remettreBonEnvoiPower(bon2.id, admin.id), remettreBonEnvoiPower(bon2.id, admin.id)]);
  const issues = [a.resultats[0].issue, b.resultats[0].issue].sort();
  const nbRemises = await prisma.remisePrestataire.count({ where: { commandeId: double.id } });
  verifier('deux remises simultanées : une seule passe', nbRemises === 1 && issues.includes('remis'), `${issues} / ${nbRemises} remises`);
  verifier('Power n’a reçu qu’une création pour ce colis', appels.filter((x) => x === 'POST /addparcelsnew').length === 3, appels.join(','));

  // --- 2. Webhooks (par le vrai handler) ------------------------------------
  const envoyer = async (status: string, second = '', opts: { secret?: string; ts?: number; code?: string } = {}) => {
    const corps = JSON.stringify({
      event: 'status_change',
      timestamp: opts.ts ?? Math.floor(Date.now() / 1000),
      parcel: { code: opts.code ?? remiseK.codeEnvoye, status, status_second: second, payment_status: 'NOT_PAID' },
    });
    const sig = createHmac('sha256', opts.secret ?? SECRET).update(corps).digest('hex');
    const rep = await webhook(new Request('http://api/x', { method: 'POST', body: corps, headers: { 'x-webhook-signature': `sha256=${sig}`, 'x-forwarded-for': '10.0.0.1' } }));
    return { statut: rep.status, corps: (await rep.json()) as { issue?: string } };
  };
  const statutK = async () => (await prisma.commande.findUniqueOrThrow({ where: { id: kenitra.id } })).statut;

  let w = await envoyer('DELIVERED', '', { secret: 'faux' });
  verifier('signature fausse → 401', w.statut === 401);
  verifier('…et le colis n’a pas bougé', (await statutK()) === 'expedier_par_amana');
  w = await envoyer('DELIVERED', '', { ts: 1_000_000 });
  verifier('horodatage périmé → 400', w.statut === 400);
  w = await envoyer('PICKED_UP');
  verifier('leur logistique est mémorisée, pas appliquée', w.corps.issue === 'memorise' && (await statutK()) === 'expedier_par_amana');
  w = await envoyer('DISTRIBUTION');
  verifier('DISTRIBUTION → mise en distribution', w.corps.issue === 'applique' && (await statutK()) === 'mise_en_distribution');
  w = await envoyer('DISTRIBUTION');
  verifier('rejeu → inchangé', w.corps.issue === 'inchange');
  w = await envoyer('IN_PROGRESS', 'POSTPONED');
  verifier('IN_PROGRESS + POSTPONED → reporté, sans date', w.corps.issue === 'applique' && (await statutK()) === 'reporte');
  w = await envoyer('ZORGLUB');
  verifier('code inconnu → journalisé, non appliqué', w.corps.issue === 'inconnu' && (await statutK()) === 'reporte');
  w = await envoyer('DELIVERED', '', { code: 'MTH-INCONNU' });
  verifier('colis inconnu → 200 colis_introuvable', w.statut === 200 && w.corps.issue === 'colis_introuvable');
  w = await envoyer('CANCELED');
  verifier('CANCELED → annulé', (await statutK()) === 'annule');
  w = await envoyer('DELIVERED');
  verifier('un statut après annulation est refusé (colis clos)', w.corps.issue === 'refuse' && (await statutK()) === 'annule');

  // --- 3. Relivraison : rouvre l'annulé -----------------------------------
  const rel = await actions.demanderRelivraisonChezPower(kenitra.id, { raison: 'Client rappelé', nouvelleAdresse: 'Nouvelle rue 5', nouveauTelephone: null }, admin.id);
  const cRel = await prisma.commande.findUniqueOrThrow({ where: { id: kenitra.id } });
  verifier('la relivraison rouvre le colis annulé', rel.rouvert && cRel.statut === 'expedier_par_amana', cRel.statut);
  verifier('…et met l’adresse à jour chez nous', cRel.adresse === 'Nouvelle rue 5');
  w = await envoyer('DELIVERED');
  verifier('après réouverture, « livré » s’applique', w.corps.issue === 'applique' && (await statutK()) === 'livre');

  const histo = await prisma.historiqueStatutCommande.findFirstOrThrow({
    where: { commandeId: kenitra.id, nouveauStatut: 'livre' },
  });
  verifier('« livré » est signé du compte de service Power', histo.utilisateurId === compte.utilisateurTechniqueId);
  const nbDistrib = await prisma.historiqueStatutCommande.count({ where: { commandeId: kenitra.id, nouveauStatut: 'mise_en_distribution' } });
  verifier('le rejeu n’a pas doublé l’historique', nbDistrib === 1, String(nbDistrib));

  // --- 4. Suivi et autres actions (colis Temara) --------------------------
  const remiseD = await prisma.remisePrestataire.findFirstOrThrow({ where: { commandeId: double.id, active: true } });
  etatsFaux.set(remiseD.codeEnvoye, 'REFUSE');
  const act = await actions.actualiserColisPower(double.id);
  const cD = await prisma.commande.findUniqueOrThrow({ where: { id: double.id } });
  verifier('Actualiser applique le suivi (REFUSE → refusé)', act.issue === 'applique' && cD.statut === 'refuse', cD.statut);
  const etat = await actions.etatPowerDuColis(double.id);
  verifier('le paiement externe est mémorisé, etatPaiement intact', etat?.dernierPaiementExterne === 'PAID' && cD.etatPaiement === 'non_paye');
  await actions.demanderRetourChezPower(double.id, 'Refusé par le client', admin.id);
  verifier('la demande de retour est tracée', (await actions.etatPowerDuColis(double.id))?.demandeRetourLe instanceof Date);
  await prisma.commande.update({ where: { id: double.id }, data: { montantCod: 300 } });
  const mod = await actions.modifierColisChezPower(double.id, admin.id);
  const remiseD2 = await prisma.remisePrestataire.findUniqueOrThrow({ where: { id: remiseD.id } });
  verifier('une correction du COD est transmise et le COD confié suit', mod.champs.includes('parcel_price') && Number(remiseD2.montantCodConfie) === 300);

  const nbEvts = await prisma.evenementPrestataire.count({ where: { prestataireId: power.id, recuLe: { gte: new Date(Date.now() - 600_000) } } });
  verifier('chaque information reçue est journalisée, rejets compris', nbEvts >= 11, String(nbEvts));

  serveur.close();
  console.log(`\n${ok} réussis, ${ko} échoués`);
  if (ko > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
