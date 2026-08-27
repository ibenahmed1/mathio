import 'dotenv/config';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { creerClient as creerClientHttp } from './audit-http';
import type { SessionSpace } from '../lib/spaces';

// Audit local du circuit "tournée" (§ /admin/bon-distribution + /livreur/colis),
// exécutable via `npx tsx scripts/test-tournee-cloture-audit.ts` avec le
// serveur de dev démarré. Chaque espace ayant son propre hôte depuis la
// séparation par domaines, chaque acteur a son client, qui annonce le `Host`
// de son espace (cf. scripts/audit-http.ts) — c'est ce qui fait que le proxy
// résout le bon espace.
//
// Il rejoue le scénario métier complet de bout en bout, en HTTP réel (donc à
// travers le proxy, les gardes de rôle et les transactions) :
//   1. Le Planner compose une tournée pour un livreur de SON hub.
//   2. Le livreur voit les colis sur sa feuille de route, en livre une partie
//      et marque les autres reportés/annulés ; son récap de session suit.
//   3. Le Planner scanne les retours au dépôt puis clôture : la caisse est
//      bloquée si le cash est inférieur au CRBT, la tournée sort de la
//      feuille de route du livreur, l'historique conserve tout.

const MDP = 'Test1234!';

// Client HTTP minimal avec bocal à cookies : chaque acteur (planner, livreur)
// a le sien et tape sur l'hôte de son espace, ce qui reproduit fidèlement
// l'isolation par domaine (le proxy déduit l'espace du `Host`, plus d'un
// header d'indice envoyé par le client).
function creerClient(space: SessionSpace) {
  // Transport mutualisé avec les autres scripts d'audit (scripts/audit-http.ts) :
  // il forge `Host` et `Origin` et se connecte à 127.0.0.1, ce que `fetch` ne
  // permet pas — et ce sans quoi les sous-domaines `.localhost` des espaces
  // planner et terrain échouent en ENOTFOUND sous Windows.
  const client = creerClientHttp(space);

  async function appel<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await client.api(method, path, body);
    const data = res.json as (T & { error?: string }) | null;
    if (res.status < 200 || res.status >= 300) {
      const message =
        data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      throw Object.assign(new Error(message), { status: res.status });
    }
    return data as T;
  }

  return {
    get: <T>(path: string) => appel<T>('GET', path),
    post: <T>(path: string, body?: unknown) => appel<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => appel<T>('PATCH', path, body),
  };
}

async function attendreErreur(fn: () => Promise<unknown>, extrait: string) {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(
      message.toLowerCase().includes(extrait.toLowerCase()),
      `Message d'erreur inattendu : "${message}" (attendu : contient "${extrait}")`
    );
    return message;
  }
  throw new Error(`Aucune erreur levée, alors qu'on attendait "${extrait}"`);
}

