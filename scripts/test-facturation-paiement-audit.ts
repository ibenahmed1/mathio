import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { api, attendreServeur, sessionOuverte } from './audit-http';

// Audit local des DEUX circuits d'argent, exécutable via
//   npx tsx scripts/test-facturation-paiement-audit.ts
// avec un serveur de développement en cours (npm run dev) — cf.
// scripts/audit-http.ts pour la configuration d'hôte.
//
//   Volet 1 — facturation marchand : ce que la plateforme DOIT au marchand
//             (COD encaissé moins les frais).
//   Volet 2 — bon de paiement livreur : ce que la plateforme DOIT au livreur
//             (commissions de tournée plus ou moins les ajustements).
//
// Ces deux circuits sont les seuls du dépôt à créer des écritures comptables
// (Transaction) et à changer l'état de paiement d'un colis. Les tests
// unitaires de lib/__tests__ couvrent leurs fonctions PURES ; ce script couvre
// ce que le pur ne peut pas atteindre : les transactions Prisma, le cycle de
// vie des documents (brouillon → émis → payé → annulé), et surtout les
// invariants de NON-RÉPÉTITION — un colis facturé deux fois ou une tournée
// payée deux fois sont les deux erreurs qui coûtent réellement de l'argent.
//
// Comme scripts/test-reception-stock-audit.ts, il tape les VRAIES routes HTTP
// plutôt que de rejouer leur logique : l'orchestration (garde d'état, ordre
// des écritures, motif obligatoire) vit dans les handlers, pas dans lib/.
//
// Toutes les données créées sont préfixées et supprimées en fin d'exécution,
// succès ou échec.

const PREFIXE = `AUDIT-${Date.now()}`;
const MOT_DE_PASSE = 'Audit1234!';

// Période de paie auditée : un mois RÉVOLU, sinon POST /api/bons-paiement/generer
// exige `autoriserPeriodeOuverte` et l'audit testerait un autre chemin.
const PERIODE = { annee: 2026, mois: 7 };
const DANS_LA_PERIODE = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));

let reussis = 0;
let echoues = 0;

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

function egal(reel: unknown, espere: unknown, quoi: string) {
  if (reel !== espere) throw new Error(`${quoi} = ${String(reel)}, attendu ${String(espere)}`);
}

// --- Jeu de données ---------------------------------------------------------

let compteurCode = 0;
function codeSuivi() {
  compteurCode += 1;
  return `${PREFIXE}-C${compteurCode}`;
}

