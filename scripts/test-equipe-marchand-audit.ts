import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { attendreServeur, creerClient, type ClientAudit, type Reponse } from './audit-http';

// Audit bout-en-bout de § Équipe & accès (/marchand/equipe) contre le serveur
// de développement TEL QU'IL TOURNE :
//
//   npx tsx scripts/test-equipe-marchand-audit.ts
//
// Ce qu'il vérifie, par les vraies routes et le vrai proxy :
//   - les rôles prédéfinis sont créés à la première lecture ;
//   - un membre ajouté avec un rôle restreint est borné PAR LE PROXY (API et
//     pages), et les pièces du titulaire lui sont masquées ;
//   - l'invitation : lien d'activation, acceptation, statut ;
//   - les trois règles anti-escalade (accorder plus que soi, toucher plus fort
//     que soi, se toucher soi-même) ;
//   - suspension et accès expiré coupent la session à la requête suivante ;
//   - suppression d'un rôle porté (409, puis réaffectation) ;
//   - retrait puis réinvitation du même email ; journal alimenté.
//
// Tous les comptes créés portent le suffixe ci-dessous et sont supprimés en
// fin d'exécution, succès ou échec.

const MOT_DE_PASSE = 'Audit1234!';
const SUFFIXE = '@equipe-audit.test';
const EMAILS = {
  titulaire: `titulaire${SUFFIXE}`,
  operateur: `operateur${SUFFIXE}`,
  delegue: `delegue${SUFFIXE}`,
  invite: `invite${SUFFIXE}`,
  admin: `admin-boutique${SUFFIXE}`,
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

function statut(r: Reponse, attenduStatut: number, contexte: string) {
  attendu(
    r.status === attenduStatut,
    `${contexte} : ${r.status} au lieu de ${attenduStatut} (${r.texte.slice(0, 160)})`
  );
}

// Connexion avec reprise : le login est limité à 5 essais/min/IP/espace.
async function connexion(client: ClientAudit, email: string, secret = MOT_DE_PASSE): Promise<Reponse> {
  for (let essai = 0; essai < 2; essai++) {
    const r = await client.api('POST', '/api/auth/login', { telephone: email, secret });
    if (r.status !== 429) return r;
    console.log('       (quota de connexion atteint, pause de 65 s)');
    await new Promise((res) => setTimeout(res, 65_000));
  }
  throw new Error('quota de connexion toujours atteint');
}

// Le lien d'invitation ne revient à l'écran que si l'email n'a pas pu partir.
// Pour éprouver l'activation quel que soit l'état du SMTP, le script pose
// lui-même un jeton CONNU sur le compte (même hachage SHA-256 que
// generateResetToken, lib/auth.ts) — le serveur ne voit aucune différence.
async function poserJetonConnu(email: string): Promise<string> {
  const jeton = randomBytes(32).toString('hex');
  await prisma.utilisateur.update({
    where: { email },
    data: {
      resetTokenHash: createHash('sha256').update(jeton).digest('hex'),
      resetTokenExpire: new Date(Date.now() + 3_600_000),
    },
  });
  return jeton;
}

async function nettoyer() {
  const comptes = await prisma.utilisateur.findMany({
    where: { email: { endsWith: SUFFIXE } },
    select: { id: true, marchand: { select: { id: true } } },
  });
  const ids = comptes.map((c) => c.id);
  const marchandIds = comptes.flatMap((c) => (c.marchand ? [c.marchand.id] : []));
  await prisma.journalEquipeMarchand.deleteMany({ where: { OR: [{ marchandId: { in: marchandIds } }, { auteurId: { in: ids } }] } });
  await prisma.marchandMembre.deleteMany({ where: { OR: [{ marchandId: { in: marchandIds } }, { utilisateurId: { in: ids } }] } });
  await prisma.roleMarchand.deleteMany({ where: { marchandId: { in: marchandIds } } });
  await prisma.marchand.deleteMany({ where: { id: { in: marchandIds } } });
  await prisma.utilisateur.deleteMany({ where: { id: { in: ids } } });
}

async function seed() {
  await nettoyer();
  const motDePasseHash = await bcrypt.hash(MOT_DE_PASSE, 10);
  const telephone = `069${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const u = await prisma.utilisateur.create({
    data: { nomComplet: 'Titulaire Audit', email: EMAILS.titulaire, telephone, motDePasseHash, role: 'marchand' },
  });
  await prisma.marchand.create({
    data: {
      utilisateurId: u.id,
      nomBoutique: 'Boutique Audit Équipe',
      statut: 'actif',
      cin: 'AB123456',
      ville: 'Casablanca',
      adresse: '1 rue de l’Audit',
      rib: '007780000000000000000000',
      ribPhotoUrl: 'data:image/png;base64,AAAA',
    },
  });
}

type Role = { id: string; nom: string; cle: string | null; permissions: string[]; nbMembres: number };
type Membre = { id: string; utilisateurId: string; nomComplet: string; statut: string; roleId: string };

async function main() {
  await attendreServeur();
  await seed();

  const titulaire = creerClient('marchand');
  const operateur = creerClient('marchand');
  const delegue = creerClient('marchand');
  const invite = creerClient('marchand');

  let roles: Role[] = [];
  const roleCle = (cle: string) => roles.find((r) => r.cle === cle) as Role;
  let membreOperateur: Membre | null = null;
  let membreDelegue: Membre | null = null;
  let membreAdmin: Membre | null = null;
  let membreInvite: Membre | null = null;
  let roleDelegue: Role | null = null;

  console.log('\n— Titulaire');
  await verifie('le titulaire se connecte', async () => {
    statut(await connexion(titulaire, EMAILS.titulaire), 200, 'login titulaire');
  });
  await verifie('les cinq rôles prédéfinis sont créés à la première lecture', async () => {
    const r = await titulaire.api('GET', '/api/marchands/equipe');
    statut(r, 200, 'GET équipe');
    roles = (r.json?.roles ?? []) as Role[];
    const cles = roles.map((x) => x.cle).sort();
    attendu(
      JSON.stringify(cles) === JSON.stringify(['administrateur', 'comptable', 'gestionnaire', 'lecture', 'operateur']),
      `rôles : ${cles.join(', ')}`
    );
    attendu((r.json?.moi as { estTitulaire: boolean }).estTitulaire, 'estTitulaire devrait être vrai');
  });
  await verifie('une seconde lecture ne duplique pas les rôles', async () => {
    const r = await titulaire.api('GET', '/api/marchands/equipe');
    attendu(((r.json?.roles ?? []) as Role[]).length === 5, 'nombre de rôles modifié');
  });

  console.log('\n— Ajout manuel d’un opérateur et bornage par le proxy');
  await verifie('ajout manuel avec le rôle Opérateur colis', async () => {
    const r = await titulaire.api('POST', '/api/marchands/equipe/membres', {
      mode: 'manuel',
      nomComplet: 'Opérateur Audit',
      email: EMAILS.operateur,
      secret: MOT_DE_PASSE,
      roleId: roleCle('operateur').id,
      poste: 'Préparateur',
    });
    statut(r, 201, 'POST membre');
    membreOperateur = (r.json?.membre ?? null) as Membre;
    attendu(membreOperateur?.statut === 'actif', `statut ${membreOperateur?.statut}`);
  });
  await verifie('un mot de passe faible est refusé', async () => {
    const r = await titulaire.api('POST', '/api/marchands/equipe/membres', {
      mode: 'manuel',
      nomComplet: 'Faible',
      email: `faible${SUFFIXE}`,
      secret: 'abc',
      roleId: roleCle('operateur').id,
    });
    statut(r, 400, 'mot de passe faible');
  });
  await verifie('un email déjà utilisé est refusé', async () => {
    const r = await titulaire.api('POST', '/api/marchands/equipe/membres', {
      mode: 'manuel',
      nomComplet: 'Doublon',
      email: EMAILS.titulaire,
      secret: MOT_DE_PASSE,
      roleId: roleCle('operateur').id,
    });
    statut(r, 409, 'email en double');
  });
  await verifie('l’opérateur se connecte', async () => {
    statut(await connexion(operateur, EMAILS.operateur), 200, 'login opérateur');
  });
  await verifie('opérateur : colis ouverts (lecture)', async () => {
    statut(await operateur.api('GET', '/api/commandes'), 200, 'GET commandes');
  });
  await verifie('opérateur : tableau de bord refusé (403)', async () => {
    statut(await operateur.api('GET', '/api/marchands/dashboard'), 403, 'GET dashboard');
  });
  await verifie('opérateur : factures refusées (403)', async () => {
    statut(await operateur.api('GET', '/api/factures'), 403, 'GET factures');
  });
  await verifie('opérateur : export refusé (403)', async () => {
    statut(await operateur.api('GET', '/api/commandes/export'), 403, 'GET export');
  });
  await verifie('opérateur : suppression de colis refusée (403)', async () => {
    statut(await operateur.api('POST', '/api/commandes/bulk-delete', { colisIds: [] }), 403, 'bulk-delete');
  });
  await verifie('opérateur : équipe fermée, en lecture comme en écriture (403)', async () => {
    statut(await operateur.api('GET', '/api/marchands/equipe'), 403, 'GET équipe');
    statut(
      await operateur.api('POST', '/api/marchands/equipe/roles', { nom: 'X', permissions: ['colis.voir'] }),
      403,
      'POST rôle'
    );
  });
  await verifie('opérateur : profil de la boutique non modifiable, pièces masquées', async () => {
    statut(await operateur.api('PATCH', '/api/marchands/me', { nomBoutique: 'Piratée' }), 403, 'PATCH profil');
    const r = await operateur.api('GET', '/api/marchands/me');
    statut(r, 200, 'GET profil');
    attendu(r.json?.rib === null && r.json?.cin === null && r.json?.ribPhotoUrl === null, 'RIB/CIN visibles');
  });
  await verifie('opérateur : /marchand redirige vers le premier module ouvert (colis)', async () => {
    const r = await operateur.api('GET', '/marchand');
    attendu(r.status === 307 || r.status === 308, `statut ${r.status}`);
    attendu(r.location?.endsWith('/marchand/colis'), `redirigé vers ${r.location}`);
  });
  await verifie('opérateur : page factures redirigée, page nouveau colis ouverte', async () => {
    const f = await operateur.api('GET', '/marchand/factures');
    attendu(f.status === 307 && f.location?.endsWith('/marchand/colis'), `factures → ${f.status} ${f.location}`);
    const n = await operateur.api('GET', '/marchand/colis/nouveau');
    statut(n, 200, 'page nouveau colis');
  });
  await verifie('titulaire : tout reste ouvert', async () => {
    statut(await titulaire.api('GET', '/api/marchands/dashboard'), 200, 'dashboard titulaire');
    const r = await titulaire.api('GET', '/api/marchands/me');
    attendu(r.json?.rib !== null, 'le titulaire doit voir son RIB');
  });

  console.log('\n— Invitation par email');
  await verifie('invitation : compte créé en attente, lien d’activation sur le domaine marchand', async () => {
    const r = await titulaire.api('POST', '/api/marchands/equipe/membres', {
      mode: 'invitation',
      nomComplet: 'Invitée Audit',
      email: EMAILS.invite,
      roleId: roleCle('comptable').id,
    });
    statut(r, 201, 'POST invitation');
    membreInvite = (r.json?.membre ?? null) as Membre;
    attendu(membreInvite?.statut === 'invitation', `statut ${membreInvite?.statut}`);
    const lien = r.json?.lienActivation as string | undefined;
    if (lien) {
      attendu(lien.includes('/reinitialiser-mot-de-passe?token=') && lien.includes('invitation=1'), `lien : ${lien}`);
    } else {
      attendu(r.json?.emailEnvoye === true, 'ni lien renvoyé, ni email envoyé');
      console.log('       (SMTP configuré : email parti, lien non renvoyé — activation éprouvée par jeton posé)');
    }
  });
  await verifie('invitation : l’invitée ne peut pas se connecter avant activation', async () => {
    statut(await connexion(invite, EMAILS.invite), 401, 'login avant activation');
  });
  await verifie('invitation : le renvoi remplace le jeton, l’ancien lien meurt', async () => {
    const ancien = await poserJetonConnu(EMAILS.invite);
    const r = await titulaire.api('POST', `/api/marchands/equipe/membres/${membreInvite?.id}/invitation`);
    statut(r, 200, 'renvoi');
    const ko = await invite.api('POST', '/api/auth/reinitialiser-mot-de-passe', { token: ancien, secret: MOT_DE_PASSE });
    statut(ko, 400, 'ancien lien après renvoi');
  });
  await verifie('invitation : activation par le lien, puis statut « actif »', async () => {
    const jeton = await poserJetonConnu(EMAILS.invite);
    statut(
      await invite.api('POST', '/api/auth/reinitialiser-mot-de-passe', { token: jeton, secret: MOT_DE_PASSE }),
      200,
      'activation'
    );
    const r = await titulaire.api('GET', '/api/marchands/equipe');
    const m = ((r.json?.membres ?? []) as Membre[]).find((x) => x.id === membreInvite?.id);
    attendu(m?.statut === 'actif', `statut après activation : ${m?.statut}`);
  });
  await verifie('invitation : la comptable ouvre les factures mais ne crée pas de colis', async () => {
    statut(await connexion(invite, EMAILS.invite), 200, 'login invitée');
    statut(await invite.api('GET', '/api/factures'), 200, 'factures');
    statut(await invite.api('POST', '/api/commandes', {}), 403, 'création de colis');
  });

  console.log('\n— Délégation et règles anti-escalade');
  await verifie('création d’un rôle personnalisé « Responsable équipe »', async () => {
    const r = await titulaire.api('POST', '/api/marchands/equipe/roles', {
      nom: 'Responsable équipe',
      description: 'Gère l’équipe et les colis',
      // Couvre l'Opérateur colis (il pourra le gérer) sans couvrir
      // l'Administrateur ni les factures (il ne pourra ni l'un ni l'autre).
      permissions: ['equipe.gerer', ...roleCle('operateur').permissions],
    });
    statut(r, 201, 'POST rôle');
    roleDelegue = r.json?.role as Role;
    // Dépendances complétées côté serveur.
    for (const k of ['equipe.voir', 'colis.voir', 'catalogue.voir']) {
      attendu(roleDelegue.permissions.includes(k), `dépendance ${k} absente`);
    }
  });
  await verifie('un nom de rôle en double est refusé (409)', async () => {
    const r = await titulaire.api('POST', '/api/marchands/equipe/roles', {
      nom: 'responsable ÉQUIPE'.replace('É', 'é'),
      permissions: ['colis.voir'],
    });
    statut(r, 409, 'doublon');
  });
  await verifie('un rôle prédéfini ne se modifie pas (409)', async () => {
    statut(
      await titulaire.api('PATCH', `/api/marchands/equipe/roles/${roleCle('lecture').id}`, { permissions: ['colis.voir'] }),
      409,
      'PATCH prédéfini'
    );
  });
  await verifie('ajout du délégué et d’un administrateur', async () => {
    const d = await titulaire.api('POST', '/api/marchands/equipe/membres', {
      mode: 'manuel',
      nomComplet: 'Délégué Audit',
      email: EMAILS.delegue,
      secret: MOT_DE_PASSE,
      roleId: roleDelegue?.id,
    });
    statut(d, 201, 'POST délégué');
    membreDelegue = d.json?.membre as Membre;
    const a = await titulaire.api('POST', '/api/marchands/equipe/membres', {
      mode: 'manuel',
      nomComplet: 'Admin Boutique Audit',
      email: EMAILS.admin,
      secret: MOT_DE_PASSE,
      roleId: roleCle('administrateur').id,
    });
    statut(a, 201, 'POST admin');
    membreAdmin = a.json?.membre as Membre;
  });
  await verifie('le délégué se connecte et voit l’équipe', async () => {
    statut(await connexion(delegue, EMAILS.delegue), 200, 'login délégué');
    const r = await delegue.api('GET', '/api/marchands/equipe');
    statut(r, 200, 'GET équipe');
    attendu(!(r.json?.moi as { estTitulaire: boolean }).estTitulaire, 'le délégué n’est pas titulaire');
  });
  await verifie('règle 1 : il ne peut pas créer un rôle plus large que ses droits', async () => {
    const r = await delegue.api('POST', '/api/marchands/equipe/roles', { nom: 'Trop', permissions: ['factures.voir'] });
    statut(r, 403, 'rôle trop large');
  });
  await verifie('règle 1 : il ne peut pas attribuer le rôle Administrateur', async () => {
    const r = await delegue.api('POST', '/api/marchands/equipe/membres', {
      mode: 'manuel',
      nomComplet: 'Escalade',
      email: `escalade${SUFFIXE}`,
      secret: MOT_DE_PASSE,
      roleId: roleCle('administrateur').id,
    });
    statut(r, 403, 'attribution Administrateur');
  });
  await verifie('règle 2 : il ne peut pas suspendre un membre plus puissant', async () => {
    statut(
      await delegue.api('PATCH', `/api/marchands/equipe/membres/${membreAdmin?.id}`, { actif: false }),
      403,
      'suspendre admin'
    );
  });
  await verifie('règle 3 : il ne peut pas se modifier lui-même, ni son propre rôle', async () => {
    statut(
      await delegue.api('PATCH', `/api/marchands/equipe/membres/${membreDelegue?.id}`, { poste: 'Chef' }),
      403,
      'se modifier'
    );
    statut(
      await delegue.api('PATCH', `/api/marchands/equipe/roles/${roleDelegue?.id}`, { permissions: ['colis.voir'] }),
      403,
      'modifier son rôle'
    );
  });
  await verifie('mais il peut gérer un membre moins puissant (poste de l’opérateur)', async () => {
    statut(
      await delegue.api('PATCH', `/api/marchands/equipe/membres/${membreOperateur?.id}`, { poste: 'Chef de quai' }),
      200,
      'modifier opérateur'
    );
  });
  await verifie('un membre d’une autre boutique est introuvable (404)', async () => {
    statut(
      await delegue.api('PATCH', '/api/marchands/equipe/membres/00000000-0000-0000-0000-000000000000', { poste: 'x' }),
      404,
      'membre inconnu'
    );
  });

  console.log('\n— Suspension, expiration, rôle, retrait');
  await verifie('suspension : la session de l’opérateur tombe à la requête suivante', async () => {
    statut(
      await titulaire.api('PATCH', `/api/marchands/equipe/membres/${membreOperateur?.id}`, { actif: false }),
      200,
      'suspendre'
    );
    statut(await operateur.api('GET', '/api/commandes'), 401, 'requête après suspension');
    statut(
      await titulaire.api('PATCH', `/api/marchands/equipe/membres/${membreOperateur?.id}`, { actif: true }),
      200,
      'réactiver'
    );
  });
  await verifie('une date d’expiration passée est refusée par l’API', async () => {
    statut(
      await titulaire.api('PATCH', `/api/marchands/equipe/membres/${membreOperateur?.id}`, { accesExpireLe: '2020-01-01' }),
      400,
      'expiration passée'
    );
  });
  await verifie('accès expiré : session coupée et connexion refusée avec un message clair', async () => {
    await prisma.marchandMembre.update({
      where: { id: membreOperateur?.id },
      data: { accesExpireLe: new Date(Date.now() - 1000) },
    });
    statut(await operateur.api('GET', '/api/commandes'), 401, 'requête après expiration');
    const r = await connexion(operateur, EMAILS.operateur);
    statut(r, 403, 'login expiré');
    attendu(String(r.json?.error ?? '').includes('expiré'), `message : ${r.json?.error}`);
    await prisma.marchandMembre.update({ where: { id: membreOperateur?.id }, data: { accesExpireLe: null } });
  });
  await verifie('changement de rôle appliqué immédiatement (Lecture seule → plus d’écriture)', async () => {
    statut(await connexion(operateur, EMAILS.operateur), 200, 'reconnexion');
    statut(
      await titulaire.api('PATCH', `/api/marchands/equipe/membres/${membreOperateur?.id}`, { roleId: roleCle('lecture').id }),
      200,
      'changer rôle'
    );
    statut(await operateur.api('POST', '/api/commandes', {}), 403, 'création après passage en lecture');
    statut(await operateur.api('GET', '/api/commandes'), 200, 'lecture toujours ouverte');
  });
  await verifie('supprimer un rôle encore porté : 409 sans remplaçant, puis réaffectation', async () => {
    statut(await titulaire.api('DELETE', `/api/marchands/equipe/roles/${roleDelegue?.id}`), 409, 'sans remplaçant');
    statut(
      await titulaire.api(
        'DELETE',
        `/api/marchands/equipe/roles/${roleDelegue?.id}?reaffecterVers=${roleCle('lecture').id}`
      ),
      200,
      'avec remplaçant'
    );
    const m = await prisma.marchandMembre.findUnique({ where: { id: membreDelegue?.id } });
    attendu(m?.roleId === roleCle('lecture').id, 'le délégué n’a pas été réaffecté');
  });
  await verifie('retrait puis réinvitation du même email', async () => {
    statut(await titulaire.api('DELETE', `/api/marchands/equipe/membres/${membreOperateur?.id}`), 200, 'retirer');
    statut(await operateur.api('GET', '/api/commandes'), 401, 'session après retrait');
    const r = await titulaire.api('POST', '/api/marchands/equipe/membres', {
      mode: 'manuel',
      nomComplet: 'Opérateur Revenu',
      email: EMAILS.operateur,
      secret: MOT_DE_PASSE,
      roleId: roleCle('operateur').id,
    });
    statut(r, 201, 'réinvitation');
  });
  await verifie('le journal trace les gestes, du plus récent au plus ancien', async () => {
    const r = await titulaire.api('GET', '/api/marchands/equipe/journal');
    statut(r, 200, 'journal');
    const actions = ((r.json?.data ?? []) as { action: string }[]).map((l) => l.action);
    for (const a of ['membre_ajoute', 'membre_invite', 'role_cree', 'membre_suspendu', 'role_change', 'role_supprime', 'membre_retire']) {
      attendu(actions.includes(a), `action ${a} absente du journal`);
    }
    attendu(actions[0] === 'membre_ajoute', `la plus récente devrait être la réinvitation, pas ${actions[0]}`);
  });

  console.log(`\n${reussis} OK, ${echoues} KO`);
}

main()
  .catch((err) => {
    echoues++;
    console.error(err);
  })
  .finally(async () => {
    await nettoyer().catch((e) => console.error('nettoyage', e));
    await prisma.$disconnect();
    process.exit(echoues > 0 ? 1 : 0);
  });