// Supprime les colis du jeu d'audit ET tout ce qui les référence.
//
// Quatre modèles pointent vers Commande (LigneFacture, CommentaireCommande,
// Reclamation, HistoriqueStatutCommande) : n'en purger qu'un suffit à faire
// échouer le deleteMany sur une contrainte de clé étrangère. C'est ce qui est
// arrivé le 24/08/2026, quand une facture émise pendant un test manuel du
// module de facturation a rendu ce script inexécutable — il l'est resté
// jusqu'à ce que quelqu'un s'en aperçoive.
//
// La règle : une facture qui porte sur les colis de « Boutique Audit Tournée »
// est de la donnée de test par construction, ce marchand n'existant que pour
// ce script. On la supprime donc entièrement, écriture comptable comprise —
// et on le DIT à l'écran, parce qu'effacer une facture en silence est
// exactement le genre de chose qu'on ne veut pas découvrir plus tard.
//
// Les réclamations, elles, sont seulement détachées : leur `commandeId` est
// nullable précisément pour ça, et une réclamation reste lisible sans son
// colis.
async function purgerColisAudit(marchandId: string) {
  const factures = await prisma.facture.findMany({
    where: { lignes: { some: { commande: { marchandId } } } },
    select: { id: true, numero: true, statut: true, netAPayer: true, transactionId: true },
  });

  if (factures.length > 0) {
    const resume = factures.map((f) => `${f.numero} (${f.statut}, ${f.netAPayer} DH)`).join(', ');
    console.log(`  ⚠  Purge de ${factures.length} facture(s) portant sur les colis d'audit : ${resume}`);

    const ids = factures.map((f) => f.id);
    await prisma.ligneFacture.deleteMany({ where: { factureId: { in: ids } } });
    await prisma.fraisFacture.deleteMany({ where: { factureId: { in: ids } } });
    await prisma.facture.deleteMany({ where: { id: { in: ids } } });

    // Les écritures comptables partent APRÈS les factures : c'est la facture
    // qui porte la clé étrangère vers la transaction, pas l'inverse.
    const transactionIds = factures.map((f) => f.transactionId).filter((id): id is string => id !== null);
    if (transactionIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { id: { in: transactionIds } } });
    }
  }

  await prisma.reclamation.updateMany({
    where: { commande: { marchandId } },
    data: { commandeId: null },
  });
  await prisma.commentaireCommande.deleteMany({ where: { commande: { marchandId } } });
  await prisma.historiqueStatutCommande.deleteMany({ where: { commande: { marchandId } } });
  await prisma.commande.deleteMany({ where: { marchandId } });
}

async function seed() {
  const motDePasseHash = await bcrypt.hash(MDP, 10);

  const hub = await prisma.hub.upsert({
    where: { nom: 'Hub Audit Tournée' },
    update: {},
    create: { nom: 'Hub Audit Tournée', ville: 'Casablanca' },
  });
  const autreHub = await prisma.hub.upsert({
    where: { nom: 'Hub Audit Tournée (autre)' },
    update: {},
    create: { nom: 'Hub Audit Tournée (autre)', ville: 'Tanger' },
  });
  const ville = await prisma.ville.upsert({
    where: { nom: 'VilleAuditTournee' },
    update: { hubId: hub.id },
    create: { nom: 'VilleAuditTournee', hubId: hub.id },
  });

  // Comptes DÉDIÉS à cet audit (suffixe ".tournee", comme le marchand plus
  // bas). Ils ne doivent jamais être des comptes servant aussi aux tests
  // manuels : le `update` ci-dessous force `hubId` sur le hub de l'audit, donc
  // partager un compte reviendrait à le déplacer de hub à chaque exécution —
  // et le testeur se retrouverait avec des 403 "cette tournée ne relève pas de
  // votre hub" sur ses propres tournées, sans rien avoir changé.
  const planner = await prisma.utilisateur.upsert({
    where: { email: 'planner.audit.tournee@mathio.test' },
    update: { role: 'planner', hubId: hub.id, actif: true, motDePasseHash },
    create: {
      nomComplet: 'Planner Audit Tournée',
      email: 'planner.audit.tournee@mathio.test',
      motDePasseHash,
      role: 'planner',
      hubId: hub.id,
    },
  });

  const livreur = await prisma.utilisateur.upsert({
    where: { email: 'livreur.audit.tournee@mathio.test' },
    update: { role: 'livreur', hubId: hub.id, actif: true, motDePasseHash, fraisLivraison: 15, fraisRefus: 5 },
    create: {
      nomComplet: 'Livreur Audit Tournée',
      email: 'livreur.audit.tournee@mathio.test',
      motDePasseHash,
      role: 'livreur',
      hubId: hub.id,
      cin: 'AUDITTRN1',
      fraisLivraison: 15,
      fraisRefus: 5,
    },
  });

  const marchandUser = await prisma.utilisateur.upsert({
    where: { email: 'marchand.audit.tournee@mathio.test' },
    update: {},
    create: {
      nomComplet: 'Marchand Audit Tournée',
      email: 'marchand.audit.tournee@mathio.test',
      motDePasseHash,
      role: 'marchand',
    },
  });
  const marchand = await prisma.marchand.upsert({
    where: { utilisateurId: marchandUser.id },
    update: {},
    create: { utilisateurId: marchandUser.id, nomBoutique: 'Boutique Audit Tournée', statut: 'actif' },
  });

  // Base propre à chaque exécution : on supprime les colis de l'audit, mais
  // on garde les tournées précédentes — les effacer creuserait un trou dans
  // la numérotation du jour, ce qui n'arrive jamais via l'application.
  await purgerColisAudit(marchand.id);

  // Le 6e colis (900) n'est JAMAIS qualifié par le livreur : il sert à
  // éprouver la dérogation de réintégration directe (§ 6 ci-dessous).
  const montants = [300, 500, 1300, 250, 700, 900];
  const colis = [];
  for (let i = 0; i < montants.length; i++) {
    colis.push(
      await prisma.commande.create({
        data: {
          codeSuivi: `PDAUDIT-${String(i + 1).padStart(3, '0')}`,
          marchandId: marchand.id,
          clientNom: `Client Audit ${i + 1}`,
          clientTelephone: `06990000${i + 1}`,
          ville: 'VilleAuditTournee',
          villeId: ville.id,
          adresse: `${i + 1} rue de l'Audit`,
          montantCod: montants[i],
          statut: 'recu_au_hub',
          hubActuelId: hub.id,
        },
      })
    );
  }

  return { hub, autreHub, planner, livreur, colis };
}