async function creerJeuDeDonnees() {
  const hash = await bcrypt.hash(MOT_DE_PASSE, 10);

  const admin = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Comptable`,
      email: `${PREFIXE.toLowerCase()}-admin@audit.local`,
      motDePasseHash: hash,
      role: 'admin',
    },
  });

  const hub = await prisma.hub.create({
    data: { nom: `${PREFIXE} Hub`, ville: 'Casablanca' },
  });

  // Marchand « normal » : frais 30 / 15, net à payer positif.
  const userMarchand = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Marchand`,
      email: `${PREFIXE.toLowerCase()}-marchand@audit.local`,
      motDePasseHash: hash,
      role: 'marchand',
    },
  });
  const marchand = await prisma.marchand.create({
    data: {
      utilisateurId: userMarchand.id,
      nomBoutique: `${PREFIXE} Boutique`,
      statut: 'actif',
      fraisLivraison: 30,
      fraisRetour: 15,
    },
  });

  // Marchand « en dette » : frais de retour supérieurs à tout COD encaissé —
  // sert à vérifier que l'écriture comptable s'INVERSE au lieu d'enregistrer
  // une sortie de caisse qui n'a pas lieu.
  const userDebiteur = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Debiteur`,
      email: `${PREFIXE.toLowerCase()}-debiteur@audit.local`,
      motDePasseHash: hash,
      role: 'marchand',
    },
  });
  const debiteur = await prisma.marchand.create({
    data: {
      utilisateurId: userDebiteur.id,
      nomBoutique: `${PREFIXE} Boutique Debitrice`,
      statut: 'actif',
      fraisLivraison: 30,
      fraisRetour: 500,
    },
  });

  const livreur = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Livreur`,
      email: `${PREFIXE.toLowerCase()}-livreur@audit.local`,
      motDePasseHash: hash,
      role: 'livreur',
      hubId: hub.id,
    },
  });

  const livreurBis = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Livreur Bis`,
      email: `${PREFIXE.toLowerCase()}-livreur2@audit.local`,
      motDePasseHash: hash,
      role: 'livreur',
      hubId: hub.id,
    },
  });

  async function creerColis(
    marchandId: string,
    statut: 'livre' | 'retourne' | 'en_cours',
    montantCod: number
  ) {
    return prisma.commande.create({
      data: {
        marchandId,
        codeSuivi: codeSuivi(),
        clientNom: `${PREFIXE} Client`,
        clientTelephone: '0600000000',
        ville: 'Casablanca',
        adresse: 'Adresse de test',
        montantCod,
        statut,
        dateLivraison: statut === 'livre' ? DANS_LA_PERIODE : null,
      },
    });
  }

  // Lot 1 : la facture nominale (2 livrés + 1 retourné).
  const lot1 = [
    await creerColis(marchand.id, 'livre', 250),
    await creerColis(marchand.id, 'livre', 400),
    await creerColis(marchand.id, 'retourne', 300),
  ];
  // Colis NON terminal : ne doit jamais entrer dans une assiette facturable.
  const colisEnCours = await creerColis(marchand.id, 'en_cours', 999);
  // Lot 2 : sert au cycle émission → annulation → refacturation.
  const lot2 = [await creerColis(marchand.id, 'livre', 100)];
  // Lot 3 : le marchand débiteur.
  const lot3 = [await creerColis(debiteur.id, 'retourne', 0)];

  async function creerTournee(livreurId: string, numero: string, gain: number, livres: number, retournes: number) {
    return prisma.bonDistribution.create({
      data: {
        numero,
        livreurId,
        hubId: hub.id,
        statut: 'cloture',
        nbColis: livres + retournes,
        nbColisLivres: livres,
        nbColisRetournes: retournes,
        gainLivreur: gain,
        dateGeneration: DANS_LA_PERIODE,
        dateCloture: DANS_LA_PERIODE,
      },
    });
  }

  const tournees = [
    await creerTournee(livreur.id, `${PREFIXE}-T1`, 150.5, 12, 3),
    await creerTournee(livreur.id, `${PREFIXE}-T2`, 200.25, 18, 1),
  ];
  const tourneesBis = [await creerTournee(livreurBis.id, `${PREFIXE}-T3`, 99.75, 8, 2)];

  return {
    admin,
    hub,
    marchand,
    debiteur,
    livreur,
    livreurBis,
    lot1,
    lot2,
    lot3,
    colisEnCours,
    tournees,
    tourneesBis,
    utilisateurIds: [admin.id, userMarchand.id, userDebiteur.id, livreur.id, livreurBis.id],
    marchandIds: [marchand.id, debiteur.id],
  };
}

async function nettoyer(ids: { utilisateurIds: string[]; marchandIds: string[]; hubId: string }) {
  const factures = await prisma.facture.findMany({
    where: { marchandId: { in: ids.marchandIds } },
    select: { id: true },
  });
  const factureIds = factures.map((f) => f.id);
  const bons = await prisma.bonPaiement.findMany({
    where: { livreurId: { in: ids.utilisateurIds } },
    select: { id: true },
  });
  const bonIds = bons.map((b) => b.id);

  await prisma.ajustementBonPaiement.deleteMany({ where: { bonPaiementId: { in: bonIds } } });
  await prisma.ligneFacture.deleteMany({ where: { factureId: { in: factureIds } } });
  await prisma.fraisFacture.deleteMany({ where: { factureId: { in: factureIds } } });

  // Les documents portent une FK vers Transaction : ils partent AVANT elle.
  await prisma.commande.deleteMany({ where: { marchandId: { in: ids.marchandIds } } });
  await prisma.bonDistribution.deleteMany({ where: { hubId: ids.hubId } });
  await prisma.facture.deleteMany({ where: { id: { in: factureIds } } });
  await prisma.bonPaiement.deleteMany({ where: { id: { in: bonIds } } });
  await prisma.transaction.deleteMany({ where: { auteurId: { in: ids.utilisateurIds } } });

  await prisma.hub.deleteMany({ where: { id: ids.hubId } });
  await prisma.marchand.deleteMany({ where: { id: { in: ids.marchandIds } } });
  await prisma.auditLog.deleteMany({ where: { adminId: { in: ids.utilisateurIds } } });
  await prisma.utilisateur.deleteMany({ where: { id: { in: ids.utilisateurIds } } });
}

// --- Audit ------------------------------------------------------------------

async function main() {
  console.log(`\n§ Audit facturation & bons de paiement — ${PREFIXE}\n`);
  await attendreServeur();

  const jeu = await creerJeuDeDonnees();
  const { admin, hub, marchand, debiteur, livreur, livreurBis, lot1, lot2, lot3, colisEnCours } = jeu;

  let factureId = '';
  let facture2Id = '';
  let bonId = '';
  let bonBisId = '';

  try {
    console.log('0. Session');
    await verifie('connexion du comptable', async () => {
      const r = await api('POST', '/api/auth/login', { telephone: admin.email, secret: MOT_DE_PASSE });
      attendu(r.status === 200, `login refusé (${r.status}) : ${r.texte.slice(0, 200)}`);
      attendu(sessionOuverte(), 'aucun cookie de session posé');
    });

    // =================================================================
    console.log('\n1. Facturation marchand');
    // =================================================================

    await verifie('assiette : les colis terminaux seulement, aux bons tarifs', async () => {
      const r = await api('POST', '/api/factures', { marchandId: marchand.id, colisIds: lot1.map((c) => c.id) });
      attendu(r.status === 201, `création refusée (${r.status}) : ${r.texte.slice(0, 250)}`);
      factureId = String(r.json?.id ?? '');

      const f = await prisma.facture.findUniqueOrThrow({ where: { id: factureId } });
      egal(f.statut, 'brouillon', 'statut');
      egal(f.nbColisLivres, 2, 'nbColisLivres');
      egal(f.nbColisRetournes, 1, 'nbColisRetournes');
      // 250 + 400 encaissés ; le retourné n'apporte rien.
      egal(Number(f.totalCod), 650, 'totalCod');
      egal(Number(f.totalFraisLivraison), 60, 'totalFraisLivraison');
      egal(Number(f.totalFraisRetour), 15, 'totalFraisRetour');
      egal(Number(f.netAPayer), 575, 'netAPayer');
    });

    await verifie('un colis non terminal reste hors de toute assiette', async () => {
      const c = await prisma.commande.findUniqueOrThrow({ where: { id: colisEnCours.id } });
      egal(c.etatPaiement, 'non_paye', 'etatPaiement du colis en cours');
      const ligne = await prisma.ligneFacture.findFirst({ where: { commandeId: colisEnCours.id } });
      attendu(ligne === null, 'un colis « en cours » a été facturé');
    });

    // L'invariant le plus coûteux du module : reverser deux fois le même COD.
    await verifie('double facturation impossible sur les mêmes colis', async () => {
      const r = await api('POST', '/api/factures', { marchandId: marchand.id, colisIds: lot1.map((c) => c.id) });
      egal(r.status, 409, 'statut de la seconde facturation');

      const lignes = await prisma.ligneFacture.count({ where: { commandeId: { in: lot1.map((c) => c.id) } } });
      egal(lignes, 3, 'nombre de lignes de facture pour ces colis');
    });

    await verifie('émission : montants figés, statut émise', async () => {
      const r = await api('POST', `/api/factures/${factureId}/emettre`);
      attendu(r.status === 200, `émission refusée (${r.status}) : ${r.texte.slice(0, 250)}`);

      const f = await prisma.facture.findUniqueOrThrow({ where: { id: factureId } });
      egal(f.statut, 'emise', 'statut');
      egal(Number(f.netAPayer), 575, 'netAPayer après émission');
      attendu(f.dateValidation !== null, 'dateValidation non renseignée');
    });

    await verifie('règlement par virement sans référence : refusé', async () => {
      const r = await api('POST', `/api/factures/${factureId}/payer`, { modeReglement: 'virement' });
      egal(r.status, 400, 'statut');

      const f = await prisma.facture.findUniqueOrThrow({ where: { id: factureId } });
      egal(f.statut, 'emise', 'statut après refus');
    });

    await verifie('règlement : écriture de sortie de caisse et colis payés', async () => {
      const r = await api('POST', `/api/factures/${factureId}/payer`, {
        modeReglement: 'virement',
        referenceReglement: `VIR-${PREFIXE}`,
      });
      attendu(r.status === 200, `règlement refusé (${r.status}) : ${r.texte.slice(0, 250)}`);

      const f = await prisma.facture.findUniqueOrThrow({
        where: { id: factureId },
        include: { transaction: true },
      });
      egal(f.statut, 'payee', 'statut');
      attendu(f.transaction !== null, 'aucune écriture comptable créée');
      egal(f.transaction!.type, 'depense', 'type de transaction');
      egal(f.transaction!.categorie, 'paiement_client', 'catégorie');
      egal(Number(f.transaction!.montant), 575, 'montant de la transaction');

      const payes = await prisma.commande.count({
        where: { id: { in: lot1.map((c) => c.id) }, etatPaiement: 'paye' },
      });
      egal(payes, 3, 'colis passés à « payé »');
    });

    await verifie('annuler une facture déjà réglée : refusé', async () => {
      const r = await api('POST', `/api/factures/${factureId}/annuler`, { motif: 'test' });
      egal(r.status, 409, 'statut');

      const f = await prisma.facture.findUniqueOrThrow({ where: { id: factureId } });
      egal(f.statut, 'payee', 'statut après refus');
    });

    await verifie('annulation d’une facture émise : motif obligatoire', async () => {
      const creation = await api('POST', '/api/factures', {
        marchandId: marchand.id,
        colisIds: lot2.map((c) => c.id),
        finaliser: 'emise',
      });
      attendu(creation.status === 201, `création refusée (${creation.status}) : ${creation.texte.slice(0, 200)}`);
      facture2Id = String(creation.json?.id ?? '');

      const sansMotif = await api('POST', `/api/factures/${facture2Id}/annuler`, {});
      egal(sansMotif.status, 400, 'statut sans motif');
    });

    await verifie('annulation : les colis redeviennent facturables', async () => {
      const r = await api('POST', `/api/factures/${facture2Id}/annuler`, { motif: 'Erreur de périmètre' });
      attendu(r.status === 200, `annulation refusée (${r.status}) : ${r.texte.slice(0, 200)}`);

      const f = await prisma.facture.findUniqueOrThrow({ where: { id: facture2Id } });
      egal(f.statut, 'annulee', 'statut');

      const colis = await prisma.commande.findUniqueOrThrow({ where: { id: lot2[0].id } });
      egal(colis.etatPaiement, 'non_paye', 'état de paiement du colis libéré');
      const ligne = await prisma.ligneFacture.findFirst({ where: { commandeId: lot2[0].id } });
      attendu(ligne === null, 'la ligne de facture n’a pas été supprimée');

      // Preuve par l'usage : il est de nouveau facturable.
      const refacture = await api('POST', '/api/factures', {
        marchandId: marchand.id,
        colisIds: lot2.map((c) => c.id),
      });
      egal(refacture.status, 201, 'statut de la refacturation');
    });

    // Frais de retour 500 contre 0 encaissé : la plateforme ne DOIT rien, c'est
    // le marchand qui doit. L'écriture doit s'inverser en recette.
    await verifie('net négatif : l’écriture s’inverse en recette', async () => {
      const r = await api('POST', '/api/factures', {
        marchandId: debiteur.id,
        colisIds: lot3.map((c) => c.id),
        finaliser: 'payee',
        modeReglement: 'especes',
      });
      attendu(r.status === 201, `création refusée (${r.status}) : ${r.texte.slice(0, 250)}`);

      const f = await prisma.facture.findUniqueOrThrow({
        where: { id: String(r.json?.id) },
        include: { transaction: true },
      });
      egal(Number(f.netAPayer), -500, 'netAPayer');
      attendu(f.transaction !== null, 'aucune écriture comptable créée');
      egal(f.transaction!.type, 'revenu', 'type de transaction');
      egal(Number(f.transaction!.montant), 500, 'montant (valeur absolue)');
    });

    // =================================================================
    console.log('\n2. Bon de paiement livreur');
    // =================================================================

    await verifie('génération : gains totalisés, tournées rattachées', async () => {
      const r = await api('POST', '/api/bons-paiement/generer', PERIODE);
      attendu(r.status === 200, `génération refusée (${r.status}) : ${r.texte.slice(0, 250)}`);

      const bon = await prisma.bonPaiement.findFirst({
        where: { livreurId: livreur.id },
        include: { tournees: true },
      });
      attendu(bon !== null, 'aucun bon généré pour le livreur');
      bonId = bon!.id;
      egal(bon!.statut, 'brouillon', 'statut');
      egal(bon!.nbTournees, 2, 'nbTournees');
      egal(Number(bon!.montantCommissions), 350.75, 'montantCommissions');
      egal(Number(bon!.montantTotal), 350.75, 'montantTotal');
      egal(bon!.tournees.length, 2, 'tournées rattachées');
    });

    // Un livreur payé deux fois pour le même mois est le pendant exact de la
    // double facturation côté marchand.
    await verifie('régénération sur la même période : aucun doublon', async () => {
      const r = await api('POST', '/api/bons-paiement/generer', PERIODE);
      attendu(r.status === 200, `génération refusée (${r.status}) : ${r.texte.slice(0, 250)}`);

      const bons = await prisma.bonPaiement.count({ where: { livreurId: livreur.id } });
      egal(bons, 1, 'nombre de bons pour ce livreur sur la période');
    });

    await verifie('ajustements : la prime ajoute, la pénalité retranche', async () => {
      const prime = await api('POST', `/api/bons-paiement/${bonId}/ajustements`, {
        type: 'prime',
        libelle: 'Prime de ponctualité',
        montant: 100,
      });
      attendu(prime.status < 300, `prime refusée (${prime.status}) : ${prime.texte.slice(0, 200)}`);

      const penalite = await api('POST', `/api/bons-paiement/${bonId}/ajustements`, {
        type: 'penalite',
        libelle: 'Colis endommagé',
        montant: 50.25,
      });
      attendu(penalite.status < 300, `pénalité refusée (${penalite.status}) : ${penalite.texte.slice(0, 200)}`);

      const bon = await prisma.bonPaiement.findUniqueOrThrow({ where: { id: bonId } });
      egal(Number(bon.totalAjustements), 49.75, 'totalAjustements');
      egal(Number(bon.montantCommissions), 350.75, 'montantCommissions (ne doit pas bouger)');
      egal(Number(bon.montantTotal), 400.5, 'montantTotal');
    });

    await verifie('payer un brouillon : refusé tant qu’il est modifiable', async () => {
      const r = await api('POST', `/api/bons-paiement/${bonId}/payer`, {
        modeReglement: 'especes',
      });
      egal(r.status, 409, 'statut');

      const bon = await prisma.bonPaiement.findUniqueOrThrow({ where: { id: bonId } });
      egal(bon.statut, 'brouillon', 'statut après refus');
    });

    await verifie('validation puis règlement : écriture de décaissement', async () => {
      const v = await api('POST', `/api/bons-paiement/${bonId}/valider`);
      attendu(v.status === 200, `validation refusée (${v.status}) : ${v.texte.slice(0, 200)}`);
      egal((await prisma.bonPaiement.findUniqueOrThrow({ where: { id: bonId } })).statut, 'valide', 'statut');

      const p = await api('POST', `/api/bons-paiement/${bonId}/payer`, {
        modeReglement: 'virement',
        referenceReglement: `VIR-LIV-${PREFIXE}`,
      });
      attendu(p.status === 200, `règlement refusé (${p.status}) : ${p.texte.slice(0, 200)}`);

      const bon = await prisma.bonPaiement.findUniqueOrThrow({
        where: { id: bonId },
        include: { transaction: true },
      });
      egal(bon.statut, 'paye', 'statut');
      attendu(bon.transaction !== null, 'aucune écriture comptable créée');
      egal(bon.transaction!.type, 'depense', 'type de transaction');
      egal(Number(bon.transaction!.montant), 400.5, 'montant décaissé');
    });

    await verifie('annuler un bon déjà payé : refusé', async () => {
      const r = await api('POST', `/api/bons-paiement/${bonId}/annuler`, { motif: 'test' });
      egal(r.status, 409, 'statut');
      egal((await prisma.bonPaiement.findUniqueOrThrow({ where: { id: bonId } })).statut, 'paye', 'statut');
    });

    // Contestation : le bon est annulé, les tournées redeviennent éligibles et
    // un nouveau bon peut être émis. Sans cette libération, un livreur
    // contestant son bon ne serait plus jamais payé.
    await verifie('annulation : les tournées redeviennent éligibles', async () => {
      const gen = await api('POST', '/api/bons-paiement/generer', PERIODE);
      attendu(gen.status === 200, `génération refusée (${gen.status})`);

      const bon = await prisma.bonPaiement.findFirstOrThrow({ where: { livreurId: livreurBis.id } });
      bonBisId = bon.id;

      const a = await api('POST', `/api/bons-paiement/${bonBisId}/annuler`, { motif: 'Contestation livreur' });
      attendu(a.status === 200, `annulation refusée (${a.status}) : ${a.texte.slice(0, 200)}`);

      const tournees = await prisma.bonDistribution.findMany({ where: { livreurId: livreurBis.id } });
      attendu(
        tournees.every((t) => t.bonPaiementId === null && t.gainRegleLe === null),
        'les tournées sont restées rattachées au bon annulé'
      );

      const regen = await api('POST', '/api/bons-paiement/generer', PERIODE);
      attendu(regen.status === 200, `régénération refusée (${regen.status})`);

      const actifs = await prisma.bonPaiement.count({
        where: { livreurId: livreurBis.id, statut: { in: ['brouillon', 'valide', 'paye'] } },
      });
      egal(actifs, 1, 'bons actifs après régénération');
    });
  } finally {
    await nettoyer({ utilisateurIds: jeu.utilisateurIds, marchandIds: jeu.marchandIds, hubId: hub.id });
    console.log(`\n${reussis} réussi(s), ${echoues} échec(s)\n`);
    await prisma.$disconnect();
    process.exit(echoues > 0 ? 1 : 0);
  }
}

main().catch(async (err) => {
  console.error('\nÉchec inattendu :', err);
  await prisma.$disconnect();
  process.exit(1);
});
