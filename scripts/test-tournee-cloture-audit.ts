import 'dotenv/config';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

// Audit local du circuit "tournée" (§ /admin/bon-distribution + /livreur/colis),
// exécutable via `npx tsx scripts/test-tournee-cloture-audit.ts` avec le
// serveur de dev démarré (BASE_URL, http://localhost:3000 par défaut).
//
// Il rejoue le scénario métier complet de bout en bout, en HTTP réel (donc à
// travers le proxy, les gardes de rôle et les transactions) :
//   1. Le Planner compose une tournée pour un livreur de SON hub.
//   2. Le livreur voit les colis sur sa feuille de route, en livre une partie
//      et marque les autres reportés/annulés ; son récap de session suit.
//   3. Le Planner scanne les retours au dépôt puis clôture : la caisse est
//      bloquée si le cash est inférieur au CRBT, la tournée sort de la
//      feuille de route du livreur, l'historique conserve tout.

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const MDP = 'Test1234!';

// Client HTTP minimal avec bocal à cookies : chaque acteur (planner, livreur)
// a le sien, ce qui reproduit l'isolation des espaces admin/terrain.
function creerClient(space: 'admin' | 'terrain') {
  const cookies = new Map<string, string>();

  async function appel<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'x-pd-space': space };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookies.size > 0) {
      headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
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

  const planner = await prisma.utilisateur.upsert({
    where: { email: 'planner.audit@mathio.test' },
    update: { role: 'planner', hubId: hub.id, actif: true, motDePasseHash },
    create: { nomComplet: 'Planner Audit', email: 'planner.audit@mathio.test', motDePasseHash, role: 'planner', hubId: hub.id },
  });

  const livreur = await prisma.utilisateur.upsert({
    where: { email: 'livreur.audit@mathio.test' },
    update: { role: 'livreur', hubId: hub.id, actif: true, motDePasseHash, fraisLivraison: 15, fraisRefus: 5 },
    create: {
      nomComplet: 'Livreur Audit',
      email: 'livreur.audit@mathio.test',
      motDePasseHash,
      role: 'livreur',
      hubId: hub.id,
      cin: 'AUDIT01',
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
  await prisma.historiqueStatutCommande.deleteMany({ where: { commande: { marchandId: marchand.id } } });
  await prisma.commande.deleteMany({ where: { marchandId: marchand.id } });

  const montants = [300, 500, 1300, 250, 700];
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
  assert.equal(bon.nbColis, 5);

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
  assert.equal(feuille.colis.length, 5, 'Les colis affectés apparaissent immédiatement chez le livreur');
  assert.equal(feuille.recap.nbEnCours, 5);
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
  assert.equal(feuille.recap.nbARetourner, 2);

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
  assert.equal(bilan.colisARecuperer.length, 2);
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
  const retour = await clientPlanner.post<{ dejaScanne: boolean }>(`/api/bons-distribution/${bon.id}/scan-retour`, {
    codeSuivi: colis[3].codeSuivi,
  });
  assert.equal(retour.dejaScanne, false);
  const rejeu = await clientPlanner.post<{ dejaScanne: boolean }>(`/api/bons-distribution/${bon.id}/scan-retour`, {
    codeSuivi: colis[3].codeSuivi,
  });
  assert.equal(rejeu.dejaScanne, true, 'Le rescan doit être idempotent');

  await attendreErreur(
    () => clientPlanner.post(`/api/bons-distribution/${bon.id}/scan-retour`, { codeSuivi: colis[0].codeSuivi }),
    'seul un colis non livré'
  );

  await clientPlanner.post(`/api/bons-distribution/${bon.id}/scan-retour`, { codeSuivi: colis[4].codeSuivi });

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
  // 3 livrés x 15 + 2 retournés x 5 = 55
  assert.equal(bilan.gainLivreur, 55);

  await attendreErreur(
    () => clientPlanner.post(`/api/bons-distribution/${bon.id}/cloturer`, { montantRemis: 2000 }),
    'Manquant de caisse'
  );

  await clientPlanner.post(`/api/bons-distribution/${bon.id}/cloturer`, { montantRemis: 2100 });

  const cloture = await prisma.bonDistribution.findUniqueOrThrow({
    where: { id: bon.id },
    include: { transaction: true },
  });
  assert.equal(cloture.statut, 'cloture');
  assert.equal(cloture.nbColisLivres, 3);
  assert.equal(cloture.nbColisRetournes, 2);
  assert.equal(Number(cloture.montantRemis), 2100);
  assert.equal(Number(cloture.ecartCaisse), 0);
  assert.equal(Number(cloture.gainLivreur), 55);
  assert.equal(cloture.clotureParId, planner.id);
  assert.ok(cloture.transaction, 'Une écriture comptable doit être générée');
  assert.equal(Number(cloture.transaction?.montant), 2100);
  assert.equal(cloture.transaction?.type, 'revenu');

  // --- 8. Après clôture -----------------------------------------------------
  feuille = await clientLivreur.get<Feuille>('/api/livreur/tournee');
  assert.equal(feuille.colis.length, 0, 'La tournée clôturée sort de la feuille de route du livreur');
  assert.equal(feuille.recap.cashEncaisse, '0.00');

  const historique = await clientLivreur.get<{ data: { numero: string }[]; soldeAPayer: string }>(
    '/api/livreur/bons-distribution'
  );
  assert.ok(historique.data.some((t) => t.numero === bon.numero), "L'historique du livreur conserve la tournée");
  assert.equal(Number(historique.soldeAPayer), 55);

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

  console.log('✅ Circuit tournée : 8 volets vérifiés (périmètre planner, affectation, feuille de route, actions terrain, bilan, scan retours, caisse, clôture).');
}

main()
  .catch((err) => {
    console.error('❌', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
