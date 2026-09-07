import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { HOST_API, SPACE_HOSTS, type SessionSpace } from '../lib/spaces';
import { analyserCle } from '../lib/plateforme-cles';
import { attendreServeur, creerClient } from './audit-http';

// AUDIT DU MODULE PLATEFORMES PARTENAIRES — administration et sécurité.
//
//   npx tsx scripts/test-plateformes-audit.ts
//
// avec un serveur de développement en cours.
//
// Complète `simuler-shipeh.ts`, qui tient le rôle du PARTENAIRE : celui-ci
// tient le rôle de l'ADMINISTRATEUR et de l'attaquant. Il couvre les niveaux 3
// et 4 de la recette (INTEGRATION_PLATEFORMES_PARTENAIRES.md, §7) — tout ce
// qui s'y vérifiait à la main sauf ce qui demande vraiment des yeux : le rendu
// de l'écran, la clé affichée une seule fois, le responsive.
//
// Les comptes créés sont préfixés et supprimés en fin d'exécution.

const SUFFIXE = '@audit-plateformes.test';
const MOT_DE_PASSE = 'Audit1234!';
const COMPTES = {
  admin: `admin${SUFFIXE}`,
  superviseur: `superviseur${SUFFIXE}`,
} as const;
const CODE = 'audit-plateformes';

