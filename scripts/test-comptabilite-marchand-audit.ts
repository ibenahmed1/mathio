import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { ROLE_PERMISSIONS } from '../lib/permissions';
import { attendreServeur, creerClient, type ClientAudit, type Reponse } from './audit-http';

// Audit local de la comptabilité des boutiques (§ /marchand/comptabilite),
// exécutable via
//   npx tsx scripts/test-comptabilite-marchand-audit.ts
// avec un serveur de développement en cours (npm run dev).
//
// Les gestes eux-mêmes (totaux, neutralisation, corbeille, historique) sont
// couverts côté plateforme par scripts/test-comptabilite-audit.ts : ce sont
// les mêmes routes et la même logique. Ce script éprouve ce qui est propre
// aux boutiques — le CLOISONNEMENT des livres (lib/comptabilite-perimetre.ts) :
//   - chaque boutique reçoit ses catégories de départ, et ne voit qu'elles ;
//   - une boutique ne lit, ne modifie, ne neutralise, ne supprime ni ne
//     catégorise rien qui appartienne à une autre boutique ou à la plateforme ;
//   - les totaux de chaque livre ne comptent que ses propres écritures ;
//   - l'historique d'une pièce n'est lisible que depuis son livre ;
//   - un membre en lecture seule consulte sans pouvoir écrire.
//
// Toutes les données créées sont supprimées en fin d'exécution, succès ou échec.

const SUFFIXE = '@compta-marchand-audit.test';
const MOT_DE_PASSE = 'Audit1234!';
const EMAILS = {
  a: `boutique-a${SUFFIXE}`,
  b: `boutique-b${SUFFIXE}`,
  lecteur: `lecteur-a${SUFFIXE}`,
  admin: `admin${SUFFIXE}`,
};

let reussis = 0;
let echoues = 0;

async function verifie(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    reussis++;
    console.log(`  OK   ${label}`);
  } catch (err) {
    echoues++;
    console.error(`  KO   ${label} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

function attendu(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function statut(r: Reponse, espere: number, quoi: string) {
  if (r.status !== espere) throw new Error(`${quoi} : HTTP ${r.status}, attendu ${espere} — ${r.texte.slice(0, 200)}`);
}

async function connecter(client: ClientAudit, email: string) {
  for (let essai = 0; essai < 2; essai++) {
    const r = await client.api('POST', '/api/auth/login', { telephone: email, secret: MOT_DE_PASSE });
    if (r.status === 429) {
      console.log('       (quota de connexion atteint, pause de 65 s)');
      await new Promise((res) => setTimeout(res, 65_000));
      continue;
    }
    statut(r, 200, `connexion ${email}`);
    return;
  }
  throw new Error('quota de connexion toujours atteint');
}

// --- Jeu de données ---------------------------------------------------------

async function nettoyer() {
  const comptes = await prisma.utilisateur.findMany({
    where: { email: { endsWith: SUFFIXE } },
    select: { id: true, marchand: { select: { id: true } } },
  });
  const ids = comptes.map((c) => c.id);
  const marchandIds = comptes.flatMap((c) => (c.marchand ? [c.marchand.id] : []));
  await prisma.historiqueComptable.deleteMany({ where: { auteurId: { in: ids } } });
  await prisma.transaction.deleteMany({ where: { auteurId: { in: ids }, transactionOrigineId: { not: null } } });
  await prisma.transaction.deleteMany({ where: { auteurId: { in: ids } } });
  await prisma.commandeStockHub.deleteMany({ where: { auteurId: { in: ids } } });
  await prisma.categorieComptable.deleteMany({ where: { marchandId: { in: marchandIds } } });
  await prisma.marchandMembre.deleteMany({ where: { marchandId: { in: marchandIds } } });
  await prisma.roleMarchand.deleteMany({ where: { marchandId: { in: marchandIds } } });
  await prisma.marchand.deleteMany({ where: { id: { in: marchandIds } } });
  await prisma.utilisateur.deleteMany({ where: { id: { in: ids } } });
}

async function creerBoutique(email: string, nom: string, hash: string) {
  const u = await prisma.utilisateur.create({
    data: {
      nomComplet: `Titulaire ${nom}`,
      email,
      telephone: `069${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      motDePasseHash: hash,
      role: 'marchand',
    },
  });
  return prisma.marchand.create({ data: { utilisateurId: u.id, nomBoutique: nom, statut: 'actif' } });
}

