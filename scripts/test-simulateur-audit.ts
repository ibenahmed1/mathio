import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { ROLE_PERMISSIONS } from '../lib/permissions';
import { attendreServeur, creerClient, type ClientAudit } from './audit-http';

// Audit local du simulateur de rentabilité (§ /admin/simulateur et
// /marchand/simulateur), exécutable via
//   npx tsx scripts/test-simulateur-audit.ts
// avec un serveur de développement en cours (npm run dev).
//
// Le calcul est couvert par lib/__tests__/simulateur-rentabilite.test.ts ; ce
// script éprouve l'ACCÈS et le CLOISONNEMENT :
//   - l'admin l'ouvre, un rôle du back-office sans `simulateur:use` non ;
//   - le titulaire d'une boutique l'ouvre, comme le rôle « Comptable » ;
//   - un membre dont le rôle n'a pas `simulateur.utiliser` est refusé ;
//   - les scénarios enregistrés (/api/simulations) : création, lecture,
//     modification, suppression ; partagés au sein d'une boutique, invisibles
//     d'une autre boutique comme du back-office (et réciproquement) ; saisie
//     normalisée côté serveur.
//
// Toutes les données créées sont supprimées en fin d'exécution.

const SUFFIXE = '@simulateur-audit.test';
const MOT_DE_PASSE = 'Audit1234!';
const EMAILS = {
  admin: `admin${SUFFIXE}`,
  responsable: `responsable${SUFFIXE}`,
  titulaire: `titulaire${SUFFIXE}`,
  autreBoutique: `autre-boutique${SUFFIXE}`,
  comptable: `comptable${SUFFIXE}`,
  operateur: `operateur${SUFFIXE}`,
};
const TITRE = 'Simulateur de rentabilité';

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

async function connecter(client: ClientAudit, email: string) {
  for (let essai = 0; essai < 2; essai++) {
    const r = await client.api('POST', '/api/auth/login', { telephone: email, secret: MOT_DE_PASSE });
    if (r.status === 429) {
      console.log('       (quota de connexion atteint, pause de 65 s)');
      await new Promise((res) => setTimeout(res, 65_000));
      continue;
    }
    attendu(r.status === 200, `connexion ${email} : HTTP ${r.status}`);
    return;
  }
  throw new Error('quota de connexion toujours atteint');
}

async function nettoyer() {
  const comptes = await prisma.utilisateur.findMany({
    where: { email: { endsWith: SUFFIXE } },
    select: { id: true, marchand: { select: { id: true } } },
  });
  const ids = comptes.map((c) => c.id);
  const marchandIds = comptes.flatMap((c) => (c.marchand ? [c.marchand.id] : []));
  await prisma.simulationRentabilite.deleteMany({
    where: { OR: [{ marchandId: { in: marchandIds } }, { auteurId: { in: ids } }] },
  });
  await prisma.marchandMembre.deleteMany({ where: { marchandId: { in: marchandIds } } });
  await prisma.roleMarchand.deleteMany({ where: { marchandId: { in: marchandIds } } });
  await prisma.marchand.deleteMany({ where: { id: { in: marchandIds } } });
  await prisma.utilisateur.deleteMany({ where: { id: { in: ids } } });
}

async function seed() {
  await nettoyer();
  const hash = await bcrypt.hash(MOT_DE_PASSE, 10);

  for (const role of ['admin', 'responsable'] as const) {
    await prisma.utilisateur.create({
      data: {
        nomComplet: `${role} simulateur`,
        email: EMAILS[role],
        motDePasseHash: hash,
        role,
        permissions: ROLE_PERMISSIONS[role],
      },
    });
  }

  const titulaire = await prisma.utilisateur.create({
    data: { nomComplet: 'Titulaire simulateur', email: EMAILS.titulaire, motDePasseHash: hash, role: 'marchand' },
  });
  const boutique = await prisma.marchand.create({
    data: { utilisateurId: titulaire.id, nomBoutique: 'Boutique Simulateur', statut: 'actif' },
  });

  const autre = await prisma.utilisateur.create({
    data: { nomComplet: 'Autre boutique', email: EMAILS.autreBoutique, motDePasseHash: hash, role: 'marchand' },
  });
  await prisma.marchand.create({
    data: { utilisateurId: autre.id, nomBoutique: 'Autre Boutique Simu', statut: 'actif' },
  });

  // Rôles prédéfinis : leurs permissions sont lues dans le code (cle), pas
  // dans la colonne.
  for (const [cle, email] of [
    ['comptable', EMAILS.comptable],
    ['operateur', EMAILS.operateur],
  ] as const) {
    const role = await prisma.roleMarchand.create({
      data: { marchandId: boutique.id, nom: cle, cle, permissions: [] },
    });
    const membre = await prisma.utilisateur.create({
      data: { nomComplet: `Membre ${cle}`, email, motDePasseHash: hash, role: 'marchand' },
    });
    await prisma.marchandMembre.create({
      data: { marchandId: boutique.id, utilisateurId: membre.id, roleId: role.id },
    });
  }
}