const clients: Record<SessionSpace, ReturnType<typeof creerClient>> = {
  admin: creerClient('admin'),
  marchand: creerClient('marchand'),
  terrain: creerClient('terrain'),
};
const hoteApi = HOST_API ?? 'api.localhost:3000';

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
function attendu(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

/** Appel de l'API MACHINE : hôte dédié, ni cookie ni Origin — comme un partenaire. */
function machine(methode: string, chemin: string, cle: string | null, corps?: unknown) {
  return clients.admin.api(methode, chemin, corps, {
    host: hoteApi,
    origin: null,
    cookie: null,
    entetes: cle ? { Authorization: `Bearer ${cle}` } : {},
  });
}

/** Appel de l'API d'ADMINISTRATION : hôte du back-office, avec la session. */
function admin(methode: string, chemin: string, corps?: unknown) {
  return clients.admin.api(methode, chemin, corps);
}

async function seed() {
  const motDePasseHash = await bcrypt.hash(MOT_DE_PASSE, 10);
  await prisma.utilisateur.upsert({
    where: { email: COMPTES.admin },
    update: { role: 'admin', actif: true, motDePasseHash },
    create: { nomComplet: 'Admin Audit Plateformes', email: COMPTES.admin, motDePasseHash, role: 'admin' },
  });
  // Un compte back-office SANS la permission integrations:manage — c'est lui
  // qui prouve que l'écran est réellement fermé, pas seulement caché.
  await prisma.utilisateur.upsert({
    where: { email: COMPTES.superviseur },
    update: { role: 'superviseur', actif: true, motDePasseHash, permissions: ['dashboard:view'] },
    create: {
      nomComplet: 'Superviseur Audit Plateformes',
      email: COMPTES.superviseur,
      motDePasseHash,
      role: 'superviseur',
      permissions: ['dashboard:view'],
    },
  });
}

async function nettoyer() {
  const p = await prisma.plateformePartenaire.findUnique({
    where: { code: CODE },
    include: { comptesMarchands: { select: { marchandId: true } } },
  });
  const ids = [...new Set(p?.comptesMarchands.map((c) => c.marchandId) ?? [])];
  if (ids.length) {
    const cmds = await prisma.commande.findMany({ where: { marchandId: { in: ids } }, select: { id: true } });
    const cids = cmds.map((c) => c.id);
    if (cids.length) {
      await prisma.historiqueStatutCommande.deleteMany({ where: { commandeId: { in: cids } } });
      await prisma.commande.deleteMany({ where: { id: { in: cids } } });
    }
  }
  if (p) {
    await prisma.auditLog.deleteMany({ where: { cibleType: 'plateforme', cibleId: p.id } });
    await prisma.plateformePartenaire.delete({ where: { id: p.id } });
    await prisma.utilisateur.delete({ where: { id: p.utilisateurTechniqueId } }).catch(() => {});
  }
  if (ids.length) {
    const ms = await prisma.marchand.findMany({ where: { id: { in: ids } }, select: { utilisateurId: true } });
    await prisma.marchand.deleteMany({ where: { id: { in: ids } } });
    await prisma.utilisateur.deleteMany({ where: { id: { in: ms.map((m) => m.utilisateurId) } } });
  }

  // Les comptes d'audit ont signé des AuditLog en émettant et révoquant des
  // clés : la FK les retient tant que ces lignes existent. On les retire par
  // leur AUTEUR — les cibles ne suffisent pas, la plateforme temporaire créée
  // pour éprouver la borne de deux caractères en a laissé aussi.
  const comptes = await prisma.utilisateur.findMany({
    where: { email: { in: Object.values(COMPTES) } },
    select: { id: true },
  });
  if (comptes.length) {
    await prisma.auditLog.deleteMany({ where: { adminId: { in: comptes.map((c) => c.id) } } });
  }
  await prisma.utilisateur.deleteMany({ where: { email: { in: Object.values(COMPTES) } } });
  await prisma.rateLimitEntry.deleteMany({ where: { cle: { startsWith: 'plateforme' } } });
}

interface Cle { id: string; prefixe: string }

async function main() {
  await attendreServeur();
  await nettoyer();
  await seed();

  console.log('\nAudit du module plateformes partenaires');
  console.log(`  back-office ${SPACE_HOSTS.admin}`);
  console.log(`  API machine ${hoteApi}\n`);

  const cx = await admin('POST', '/api/auth/login', { telephone: COMPTES.admin, secret: MOT_DE_PASSE });
  if (cx.status !== 200) throw new Error(`connexion admin impossible (${cx.status}) — relancer dans une minute si quota`);

  // ----------------------------------------------------------------
  console.log('1. Création d’une plateforme');

  let plateformeId = '';

  await verifie('création : 201, et le code est normalisé', async () => {
    const r = await admin('POST', '/api/plateformes', { nom: 'Audit Plateformes', code: '  AUDIT-Plateformes  ' });
    attendu(r.status === 201, `statut ${r.status}`);
    attendu((r.json as { code?: string })?.code === CODE, `code « ${String((r.json as { code?: string })?.code)} »`);
    plateformeId = String((r.json as { id?: string })?.id);
  });

  await verifie('le même code une seconde fois : 409', async () => {
    const r = await admin('POST', '/api/plateformes', { nom: 'Doublon', code: CODE });
    attendu(r.status === 409, `statut ${r.status}`);
  });

  await verifie('codes invalides refusés, code de 2 caractères accepté', async () => {
    for (const code of ['Shipeh!', '-x', 'a', 'a'.repeat(33)]) {
      const r = await admin('POST', '/api/plateformes', { nom: 'X', code });
      attendu(r.status === 400, `« ${code} » aurait dû être refusé, reçu ${r.status}`);
    }
    // La borne basse : elle était fausse avant correction (« a » passait, « ab » non).
    const r = await admin('POST', '/api/plateformes', { nom: 'Deux', code: 'ab' });
    attendu(r.status === 201, `« ab » aurait dû passer, reçu ${r.status}`);
    const id = String((r.json as { id?: string })?.id);
    const p = await prisma.plateformePartenaire.findUnique({ where: { id } });
    if (p) {
      await prisma.plateformePartenaire.delete({ where: { id } });
      await prisma.utilisateur.delete({ where: { id: p.utilisateurTechniqueId } }).catch(() => {});
    }
  });

  await verifie('le compte de service est inerte', async () => {
    const p = await prisma.plateformePartenaire.findUnique({
      where: { id: plateformeId },
      include: { utilisateurTechnique: true },
    });
    const u = p!.utilisateurTechnique;
    attendu(u.role === 'plateforme', `rôle ${u.role}`);
    attendu(u.actif === false, 'le compte de service ne doit pas être actif');
    attendu(u.telephone === null && u.email === null, 'ni téléphone ni email : rien pour le retrouver au login');
  });

  await verifie('la création est tracée dans AuditLog', async () => {
    const n = await prisma.auditLog.count({
      where: { action: 'plateforme.creation', cibleId: plateformeId },
    });
    attendu(n === 1, `${n} entrée(s)`);
  });

  // ----------------------------------------------------------------
  console.log('\n2. Émission et périmètre des clés');

  let cleTest = '';
  let cleLive = '';
  let idCleLive = '';

  await verifie('une clé sans scope est refusée', async () => {
    const r = await admin('POST', `/api/plateformes/${plateformeId}/cles`, { environnement: 'test', scopes: [] });
    attendu(r.status === 400, `statut ${r.status}`);
  });

  await verifie('une clé TEST ne peut pas détenir marchands:creation_validee', async () => {
    const r = await admin('POST', `/api/plateformes/${plateformeId}/cles`, {
      environnement: 'test',
      scopes: ['marchands:creation_validee', 'colis:creation'],
    });
    attendu(r.status === 400, `statut ${r.status} — ce scope court-circuite l’approbation admin`);
  });

  await verifie('émission d’une clé test, puis d’une clé live', async () => {
    const t = await admin('POST', `/api/plateformes/${plateformeId}/cles`, {
      environnement: 'test',
      scopes: ['marchands:creation', 'colis:creation'],
    });
    attendu(t.status === 201, `statut ${t.status}`);
    cleTest = String((t.json as { cleComplete?: string })?.cleComplete);
    attendu(analyserCle(cleTest) !== null, 'la clé renvoyée n’a pas le format attendu');

    const l = await admin('POST', `/api/plateformes/${plateformeId}/cles`, {
      environnement: 'live',
      scopes: ['marchands:creation_validee', 'colis:creation'],
    });
    attendu(l.status === 201, `statut ${l.status}`);
    cleLive = String((l.json as { cleComplete?: string })?.cleComplete);
    idCleLive = String((l.json as { cle?: Cle })?.cle?.id);
  });

  await verifie('le secret n’est PAS stocké en clair', async () => {
    const secret = analyserCle(cleTest)!.secret;
    const cles = await prisma.cleApiPlateforme.findMany({
      where: { plateformeId },
      select: { secretHash: true, prefixe: true },
    });
    for (const c of cles) {
      attendu(/^[0-9a-f]{64}$/.test(c.secretHash), `secretHash douteux : ${c.secretHash.slice(0, 20)}…`);
      attendu(!c.secretHash.includes(secret), 'le secret apparaît dans le hash');
    }
  });

  await verifie('plafond de deux clés actives par environnement', async () => {
    const r = await admin('POST', `/api/plateformes/${plateformeId}/cles`, {
      environnement: 'test',
      scopes: ['colis:creation'],
    });
    attendu(r.status === 201, `la 2e clé test devait passer, reçu ${r.status}`);
    const trop = await admin('POST', `/api/plateformes/${plateformeId}/cles`, {
      environnement: 'test',
      scopes: ['colis:creation'],
    });
    attendu(trop.status === 409, `la 3e clé test devait être refusée, reçu ${trop.status}`);
  });

  await verifie('l’émission est tracée dans AuditLog', async () => {
    const n = await prisma.auditLog.count({ where: { action: 'cle_api.creation', cibleId: plateformeId } });
    attendu(n >= 3, `${n} entrée(s)`);
  });

  // ----------------------------------------------------------------
  console.log('\n3. Rotation et coupure');

  await verifie('« expirer » avec une date passée est refusé', async () => {
    const r = await admin('PATCH', `/api/plateformes/${plateformeId}/cles/${idCleLive}`, {
      action: 'expirer',
      expireLe: '2020-01-01T00:00:00Z',
    });
    attendu(r.status === 400, `statut ${r.status} — produirait une clé morte mais non révoquée`);
  });

  await verifie('renommer la plateforme renomme le compte de service', async () => {
    const r = await admin('PATCH', `/api/plateformes/${plateformeId}`, { nom: 'Audit Renommé' });
    attendu(r.status === 200, `statut ${r.status}`);
    const p = await prisma.plateformePartenaire.findUnique({
      where: { id: plateformeId },
      include: { utilisateurTechnique: { select: { nomComplet: true } } },
    });
    attendu(
      p!.utilisateurTechnique.nomComplet === 'Audit Renommé',
      `l’auteur des colis afficherait encore « ${p!.utilisateurTechnique.nomComplet} »`
    );
  });

  await verifie('suspendre la plateforme coupe TOUTES ses clés', async () => {
    await admin('PATCH', `/api/plateformes/${plateformeId}`, { actif: false });
    const r = await machine('POST', '/api/v1/colis', cleTest, {});
    attendu(r.status === 403, `statut ${r.status}`);
    attendu((r.json as { code?: string })?.code === 'plateforme_desactivee', String((r.json as { code?: string })?.code));
    await admin('PATCH', `/api/plateformes/${plateformeId}`, { actif: true });
  });

  await verifie('la suspension est tracée dans AuditLog', async () => {
    const n = await prisma.auditLog.count({ where: { action: 'plateforme.suspension', cibleId: plateformeId } });
    attendu(n === 1, `${n} entrée(s) — c’est le geste d’incident, il doit laisser une trace`);
  });

  await verifie('révoquer une clé la coupe immédiatement', async () => {
    const r = await admin('PATCH', `/api/plateformes/${plateformeId}/cles/${idCleLive}`, { action: 'revoquer' });
    attendu(r.status === 200, `statut ${r.status}`);
    const appel = await machine('POST', '/api/v1/colis', cleLive, {});
    attendu(appel.status === 401, `statut ${appel.status}`);
    attendu((appel.json as { code?: string })?.code === 'cle_revoquee', String((appel.json as { code?: string })?.code));
  });

  await verifie('une clé révoquée n’est jamais supprimée', async () => {
    const c = await prisma.cleApiPlateforme.findUnique({ where: { id: idCleLive } });
    attendu(c !== null, 'la ligne a disparu — nbAppels et derniereUtilisationLe sont perdus');
    attendu(c!.revoqueeLe !== null, 'revoqueeLe non renseigné');
  });

  // ----------------------------------------------------------------
  console.log('\n4. Permissions du back-office');

  await verifie('un compte sans integrations:manage n’atteint pas l’administration', async () => {
    const autre = creerClient('admin');
    const cx2 = await autre.api('POST', '/api/auth/login', {
      telephone: COMPTES.superviseur,
      secret: MOT_DE_PASSE,
    });
    attendu(cx2.status === 200, `connexion superviseur : ${cx2.status}`);
    const r = await autre.api('GET', '/api/plateformes');
    attendu(r.status === 403, `statut ${r.status} — l’écran doit être fermé, pas seulement caché`);
  });

  await verifie('le rôle plateforme n’est pas proposé à la création d’utilisateur', async () => {
    const r = await admin('GET', '/api/utilisateurs?role=plateforme');
    attendu(r.status === 400, `statut ${r.status} — ces comptes ne se créent pas à la main`);
  });

  // ----------------------------------------------------------------
  console.log('\n5. Sécurité');

  await verifie('un cookie de session n’ouvre PAS l’API machine', async () => {
    // Le client `admin` porte une session valide. Sur l'hôte du back-office,
    // /api/v1/** doit répondre 404 — c'est le scénario que toute l'architecture
    // cherche à rendre impossible.
    const r = await admin('POST', '/api/v1/colis', {});
    attendu(r.status === 404, `statut ${r.status}`);
  });

  await verifie('l’hôte de l’API ne pose AUCUN cookie', async () => {
    const r = await machine('POST', '/api/v1/colis', cleTest, {});
    attendu(
      r.setCookie.length === 0,
      `${r.setCookie.length} Set-Cookie — l’exemption de contrôle d’Origin deviendrait une faille`
    );
  });

  await verifie('l’hôte de l’API n’atteint aucune route de session', async () => {
    for (const chemin of ['/api/commandes', '/api/plateformes', '/admin', '/login']) {
      const r = await machine('GET', chemin, cleTest);
      attendu(r.status === 404, `${chemin} a répondu ${r.status}`);
    }
  });

  await verifie('le compte de service ne peut se connecter sur AUCUN espace', async () => {
    // On lui donne tout ce qu'il faudrait pour réussir : un email, un mot de
    // passe connu, et `actif = true`. Le refus ne doit dépendre que du rôle.
    const p = await prisma.plateformePartenaire.findUnique({ where: { id: plateformeId } });
    const motDePasseHash = await bcrypt.hash(MOT_DE_PASSE, 10);
    await prisma.utilisateur.update({
      where: { id: p!.utilisateurTechniqueId },
      data: { email: `service${SUFFIXE}`, motDePasseHash, actif: true },
    });
    try {
      for (const espace of ['admin', 'marchand', 'terrain'] as SessionSpace[]) {
        const c = creerClient(espace);
        const r = await c.api('POST', '/api/auth/login', {
          telephone: `service${SUFFIXE}`,
          secret: MOT_DE_PASSE,
        });
        attendu(r.status === 401, `espace ${espace} a répondu ${r.status}`);
      }
    } finally {
      await prisma.utilisateur.update({
        where: { id: p!.utilisateurTechniqueId },
        data: { email: null, actif: false },
      });
    }
  });

  await verifie('le journal ne conserve aucune donnée de client final', async () => {
    await machine('POST', '/api/v1/colis', cleTest, {
      idExterneMarchand: 'X',
      reference: 'AUDIT-PII',
      clientNom: 'Nom Confidentiel Audit',
      clientTelephone: '0655001122',
      ville: 'Rabat',
      adresse: '9 rue Secrète',
      montantCod: 100,
    });
    const appels = await prisma.journalAppelApi.findMany({ where: { plateformeId } });
    const brut = JSON.stringify(appels);
    for (const fuite of ['Nom Confidentiel Audit', '0655001122', 'rue Secrète']) {
      attendu(!brut.includes(fuite), `« ${fuite} » se retrouve dans le journal`);
    }
    attendu(appels.length > 0, 'aucun appel journalisé');
  });

  await verifie('idempotence sous concurrence : un seul colis', async () => {
    const m = await machine('POST', '/api/v1/marchands', cleTest, {
      idExterne: 'AUDIT-CONC',
      nomComplet: 'Audit Concurrence',
      nomBoutique: 'AUDIT Boutique Concurrence',
      telephone: '0612009901',
      email: `conc${SUFFIXE}`,
    });
    attendu(m.status === 201, `création marchand : ${m.status}`);

    const colis = {
      idExterneMarchand: 'AUDIT-CONC',
      reference: 'AUDIT-RACE-1',
      clientNom: 'Client',
      clientTelephone: '0655443322',
      ville: 'Rabat',
      adresse: 'X',
      montantCod: 100,
    };
    // DIX appels simultanés : c'est la contrainte d'unicité en base qui doit
    // tenir, pas un « chercher puis créer » applicatif.
    const reponses = await Promise.all(Array.from({ length: 10 }, () => machine('POST', '/api/v1/colis', cleTest, colis)));
    const codes = reponses.map((r) => r.status);
    attendu(codes.every((c) => c === 200 || c === 201), `statuts reçus : ${[...new Set(codes)].join(', ')}`);

    const n = await prisma.commande.count({ where: { codeSuiviPartenaire: 'AUDIT-RACE-1' } });
    attendu(n === 1, `${n} colis en base au lieu d’un seul`);
  });

  // ----------------------------------------------------------------
  console.log('\n6. Purge');

  await verifie('la purge efface le test, épargne le reste, et laisse une trace', async () => {
    const avant = await prisma.commande.count({ where: { codeSuiviPartenaire: 'AUDIT-RACE-1' } });
    attendu(avant === 1, 'le colis d’essai devrait exister avant la purge');

    const r = await admin('POST', `/api/plateformes/${plateformeId}/purge-test`);
    attendu(r.status === 200, `statut ${r.status}`);
    const v = r.json as { marchands: number; colis: number; colisConserves: number };
    attendu(v.colis >= 1, `${v.colis} colis purgés`);
    attendu(v.colisConserves === 0, `${v.colisConserves} colis conservés — devrait être 0 depuis les deux gardes`);

    const apres = await prisma.commande.count({ where: { codeSuiviPartenaire: 'AUDIT-RACE-1' } });
    attendu(apres === 0, 'le colis d’essai survit à la purge');

    const n = await prisma.auditLog.count({ where: { action: 'plateforme.purge_test', cibleId: plateformeId } });
    attendu(n === 1, `${n} entrée d’audit — une suppression en masse doit être tracée`);
  });

  console.log('\nCe que cet audit NE PEUT PAS couvrir — à faire à l’œil :');
  console.log('  • la clé complète affichée UNE SEULE FOIS, et plus jamais ensuite ;');
  console.log('  • la case « marchand déjà validé » grisée sur une clé test ;');
  console.log('  • les pastilles « test » dans /admin/marchands et /admin/colis ;');
  console.log('  • le rendu responsive et le thème sombre ;');
  console.log('  • l’entrée « Intégrations » absente du menu pour un compte sans la permission.');
}

main()
  .catch((err) => {
    echoues++;
    console.error(`\nInterrompu : ${err instanceof Error ? err.message : err}`);
  })
  .finally(async () => {
    await nettoyer().catch((e) => console.error('Nettoyage incomplet :', e));
    await prisma.$disconnect();
    console.log(`\n${reussis} OK, ${echoues} KO`);
    process.exit(echoues > 0 ? 1 : 0);
  });