async function seed() {
  await nettoyer();
  const hash = await bcrypt.hash(MOT_DE_PASSE, 10);
  const a = await creerBoutique(EMAILS.a, 'Boutique A Compta', hash);
  const b = await creerBoutique(EMAILS.b, 'Boutique B Compta', hash);

  // Membre de A avec un rôle personnalisé réduit à la consultation.
  const role = await prisma.roleMarchand.create({
    data: { marchandId: a.id, nom: 'Lecture compta', permissions: ['comptabilite.voir'] },
  });
  const lecteur = await prisma.utilisateur.create({
    data: { nomComplet: 'Lecteur A', email: EMAILS.lecteur, motDePasseHash: hash, role: 'marchand' },
  });
  await prisma.marchandMembre.create({ data: { marchandId: a.id, utilisateurId: lecteur.id, roleId: role.id } });

  await prisma.utilisateur.create({
    data: {
      nomComplet: 'Admin Compta Audit',
      email: EMAILS.admin,
      motDePasseHash: hash,
      role: 'admin',
      permissions: ROLE_PERMISSIONS.admin,
    },
  });
  return { a, b };
}

type Categorie = { id: string; nom: string; portee: string };
type Journal = { data: Array<{ id: string }>; totaux: { totalEntrees: number; totalSorties: number; solde: number } };

async function categories(client: ClientAudit): Promise<Categorie[]> {
  const r = await client.api('GET', '/api/finance/categories');
  statut(r, 200, 'GET catégories');
  return r.json?.data as Categorie[];
}

async function journal(client: ClientAudit): Promise<Journal> {
  const r = await client.api('GET', '/api/finance');
  statut(r, 200, 'GET journal');
  return r.json as unknown as Journal;
}

function ecriture(categorieId: string, montant: number, type: 'revenu' | 'depense' = 'revenu') {
  return { titre: `Écriture ${montant}`, montant, type, categorieId, dateEffet: new Date().toISOString() };
}

// --- Audit ------------------------------------------------------------------