async function main() {
  const { hub, autreHub, planner, livreur, colis } = await seed();

  // Le Planner travaille désormais dans le back-office (§ lib/spaces.ts,
  // trois espaces) : sa session s'ouvre sur l'hôte admin, comme celle de
  // n'importe quel rôle interne.
  const clientPlanner = creerClient('admin');
  const clientLivreur = creerClient('terrain');

  await clientPlanner.post('/api/auth/login', { telephone: planner.email, secret: MDP });
  await clientLivreur.post('/api/auth/login', { telephone: livreur.email, secret: MDP });

  // --- 1. Périmètre du Planner ---------------------------------------------
  const zones = await clientPlanner.get<{ data: { id: string; nom: string }[] }>('/api/bons-distribution/zones');
  assert.equal(zones.data.length, 1, 'Le planner ne doit voir que son hub');
  assert.equal(zones.data[0].id, hub.id);

  // Le hub fourni dans la requête est ignoré au profit de son hub de
  // rattachement : impossible de planifier pour un autre dépôt.
  const livreurs = await clientPlanner.get<{ data: { id: string }[] }>(
    `/api/bons-distribution/livreurs?hubId=${autreHub.id}`
  );
  assert.ok(
    livreurs.data.some((l) => l.id === livreur.id),
    'Le hubId de la query ne doit pas déplacer le périmètre du planner'
  );

  // --- 2. Création de la tournée -------------------------------------------
  const bon = await clientPlanner.post<{ id: string; numero: string; nbColis: number }>('/api/bons-distribution', {
    hubId: hub.id,
    livreurId: livreur.id,
    colisIds: colis.map((c) => c.id),
  });
  assert.equal(bon.nbColis, 6);

  const apresAffectation = await prisma.commande.findMany({
    where: { bonDistributionId: bon.id },
    select: { statut: true, livreurId: true },
  });
  assert.ok(apresAffectation.every((c) => c.statut === 'mise_en_distribution' && c.livreurId === livreur.id));

  const histoAffectation = await prisma.historiqueStatutCommande.findFirst({
    where: { commandeId: colis[0].id, nouveauStatut: 'mise_en_distribution' },
  });
  assert.ok(histoAffectation?.note?.includes(bon.numero), "L'historique doit nommer la tournée");
  assert.ok(histoAffectation?.note?.includes('Planner Audit'), "L'historique doit nommer le planificateur");

  // --- 3. Feuille de route du livreur --------------------------------------
  type Feuille = {
    tournees: { numero: string }[];
    colis: { id: string; statut: string }[];
    recap: { nbColis: number; nbLivres: number; nbEnCours: number; nbARetourner: number; cashEncaisse: string };
  };
  let feuille = await clientLivreur.get<Feuille>('/api/livreur/tournee');
  assert.equal(feuille.colis.length, 6, 'Les colis affectés apparaissent immédiatement chez le livreur');
  assert.equal(feuille.recap.nbEnCours, 6);
  assert.equal(feuille.recap.cashEncaisse, '0.00');

  // --- 4. Exécution terrain -------------------------------------------------
  const preuve = 'data:image/png;base64,iVBORw0KGgo=';
  for (const c of colis.slice(0, 3)) {
    await clientLivreur.patch(`/api/livreur/colis/${c.id}/statut`, { action: 'livre', photoPreuveUrl: preuve });
  }
  await clientLivreur.patch(`/api/livreur/colis/${colis[3].id}/statut`, {
    action: 'reporte',
    motif: 'Client absent',
    dateNouvelleLivraison: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  });
  await clientLivreur.patch(`/api/livreur/colis/${colis[4].id}/statut`, { action: 'annule', motif: 'Refusé' });

  await attendreErreur(
    () => clientLivreur.patch(`/api/livreur/colis/${colis[0].id}/statut`, { action: 'livre', photoPreuveUrl: preuve }),
    "n'est pas en cours de distribution"
  );

  feuille = await clientLivreur.get<Feuille>('/api/livreur/tournee');
  assert.equal(feuille.recap.nbLivres, 3);
  assert.equal(feuille.recap.cashEncaisse, '2100.00', 'Cash brut = 300 + 500 + 1300');
  assert.equal(feuille.recap.nbARetourner, 2, 'Le colis jamais qualifié est compté "en cours", pas "à retourner"');
  assert.equal(feuille.recap.nbEnCours, 1, 'Le 6e colis reste "mise en distribution"');

  // Le cash en main du livreur avant déchargement : c'est le montant qu'il
  // devra remettre au Planner.
  const caisseAvant = await clientLivreur.get<{ total: string }>('/api/livreur/caisse');
  assert.equal(caisseAvant.total, '2100.00');

  // --- 5. Bilan côté Planner ------------------------------------------------
  type Bilan = {
    montantCrbtAttendu: number;
    gainLivreur: number;
    colisARecuperer: { codeSuivi: string }[];
    colisRetournes: unknown[];
    pretACloturer: boolean;
  };
  let bilan = await clientPlanner.get<Bilan>(`/api/bons-distribution/${bon.id}/bilan`);
  assert.equal(bilan.montantCrbtAttendu, 2100);
  // Reporté + annulé + le colis jamais qualifié : tout ce qui n'est pas livré
  // doit revenir physiquement au dépôt.
  assert.equal(bilan.colisARecuperer.length, 3);
  assert.equal(bilan.pretACloturer, false);
  // Avant scan des retours : seules les livraisons rémunèrent (3 x 15).
  assert.equal(bilan.gainLivreur, 45);

  await attendreErreur(
    () => clientPlanner.post(`/api/bons-distribution/${bon.id}/cloturer`, { montantRemis: 2100 }),
    'pas encore été scannés'
  );

  // Preuve de livraison (RG-02) : consultable par le Planner pour le colis
  // dont il encaisse le CRBT, et refusée pour un colis d'une autre tournée.
  const preuveColis = await clientPlanner.get<{ photoPreuveUrl: string | null; signatureUrl: string | null }>(
    `/api/bons-distribution/${bon.id}/preuve?commandeId=${colis[0].id}`
  );
  assert.equal(preuveColis.photoPreuveUrl, preuve, 'La photo de livraison doit être restituée');
  await attendreErreur(
    () => clientPlanner.get(`/api/bons-distribution/${bon.id}/preuve?commandeId=${planner.id}`),
    "n'appartient pas à cette tournée"
  );

  // --- 6. Scan des retours --------------------------------------------------
  type Retour = { dejaScanne: boolean; parDerogation: boolean };

  const retour = await clientPlanner.post<Retour>(`/api/bons-distribution/${bon.id}/scan-retour`, {
    codeSuivi: colis[3].codeSuivi,
  });
  assert.equal(retour.dejaScanne, false);
  assert.equal(retour.parDerogation, false, 'Un colis qualifié par le livreur ne relève pas de la dérogation');
  const rejeu = await clientPlanner.post<Retour>(`/api/bons-distribution/${bon.id}/scan-retour`, {
    codeSuivi: colis[3].codeSuivi,
  });
  assert.equal(rejeu.dejaScanne, true, 'Le rescan doit être idempotent');

  // Frontière dure : un colis livré ne revient jamais au dépôt par un scan,
  // quel que soit le rôle.
  await attendreErreur(
    () => clientPlanner.post(`/api/bons-distribution/${bon.id}/scan-retour`, { codeSuivi: colis[0].codeSuivi }),
    'ne peut jamais être scanné en retour au Hub'
  );

  await clientPlanner.post(`/api/bons-distribution/${bon.id}/scan-retour`, { codeSuivi: colis[4].codeSuivi });

  // Dérogation : le 6e colis est encore "mise_en_distribution" — le livreur ne
  // l'a jamais qualifié. Le Planner peut le réintégrer directement, et
  // l'historique doit le dire explicitement.
  // (Le refus pour un rôle non habilité n'est pas testable ici : la route
  // n'admet déjà que admin/planner, la vérification explicite du scan est une
  // garde pour le jour où le module s'ouvrirait à un rôle de plus.)
  const derogation = await clientPlanner.post<Retour>(`/api/bons-distribution/${bon.id}/scan-retour`, {
    codeSuivi: colis[5].codeSuivi,
  });
  assert.equal(derogation.parDerogation, true, 'Un colis non qualifié passe par la dérogation');

  const histoDerogation = await prisma.historiqueStatutCommande.findFirst({
    where: { commandeId: colis[5].id, nouveauStatut: 'retourne_au_hub' },
  });
  assert.ok(
    histoDerogation?.note?.includes('Réintégration directe par dérogation Planner/Admin'),
    "La réintégration forcée doit être tracée comme telle, pas comme un retour terrain ordinaire"
  );
  assert.equal(histoDerogation?.ancienStatut, 'mise_en_distribution');

  const retourne = await prisma.commande.findUniqueOrThrow({ where: { id: colis[3].id } });
  assert.equal(retourne.statut, 'retourne_au_hub');
  assert.equal(retourne.hubActuelId, hub.id);
  assert.equal(retourne.motifRetour, 'Client absent', 'Le motif terrain est conservé, pas écrasé');

  const histoRetour = await prisma.historiqueStatutCommande.findFirst({
    where: { commandeId: colis[3].id, nouveauStatut: 'retourne_au_hub' },
  });
  assert.ok(histoRetour?.note?.includes('Planner Audit'));
  assert.equal(histoRetour?.hubId, hub.id);

  // --- 7. Clôture : caisse bloquée si le cash manque ------------------------
  bilan = await clientPlanner.get<Bilan>(`/api/bons-distribution/${bon.id}/bilan`);
  assert.equal(bilan.pretACloturer, true);
  // 3 livrés x 15 + 3 retournés x 5 = 60
  assert.equal(bilan.gainLivreur, 60);

  await attendreErreur(
    () => clientPlanner.post(`/api/bons-distribution/${bon.id}/cloturer`, { montantRemis: 2000 }),
    'Manquant de caisse'
  );

  // Le solde à payer est cumulatif et le seed conserve volontairement les
  // tournées des exécutions précédentes (pour ne pas trouer la numérotation) :
  // on mesure donc l'écart apporté par CETTE clôture, pas une valeur absolue.
  const soldeAvant = await clientLivreur.get<{ soldeAPayer: string }>('/api/livreur/bons-distribution');

  await clientPlanner.post(`/api/bons-distribution/${bon.id}/cloturer`, { montantRemis: 2100 });

  const cloture = await prisma.bonDistribution.findUniqueOrThrow({
    where: { id: bon.id },
    include: { transaction: true },
  });
  assert.equal(cloture.statut, 'cloture');
  assert.equal(cloture.nbColisLivres, 3);
  assert.equal(cloture.nbColisRetournes, 3);
  assert.equal(Number(cloture.montantRemis), 2100);
  assert.equal(Number(cloture.ecartCaisse), 0);
  assert.equal(Number(cloture.gainLivreur), 60);
  assert.equal(cloture.clotureParId, planner.id);
  assert.ok(cloture.transaction, 'Une écriture comptable doit être générée');
  assert.equal(Number(cloture.transaction?.montant), 2100);
  assert.equal(cloture.transaction?.type, 'revenu');

  // --- 8. Après clôture -----------------------------------------------------
  feuille = await clientLivreur.get<Feuille>('/api/livreur/tournee');
  assert.equal(feuille.colis.length, 0, 'La tournée clôturée sort de la feuille de route du livreur');
  assert.equal(feuille.recap.cashEncaisse, '0.00');

  // L'application du livreur se remet à zéro : ni les colis du circuit clos,
  // ni le cash déjà remis au Planner n'y subsistent.
  const colisLivreur = await clientLivreur.get<{ data: unknown[] }>('/api/livreur/colis');
  assert.equal(colisLivreur.data.length, 0, 'Les colis du circuit clôturé disparaissent de la liste du livreur');
  const caisseApres = await clientLivreur.get<{ total: string }>('/api/livreur/caisse');
  assert.equal(caisseApres.total, '0.00', 'Le cash remis au Planner ne compte plus dans la caisse du livreur');

  // Seul l'écran d'historique/reddition conserve la tournée — c'est lui qui
  // porte le solde à payer du livreur.
  const historique = await clientLivreur.get<{
    data: { numero: string; gainLivreur: string | null }[];
    soldeAPayer: string;
  }>('/api/livreur/bons-distribution');
  const tourneeHistorique = historique.data.find((t) => t.numero === bon.numero);
  assert.ok(tourneeHistorique, "L'historique du livreur conserve la tournée");
  assert.equal(Number(tourneeHistorique.gainLivreur), 60);
  assert.equal(
    Number(historique.soldeAPayer) - Number(soldeAvant.soldeAPayer),
    60,
    'La clôture crédite le gain de la tournée au solde à payer du livreur'
  );

  await attendreErreur(
    () => clientPlanner.post(`/api/bons-distribution/${bon.id}/scan-retour`, { codeSuivi: colis[3].codeSuivi }),
    'déjà clôturée'
  );
  await attendreErreur(
    () => clientPlanner.post(`/api/bons-distribution/${bon.id}/cloturer`, { montantRemis: 2100 }),
    'déjà clôturée'
  );

  // Traçabilité globale : la fiche colis garde tout le circuit.
  const circuit = await prisma.historiqueStatutCommande.findMany({
    where: { commandeId: colis[3].id },
    orderBy: { horodatage: 'asc' },
    select: { nouveauStatut: true },
  });
  assert.deepEqual(
    circuit.map((h) => h.nouveauStatut),
    ['mise_en_distribution', 'reporte', 'retourne_au_hub']
  );

  // Le colis réintégré par dérogation n'a jamais eu d'état terrain : il passe
  // directement de "mise en distribution" au dépôt.
  const circuitDerogation = await prisma.historiqueStatutCommande.findMany({
    where: { commandeId: colis[5].id },
    orderBy: { horodatage: 'asc' },
    select: { nouveauStatut: true },
  });
  assert.deepEqual(
    circuitDerogation.map((h) => h.nouveauStatut),
    ['mise_en_distribution', 'retourne_au_hub']
  );

  console.log('✅ Circuit tournée : 8 volets vérifiés (périmètre planner, affectation, feuille de route, actions terrain, bilan, scan retours dont dérogation, caisse, clôture + remise à zéro côté livreur).');
}

main()
  .catch((err) => {
    console.error('❌', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