async function page(espace: 'admin' | 'marchand', email: string, chemin: string) {
  const client = creerClient(espace);
  await connecter(client, email);
  return client.api('GET', chemin);
}

async function client(espace: 'admin' | 'marchand', email: string) {
  const c = creerClient(espace);
  await connecter(c, email);
  return c;
}

type Sim = { id: string; nom: string; entrees: Record<string, unknown>; taux: Record<string, number> };
const liste = (r: { json: Record<string, unknown> | null }) => (r.json?.data ?? []) as Sim[];

async function main() {
  await attendreServeur();
  await seed();
  try {
    await verifie('admin : l’écran s’ouvre et le lien figure dans la navigation', async () => {
      const r = await page('admin', EMAILS.admin, '/admin/simulateur');
      attendu(r.status === 200, `HTTP ${r.status}`);
      attendu(r.texte.includes(TITRE), 'titre absent');
      attendu(r.texte.includes('href="/admin/simulateur"'), 'lien absent de la navigation');
    });

    await verifie('responsable sans `simulateur:use` : refusé, sans lien', async () => {
      const client = creerClient('admin');
      await connecter(client, EMAILS.responsable);
      const r = await client.api('GET', '/admin/simulateur');
      attendu(r.status !== 200 || !r.texte.includes(TITRE), `ouvert (HTTP ${r.status})`);
      const accueil = await client.api('GET', '/admin');
      attendu(!accueil.texte.includes('href="/admin/simulateur"'), 'lien affiché');
    });

    await verifie('titulaire : l’écran s’ouvre et le lien figure dans la navigation', async () => {
      const r = await page('marchand', EMAILS.titulaire, '/marchand/simulateur');
      attendu(r.status === 200, `HTTP ${r.status}`);
      attendu(r.texte.includes(TITRE), 'titre absent');
      attendu(r.texte.includes('/marchand/simulateur'), 'lien absent de la navigation');
    });

    await verifie('rôle Comptable : l’écran s’ouvre', async () => {
      const r = await page('marchand', EMAILS.comptable, '/marchand/simulateur');
      attendu(r.status === 200 && r.texte.includes(TITRE), `HTTP ${r.status}`);
    });

    await verifie('rôle Opérateur colis : refusé', async () => {
      const r = await page('marchand', EMAILS.operateur, '/marchand/simulateur');
      attendu(r.status !== 200 || !r.texte.includes(TITRE), `ouvert (HTTP ${r.status})`);
    });

    // --- Scénarios enregistrés --------------------------------------------
    const titulaire = await client('marchand', EMAILS.titulaire);
    const comptable = await client('marchand', EMAILS.comptable);
    const autre = await client('marchand', EMAILS.autreBoutique);
    const admin = await client('admin', EMAILS.admin);
    let idBoutique = '';
    let idAdmin = '';

    await verifie('titulaire : enregistre un scénario, saisie normalisée par le serveur', async () => {
      const r = await titulaire.api('POST', '/api/simulations', {
        nom: '  Montre   X8 ',
        entrees: { prixVente: 299, cpl: 'pas un nombre', deviseVente: 'BTC', champPirate: 1 },
        taux: { USD: 9.5, MAD: 7 },
      });
      attendu(r.status === 201, `HTTP ${r.status} — ${r.texte.slice(0, 160)}`);
      const sim = r.json as unknown as Sim;
      idBoutique = sim.id;
      attendu(sim.nom === 'Montre X8', `nom ${sim.nom}`);
      attendu(sim.entrees.prixVente === 299, 'prix perdu');
      attendu(typeof sim.entrees.cpl === 'number', 'cpl non numérique accepté');
      attendu(sim.entrees.deviseVente === 'MAD', 'devise inconnue acceptée');
      attendu(!('champPirate' in sim.entrees), 'champ inconnu stocké');
      attendu(sim.taux.USD === 9.5 && sim.taux.MAD === 1, 'taux mal normalisés');
    });

    await verifie('nom vide ou trop long : 400', async () => {
      const vide = await titulaire.api('POST', '/api/simulations', { nom: '   ', entrees: {} });
      const long = await titulaire.api('POST', '/api/simulations', { nom: 'x'.repeat(121), entrees: {} });
      attendu(vide.status === 400 && long.status === 400, `HTTP ${vide.status} / ${long.status}`);
    });

    await verifie('le scénario est partagé avec l’équipe de la boutique (rôle Comptable)', async () => {
      const r = await comptable.api('GET', '/api/simulations');
      attendu(r.status === 200, `HTTP ${r.status}`);
      attendu(
        liste(r).some((s) => s.id === idBoutique),
        'absent de la liste du comptable',
      );
    });

    await verifie('une autre boutique ne le voit pas, ne le modifie pas, ne le supprime pas (404)', async () => {
      const l = await autre.api('GET', '/api/simulations');
      attendu(l.status === 200 && !liste(l).some((s) => s.id === idBoutique), 'visible');
      const p = await autre.api('PATCH', `/api/simulations/${idBoutique}`, { nom: 'Volé' });
      const d = await autre.api('DELETE', `/api/simulations/${idBoutique}`);
      attendu(p.status === 404 && d.status === 404, `HTTP ${p.status} / ${d.status}`);
    });

    await verifie('le back-office a son propre carnet, étanche aux boutiques', async () => {
      const c = await admin.api('POST', '/api/simulations', { nom: 'Étude plateforme', entrees: {} });
      attendu(c.status === 201, `HTTP ${c.status} — ${c.texte.slice(0, 160)}`);
      idAdmin = (c.json as unknown as Sim).id;
      const l = await admin.api('GET', '/api/simulations');
      attendu(!liste(l).some((s) => s.id === idBoutique), 'l’admin voit le scénario de la boutique');
      const lb = await titulaire.api('GET', '/api/simulations');
      attendu(!liste(lb).some((s) => s.id === idAdmin), 'la boutique voit le scénario du back-office');
      const p = await titulaire.api('PATCH', `/api/simulations/${idAdmin}`, { nom: 'x' });
      attendu(p.status === 404, `PATCH croisé : HTTP ${p.status}`);
    });

    await verifie('rôle sans le droit : 403 sur l’API, des deux côtés', async () => {
      const op = await client('marchand', EMAILS.operateur);
      const resp = await client('admin', EMAILS.responsable);
      const a = await op.api('GET', '/api/simulations');
      const b = await op.api('POST', '/api/simulations', { nom: 'x', entrees: {} });
      const c = await resp.api('GET', '/api/simulations');
      attendu(a.status === 403 && b.status === 403 && c.status === 403, `HTTP ${a.status} / ${b.status} / ${c.status}`);
    });

    await verifie('modifier puis supprimer depuis un autre membre de l’équipe', async () => {
      const p = await comptable.api('PATCH', `/api/simulations/${idBoutique}`, {
        nom: 'Montre X8 v2',
        entrees: { prixVente: 279 },
      });
      attendu(p.status === 200, `PATCH HTTP ${p.status}`);
      const sim = p.json as unknown as Sim;
      attendu(sim.nom === 'Montre X8 v2' && sim.entrees.prixVente === 279, 'modification non appliquée');
      const d = await comptable.api('DELETE', `/api/simulations/${idBoutique}`);
      attendu(d.status === 200, `DELETE HTTP ${d.status}`);
      const l = await titulaire.api('GET', '/api/simulations');
      attendu(!liste(l).some((s) => s.id === idBoutique), 'toujours listé');
    });
  } finally {
    await nettoyer();
    await prisma.$disconnect();
  }

  console.log(`\n${reussis} réussi(s), ${echoues} échoué(s)`);
  if (echoues > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await nettoyer().catch(() => {});
  process.exit(1);
});