async function main() {
  console.log('\n§ Audit comptabilité des boutiques\n');
  await attendreServeur();
  const { a: boutiqueA } = await seed();

  const a = creerClient('marchand');
  const b = creerClient('marchand');
  const lecteur = creerClient('marchand');
  const admin = creerClient('admin');
  const ids: Record<string, string> = {};

  try {
    console.log('0. Sessions');
    await verifie('connexion des deux titulaires, du lecteur et de l’admin', async () => {
      await connecter(a, EMAILS.a);
      await connecter(b, EMAILS.b);
      await connecter(lecteur, EMAILS.lecteur);
      await connecter(admin, EMAILS.admin);
    });

    console.log('\n1. Catégories par livre');
    await verifie('chaque boutique reçoit les six catégories de départ, à elle', async () => {
      const ca = await categories(a);
      const cb = await categories(b);
      attendu(ca.length === 6 && cb.length === 6, `A ${ca.length}, B ${cb.length}`);
      attendu(!ca.some((c) => cb.some((d) => d.id === c.id)), 'catégories partagées entre boutiques');
      ids.catA = ca.find((c) => c.nom === 'Paiement client')!.id;
      ids.catB = cb.find((c) => c.nom === 'Paiement client')!.id;
    });
    await verifie('une seconde lecture ne duplique pas les catégories', async () => {
      attendu((await categories(a)).length === 6, 'doublons');
    });
    await verifie('la boutique ne voit aucune catégorie de la plateforme', async () => {
      const plateforme = await categories(admin);
      const ca = await categories(a);
      attendu(!plateforme.some((c) => ca.some((d) => d.id === c.id)), 'catégorie plateforme visible');
      ids.catPlateforme = plateforme.find((c) => c.portee === 'transaction')!.id;
    });
    await verifie('même nom de catégorie permis dans deux livres, refusé en doublon dans un seul', async () => {
      statut(await a.api('POST', '/api/finance/categories', { nom: 'Publicité', portee: 'transaction' }), 201, 'A crée');
      statut(await b.api('POST', '/api/finance/categories', { nom: 'Publicité', portee: 'transaction' }), 201, 'B crée');
      statut(await a.api('POST', '/api/finance/categories', { nom: 'publicité', portee: 'transaction' }), 409, 'doublon A');
    });
    await verifie('B ne renomme ni ne supprime une catégorie de A', async () => {
      statut(await b.api('PATCH', `/api/finance/categories/${ids.catA}`, { nom: 'Piratée' }), 404, 'PATCH');
      statut(await b.api('DELETE', `/api/finance/categories/${ids.catA}`), 404, 'DELETE');
    });

    console.log('\n2. Écritures cloisonnées');
    await verifie('A saisit une écriture dans sa catégorie', async () => {
      const r = await a.api('POST', '/api/finance', ecriture(ids.catA, 150));
      statut(r, 201, 'POST A');
      ids.ecritureA = r.json?.id as string;
      const lue = await prisma.transaction.findUniqueOrThrow({ where: { id: ids.ecritureA }, select: { marchandId: true } });
      attendu(lue.marchandId === boutiqueA.id, `marchandId ${lue.marchandId}`);
    });
    await verifie('A ne peut pas utiliser la catégorie de B ni celle de la plateforme', async () => {
      statut(await a.api('POST', '/api/finance', ecriture(ids.catB, 10)), 400, 'catégorie de B');
      statut(await a.api('POST', '/api/finance', ecriture(ids.catPlateforme, 10)), 400, 'catégorie plateforme');
    });
    await verifie('l’admin saisit une écriture dans les livres de la plateforme', async () => {
      const r = await admin.api('POST', '/api/finance', ecriture(ids.catPlateforme, 999));
      statut(r, 201, 'POST admin');
      ids.ecriturePlateforme = r.json?.id as string;
    });
    await verifie('chaque journal ne liste que ses écritures, et ses totaux ne comptent qu’elles', async () => {
      const ja = await journal(a);
      attendu(ja.data.length === 1 && ja.data[0].id === ids.ecritureA, `A voit ${ja.data.length} écriture(s)`);
      attendu(ja.totaux.solde === 150, `solde A ${ja.totaux.solde}`);
      const jb = await journal(b);
      attendu(jb.data.length === 0 && jb.totaux.solde === 0, `B voit ${jb.data.length}, solde ${jb.totaux.solde}`);
      const jp = await journal(admin);
      attendu(!jp.data.some((t) => t.id === ids.ecritureA), 'écriture de A dans le journal plateforme');
      attendu(jp.data.some((t) => t.id === ids.ecriturePlateforme), 'écriture plateforme absente');
    });
    await verifie('B ne lit, ne modifie, ne neutralise, ne supprime rien de A', async () => {
      statut(await b.api('PATCH', `/api/finance/${ids.ecritureA}`, { montant: 1 }), 404, 'PATCH');
      statut(await b.api('POST', `/api/finance/${ids.ecritureA}/annuler`, {}), 404, 'annuler');
      statut(await b.api('DELETE', `/api/finance/${ids.ecritureA}`), 404, 'DELETE');
      statut(await b.api('POST', `/api/finance/${ids.ecritureA}/restaurer`, {}), 404, 'restaurer');
      statut(await b.api('GET', `/api/finance/${ids.ecritureA}/preuve`), 404, 'preuve');
    });
    await verifie('A ne touche à rien de la plateforme, et l’admin rien de A', async () => {
      statut(await a.api('PATCH', `/api/finance/${ids.ecriturePlateforme}`, { montant: 1 }), 404, 'A → plateforme');
      statut(await a.api('DELETE', `/api/finance/${ids.ecriturePlateforme}`), 404, 'A supprime plateforme');
      statut(await admin.api('PATCH', `/api/finance/${ids.ecritureA}`, { montant: 1 }), 404, 'admin → A');
    });

    console.log('\n3. Gestes dans son propre livre');
    await verifie('A modifie, neutralise, supprime et restaure son écriture', async () => {
      statut(await a.api('PATCH', `/api/finance/${ids.ecritureA}`, { montant: 200 }), 200, 'PATCH');
      statut(await a.api('POST', `/api/finance/${ids.ecritureA}/annuler`, {}), 201, 'neutraliser');
      const neutralisation = await prisma.transaction.findUniqueOrThrow({
        where: { transactionOrigineId: ids.ecritureA },
        select: { marchandId: true },
      });
      attendu(neutralisation.marchandId === boutiqueA.id, 'neutralisation hors du livre de A');
      attendu((await journal(a)).totaux.solde === 0, 'solde A après neutralisation');
      statut(await a.api('DELETE', `/api/finance/${ids.ecritureA}`), 200, 'DELETE');
      const corbeille = await a.api('GET', '/api/finance?supprimees=1');
      statut(corbeille, 200, 'corbeille A');
      attendu((corbeille.json?.data as unknown[]).length === 2, 'corbeille : écriture + neutralisation');
      statut(await a.api('POST', `/api/finance/${ids.ecritureA}/restaurer`, {}), 200, 'restaurer');
    });
    await verifie('l’historique de la pièce est lisible par A, invisible pour B et l’admin', async () => {
      const ra = await a.api('GET', `/api/finance/historique?cible=transaction&id=${ids.ecritureA}`);
      statut(ra, 200, 'historique A');
      attendu((ra.json?.data as unknown[]).length >= 3, 'traces manquantes');
      const rb = await b.api('GET', `/api/finance/historique?cible=transaction&id=${ids.ecritureA}`);
      attendu((rb.json?.data as unknown[]).length === 0, 'B lit l’historique de A');
      const rp = await admin.api('GET', `/api/finance/historique?cible=transaction&id=${ids.ecritureA}`);
      attendu((rp.json?.data as unknown[]).length === 0, 'l’admin lit l’historique de A');
    });

    console.log('\n4. Commandes d’inventaire cloisonnées');
    await verifie('A enregistre une commande ; B ne la voit ni ne la touche', async () => {
      const r = await a.api('POST', '/api/commandes-stock-hub', {
        titre: 'Cartons',
        montant: 80,
        modePaiement: 'Espèces',
        dateCommande: new Date().toISOString(),
      });
      statut(r, 201, 'POST commande');
      ids.commandeA = r.json?.id as string;
      const lb = await b.api('GET', '/api/commandes-stock-hub');
      attendu(!(lb.json?.data as Array<{ id: string }>).some((c) => c.id === ids.commandeA), 'B voit la commande');
      const lp = await admin.api('GET', '/api/commandes-stock-hub');
      attendu(!(lp.json?.data as Array<{ id: string }>).some((c) => c.id === ids.commandeA), 'l’admin voit la commande');
      statut(await b.api('PATCH', `/api/commandes-stock-hub/${ids.commandeA}/statut`, { statut: 'commandee' }), 404, 'statut');
      statut(await b.api('PATCH', `/api/commandes-stock-hub/${ids.commandeA}`, { montant: 1 }), 404, 'PATCH');
      statut(await b.api('DELETE', `/api/commandes-stock-hub/${ids.commandeA}`), 404, 'DELETE');
      statut(await a.api('PATCH', `/api/commandes-stock-hub/${ids.commandeA}/statut`, { statut: 'commandee' }), 200, 'statut A');
    });

    console.log('\n5. Membre en lecture seule');
    await verifie('le lecteur consulte le journal et les commandes de SA boutique', async () => {
      const j = await journal(lecteur);
      attendu(j.data.some((t) => t.id === ids.ecritureA), 'écriture de A absente');
      statut(await lecteur.api('GET', '/api/commandes-stock-hub'), 200, 'commandes');
    });
    await verifie('le lecteur ne saisit, ne modifie, ne supprime rien, et n’ouvre pas la corbeille', async () => {
      statut(await lecteur.api('POST', '/api/finance', ecriture(ids.catA, 5)), 403, 'POST');
      statut(await lecteur.api('PATCH', `/api/finance/${ids.ecritureA}`, { montant: 1 }), 403, 'PATCH');
      statut(await lecteur.api('DELETE', `/api/finance/${ids.ecritureA}`), 403, 'DELETE');
      statut(await lecteur.api('POST', '/api/finance/categories', { nom: 'X', portee: 'transaction' }), 403, 'catégorie');
      statut(await lecteur.api('GET', '/api/finance?supprimees=1'), 403, 'corbeille');
      statut(await lecteur.api('PATCH', `/api/commandes-stock-hub/${ids.commandeA}/statut`, { statut: 'recue' }), 403, 'statut');
    });
  } finally {
    await nettoyer();
    await prisma.$disconnect();
  }

  console.log(`\n${reussis} réussis, ${echoues} échoués\n`);
  process.exitCode = echoues ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
