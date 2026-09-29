import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { ROLE_PERMISSIONS } from '../lib/permissions';
import { attendreServeur, creerClient, type ClientAudit } from './audit-http';

// Audit local du module comptabilité (§ /admin/comptabilite), exécutable via
//   npx tsx scripts/test-comptabilite-audit.ts
// avec un serveur de développement en cours (npm run dev).
//
// Couvre ce que les tests purs (lib/__tests__/journal-comptable.test.ts) ne
// peuvent pas atteindre : les VRAIES routes, les trois couches d'accès
// (proxy → rôle → permission), les transactions Prisma et les invariants qui
// n'existent qu'en base :
//   - les totaux du journal suivent chaque geste (création, modification,
//     neutralisation, suppression, restauration) ;
//   - une neutralisation suit toujours son écriture, et ne se désaccorde
//     jamais d'elle, quel que soit l'enchaînement de gestes ;
//   - chaque manipulation laisse sa trace dans HistoriqueComptable, et une
//     modification sans effet n'en laisse aucune ;
//   - le responsable saisit et neutralise, mais ne réécrit ni ne supprime.
//
// Les écritures AUTOMATIQUES (tournée, facture, paie) sont couvertes par
// scripts/test-facturation-paiement-audit.ts, qui les produit réellement.
//
// Toutes les données créées sont préfixées et supprimées en fin d'exécution,
// succès ou échec.

const PREFIXE = `AUDIT-${Date.now()}`;
const MOT_DE_PASSE = 'Audit1234!';
// Plus petit PNG valide (1×1) : un vrai justificatif, accepté par la liste blanche.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;

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

function attendu(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function egal(reel: unknown, espere: unknown, quoi: string) {
  if (reel !== espere) throw new Error(`${quoi} = ${String(reel)}, attendu ${String(espere)}`);
}

function statut(r: { status: number; texte: string }, espere: number, quoi: string) {
  if (r.status !== espere) throw new Error(`${quoi} : HTTP ${r.status}, attendu ${espere} — ${r.texte.slice(0, 200)}`);
}

// --- Jeu de données ---------------------------------------------------------

async function creerComptes() {
  const hash = await bcrypt.hash(MOT_DE_PASSE, 10);
  const base = (suffixe: string, role: 'admin' | 'responsable' | 'moderateur', permissions: string[]) =>
    prisma.utilisateur.create({
      data: {
        nomComplet: `${PREFIXE} ${suffixe}`,
        email: `${PREFIXE.toLowerCase()}-${suffixe.toLowerCase()}@audit.local`,
        motDePasseHash: hash,
        role,
        permissions,
      },
    });
  return {
    admin: await base('Admin', 'admin', ROLE_PERMISSIONS.admin),
    responsable: await base('Responsable', 'responsable', ROLE_PERMISSIONS.responsable),
    moderateur: await base('Moderateur', 'moderateur', ROLE_PERMISSIONS.moderateur),
  };
}

async function nettoyer(utilisateurIds: string[]) {
  await prisma.historiqueComptable.deleteMany({ where: { auteurId: { in: utilisateurIds } } });
  // Les neutralisations d'abord : elles pointent leur origine.
  await prisma.transaction.deleteMany({
    where: { auteurId: { in: utilisateurIds }, transactionOrigineId: { not: null } },
  });
  await prisma.transaction.deleteMany({ where: { auteurId: { in: utilisateurIds } } });
  await prisma.commandeStockHub.deleteMany({ where: { auteurId: { in: utilisateurIds } } });
  await prisma.categorieComptable.deleteMany({ where: { nom: { startsWith: PREFIXE } } });
  await prisma.utilisateur.deleteMany({ where: { id: { in: utilisateurIds } } });
}

// --- Aides ------------------------------------------------------------------

async function connecter(client: ClientAudit, email: string) {
  const r = await client.api('POST', '/api/auth/login', { telephone: email, secret: MOT_DE_PASSE });
  statut(r, 200, `connexion ${email}`);
  attendu(client.sessionOuverte(), 'aucun cookie de session posé');
}

type Journal = {
  data: Array<Record<string, unknown>>;
  totaux: { totalEntrees: number; totalSorties: number; solde: number };
};

async function journal(client: ClientAudit, supprimees = false): Promise<Journal> {
  const r = await client.api('GET', supprimees ? '/api/finance?supprimees=1' : '/api/finance');
  statut(r, 200, 'lecture du journal');
  return r.json as unknown as Journal;
}

async function solde(client: ClientAudit): Promise<number> {
  return Math.round((await journal(client)).totaux.solde * 100) / 100;
}

async function lire(id: string) {
  return prisma.transaction.findUniqueOrThrow({ where: { id }, omit: { preuveUrl: true } });
}

async function historique(cible: string, id: string) {
  return prisma.historiqueComptable.findMany({ where: { cibleId: id, cibleType: cible as never }, orderBy: { dateAction: 'asc' } });
}

// --- Audit ------------------------------------------------------------------

async function main() {
  console.log(`\n§ Audit comptabilité — ${PREFIXE}\n`);
  await attendreServeur();

  const comptes = await creerComptes();
  const admin = creerClient('admin');
  const responsable = creerClient('admin');
  const moderateur = creerClient('admin');

  const ids: Record<string, string> = {};

  try {
    console.log('0. Sessions et accès');
    await verifie('connexion admin, responsable, modérateur', async () => {
      await connecter(admin, comptes.admin.email!);
      await connecter(responsable, comptes.responsable.email!);
      await connecter(moderateur, comptes.moderateur.email!);
    });
    await verifie('un compte sans droit comptable ne lit ni le journal ni les catégories', async () => {
      statut(await moderateur.api('GET', '/api/finance'), 403, 'GET /api/finance');
      statut(await moderateur.api('GET', '/api/finance/categories'), 403, 'GET categories');
      statut(await moderateur.api('GET', '/api/commandes-stock-hub'), 403, 'GET commandes');
    });
    await verifie('le responsable lit le journal, pas la corbeille', async () => {
      statut(await responsable.api('GET', '/api/finance'), 200, 'GET journal');
      statut(await responsable.api('GET', '/api/finance?supprimees=1'), 403, 'GET corbeille');
    });

    // =================================================================
    console.log('\n1. Catégories');
    // =================================================================
    let idPaiementClient = '';

    await verifie('les catégories système sont présentes et protégées', async () => {
      const r = await admin.api('GET', '/api/finance/categories?portee=transaction');
      statut(r, 200, 'GET');
      const liste = r.json?.data as Array<{ id: string; nom: string; protegee: boolean }>;
      const pc = liste.find((c) => c.nom === 'Paiement client');
      const sal = liste.find((c) => c.nom === 'Salaire');
      attendu(!!pc && pc.protegee, '« Paiement client » absente ou non protégée');
      attendu(!!sal && sal.protegee, '« Salaire » absente ou non protégée');
      idPaiementClient = pc!.id;
    });

    await verifie('l’admin crée une catégorie de transaction (tracée)', async () => {
      const r = await admin.api('POST', '/api/finance/categories', { nom: `  ${PREFIXE}   Loyer `, portee: 'transaction' });
      statut(r, 201, 'POST');
      egal(r.json?.nom, `${PREFIXE} Loyer`, 'nom normalisé');
      ids.catLoyer = String(r.json?.id);
      const h = await historique('categorie', ids.catLoyer);
      egal(h.length, 1, 'traces');
      egal(h[0].action, 'creation', 'action tracée');
    });

    await verifie('un doublon, même en casse différente, est refusé', async () => {
      const r = await admin.api('POST', '/api/finance/categories', { nom: `${PREFIXE} LOYER`, portee: 'transaction' });
      statut(r, 409, 'doublon');
    });

    await verifie('le même nom reste libre sur l’autre carte (commandes)', async () => {
      const r = await admin.api('POST', '/api/finance/categories', { nom: `${PREFIXE} Loyer`, portee: 'commande_stock_hub' });
      statut(r, 201, 'POST portée commande');
      ids.catCommande = String(r.json?.id);
    });

    await verifie('renommer : tracé avant/après ; vers un nom pris : refusé', async () => {
      const r = await admin.api('PATCH', `/api/finance/categories/${ids.catLoyer}`, { nom: `${PREFIXE} Loyers hubs` });
      statut(r, 200, 'PATCH');
      const autre = await admin.api('POST', '/api/finance/categories', { nom: `${PREFIXE} Divers`, portee: 'transaction' });
      statut(autre, 201, 'POST Divers');
      ids.catDivers = String(autre.json?.id);
      statut(
        await admin.api('PATCH', `/api/finance/categories/${ids.catDivers}`, { nom: `${PREFIXE} loyers HUBS` }),
        409,
        'renommage vers un nom pris'
      );
      const h = await historique('categorie', ids.catLoyer);
      const derniere = h[h.length - 1];
      egal(derniere.action, 'modification', 'action');
      egal((derniere.apres as { nom: string }).nom, `${PREFIXE} Loyers hubs`, 'nom après');
    });

    await verifie('une catégorie système ne se supprime pas', async () => {
      statut(await admin.api('DELETE', `/api/finance/categories/${idPaiementClient}`), 409, 'DELETE Paiement client');
    });

    await verifie('le responsable ne gère pas les catégories', async () => {
      statut(await responsable.api('POST', '/api/finance/categories', { nom: `${PREFIXE} X`, portee: 'transaction' }), 403, 'POST');
      statut(await responsable.api('PATCH', `/api/finance/categories/${ids.catDivers}`, { nom: 'Y' }), 403, 'PATCH');
      statut(await responsable.api('DELETE', `/api/finance/categories/${ids.catDivers}`), 403, 'DELETE');
    });

    await verifie('une catégorie inutilisée se supprime (tracée)', async () => {
      statut(await admin.api('DELETE', `/api/finance/categories/${ids.catDivers}`), 200, 'DELETE');
      const reste = await prisma.categorieComptable.findUnique({ where: { id: ids.catDivers } });
      egal(reste, null, 'ligne restante');
      const h = await historique('categorie', ids.catDivers);
      egal(h[h.length - 1].action, 'suppression', 'trace de suppression');
    });

    // =================================================================
    console.log('\n2. Saisie d’une transaction');
    // =================================================================
    let soldeInitial = 0;

    await verifie('saisies invalides refusées (titre, montant, catégorie d’une autre carte)', async () => {
      soldeInitial = await solde(admin);
      const base = { titre: 'x', montant: 100, type: 'revenu', categorieId: ids.catLoyer, dateEffet: '2026-09-10' };
      statut(await responsable.api('POST', '/api/finance', { ...base, titre: '  ' }), 400, 'titre vide');
      statut(await responsable.api('POST', '/api/finance', { ...base, montant: -5 }), 400, 'montant négatif');
      statut(await responsable.api('POST', '/api/finance', { ...base, montant: 1e9 }), 400, 'montant hors colonne');
      statut(await responsable.api('POST', '/api/finance', { ...base, categorieId: ids.catCommande }), 400, 'catégorie de commande');
      statut(await responsable.api('POST', '/api/finance', { ...base, preuveUrl: SVG }), 400, 'justificatif SVG');
    });

    await verifie('le responsable saisit une recette : journal et solde à jour', async () => {
      const r = await responsable.api('POST', '/api/finance', {
        titre: `${PREFIXE} Encaissement`,
        montant: 1000,
        type: 'revenu',
        categorieId: ids.catLoyer,
        dateEffet: '2026-09-10',
        description: 'Première saisie',
      });
      statut(r, 201, 'POST');
      ids.t1 = String(r.json?.id);
      egal(typeof r.json?.montant, 'number', 'montant sérialisé en nombre');
      const j = await journal(admin);
      const ligne = j.data.find((t) => t.id === ids.t1);
      attendu(!!ligne, 'écriture absente du journal');
      egal((ligne!.categorie as { nom: string }).nom, `${PREFIXE} Loyers hubs`, 'catégorie exposée');
      egal(await solde(admin), soldeInitial + 1000, 'solde');
    });

    // =================================================================
    console.log('\n3. Modification (admin seul)');
    // =================================================================

    await verifie('le responsable ne modifie pas', async () => {
      statut(await responsable.api('PATCH', `/api/finance/${ids.t1}`, { titre: 'Piraté' }), 403, 'PATCH');
    });

    await verifie('modifier le titre seul ne touche à rien d’autre, et se trace', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { titre: `${PREFIXE} Encaissement corrigé` }), 200, 'PATCH');
      const t = await lire(ids.t1);
      egal(t.titre, `${PREFIXE} Encaissement corrigé`, 'titre');
      egal(Number(t.montant), 1000, 'montant inchangé');
      egal(t.description, 'Première saisie', 'description inchangée');
      const h = await historique('transaction', ids.t1);
      egal(h.length, 1, 'traces');
      egal(JSON.stringify(Object.keys(h[0].apres as object)), '["titre"]', 'champs tracés');
    });

    await verifie('un PATCH sans effet ne laisse aucune trace', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { montant: 1000, titre: `${PREFIXE} Encaissement corrigé` }), 200, 'PATCH');
      egal((await historique('transaction', ids.t1)).length, 1, 'traces');
    });

    await verifie('modifier le montant déplace le solde du même écart', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { montant: 1200 }), 200, 'PATCH');
      egal(await solde(admin), soldeInitial + 1200, 'solde');
    });

    await verifie('PATCH invalide : corps vide, catégorie d’une autre carte', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, {}), 400, 'corps vide');
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { categorieId: ids.catCommande }), 400, 'catégorie de commande');
      statut(await admin.api('PATCH', '/api/finance/00000000-0000-0000-0000-000000000000', { titre: 'x' }), 404, 'inconnue');
    });

    await verifie('justificatif : joint, servi, remplacé, retiré', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { preuveUrl: PNG }), 200, 'joindre');
      const p = await admin.api('GET', `/api/finance/${ids.t1}/preuve`);
      statut(p, 200, 'GET preuve');
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { preuveUrl: PNG }), 200, 'remplacer');
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { preuveUrl: SVG }), 400, 'SVG refusé');
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { preuveUrl: null }), 200, 'retirer');
      statut(await admin.api('GET', `/api/finance/${ids.t1}/preuve`), 404, 'preuve retirée');
      const etats = (await historique('transaction', ids.t1))
        .map((h) => (h.apres as { preuve?: string }).preuve)
        .filter(Boolean);
      egal(etats.join(','), 'joint,remplacé,aucun', 'états du justificatif tracés');
    });

    // =================================================================
    console.log('\n4. Neutralisation');
    // =================================================================

    await verifie('le responsable neutralise : écriture inverse, solde revenu au départ', async () => {
      const r = await responsable.api('POST', `/api/finance/${ids.t1}/annuler`, {});
      statut(r, 201, 'POST annuler');
      ids.n1 = String(r.json?.id);
      const origine = await lire(ids.t1);
      const neutr = await lire(ids.n1);
      egal(origine.estAnnulee, true, 'origine neutralisée');
      egal(neutr.transactionOrigineId, ids.t1, 'lien');
      egal(neutr.type, 'depense', 'sens inverse');
      egal(Number(neutr.montant), 1200, 'même montant');
      egal(neutr.categorieId, origine.categorieId, 'même catégorie');
      attendu(neutr.titre.startsWith('Neutralisation — '), `titre « ${neutr.titre} »`);
      egal(await solde(admin), soldeInitial, 'solde');
    });

    await verifie('pas de seconde neutralisation, ni de neutralisation d’une neutralisation', async () => {
      statut(await admin.api('POST', `/api/finance/${ids.t1}/annuler`, {}), 400, 'deuxième fois');
      statut(await admin.api('POST', `/api/finance/${ids.n1}/annuler`, {}), 400, 'neutraliser la neutralisation');
    });

    await verifie('le montant d’une neutralisation ne se modifie pas seul', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.n1}`, { montant: 50 }), 409, 'PATCH montant');
      statut(await admin.api('PATCH', `/api/finance/${ids.n1}`, { titre: `${PREFIXE} Neutralisation renommée` }), 200, 'PATCH titre');
    });

    await verifie('modifier l’origine entraîne sa neutralisation : le solde reste nul', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { montant: 1500, type: 'depense' }), 200, 'PATCH');
      const neutr = await lire(ids.n1);
      egal(Number(neutr.montant), 1500, 'montant suivi');
      egal(neutr.type, 'revenu', 'sens inversé suivi');
      egal(await solde(admin), soldeInitial, 'solde');
      const h = await historique('transaction', ids.n1);
      attendu(h.some((l) => l.action === 'modification' && 'montant' in (l.apres as object)), 'suivi non tracé');
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { montant: 1200, type: 'revenu' }), 200, 'retour');
    });

    // =================================================================
    console.log('\n5. Suppression et corbeille');
    // =================================================================

    await verifie('le responsable ne supprime pas', async () => {
      statut(await responsable.api('DELETE', `/api/finance/${ids.t1}`), 403, 'DELETE');
    });

    await verifie('supprimer une écriture neutralisée emporte sa neutralisation, au même instant', async () => {
      statut(await admin.api('DELETE', `/api/finance/${ids.t1}`), 200, 'DELETE');
      const o = await lire(ids.t1);
      const n = await lire(ids.n1);
      attendu(!!o.supprimeLe && !!n.supprimeLe, 'une des deux reste active');
      egal(o.supprimeLe!.getTime(), n.supprimeLe!.getTime(), 'même horodatage');
      egal(o.supprimeParId, comptes.admin.id, 'auteur de la suppression');
      const j = await journal(admin);
      attendu(!j.data.some((t) => t.id === ids.t1 || t.id === ids.n1), 'encore dans le journal');
      egal(await solde(admin), soldeInitial, 'solde');
      const c = await journal(admin, true);
      attendu(c.data.some((t) => t.id === ids.t1) && c.data.some((t) => t.id === ids.n1), 'absentes de la corbeille');
    });

    await verifie('une écriture supprimée ne se modifie, ne se neutralise ni ne se re-supprime', async () => {
      statut(await admin.api('PATCH', `/api/finance/${ids.t1}`, { titre: 'x' }), 409, 'PATCH');
      statut(await admin.api('POST', `/api/finance/${ids.t1}/annuler`, {}), 409, 'annuler');
      statut(await admin.api('DELETE', `/api/finance/${ids.t1}`), 409, 'DELETE');
    });

    await verifie('la neutralisation ne se restaure pas avant son origine', async () => {
      statut(await admin.api('POST', `/api/finance/${ids.n1}/restaurer`, {}), 409, 'restaurer neutralisation');
      statut(await responsable.api('POST', `/api/finance/${ids.t1}/restaurer`, {}), 403, 'responsable');
    });

    await verifie('restaurer l’origine ramène sa neutralisation et l’état « neutralisée »', async () => {
      statut(await admin.api('POST', `/api/finance/${ids.t1}/restaurer`, {}), 200, 'restaurer');
      const o = await lire(ids.t1);
      const n = await lire(ids.n1);
      egal(o.supprimeLe, null, 'origine restaurée');
      egal(n.supprimeLe, null, 'neutralisation restaurée');
      egal(o.estAnnulee, true, 'toujours neutralisée');
      egal(await solde(admin), soldeInitial, 'solde');
      statut(await admin.api('POST', `/api/finance/${ids.t1}/restaurer`, {}), 409, 'restaurer deux fois');
    });

    await verifie('supprimer la neutralisation seule réactive l’origine (solde +1200)', async () => {
      statut(await admin.api('DELETE', `/api/finance/${ids.n1}`), 200, 'DELETE neutralisation');
      egal((await lire(ids.t1)).estAnnulee, false, 'origine réactivée');
      egal((await lire(ids.t1)).supprimeLe, null, 'origine toujours au journal');
      egal(await solde(admin), soldeInitial + 1200, 'solde');
    });

    await verifie('pas de seconde neutralisation tant que la première est en corbeille', async () => {
      statut(await admin.api('POST', `/api/finance/${ids.t1}/annuler`, {}), 409, 'annuler');
    });

    await verifie('restaurer la neutralisation la remet en vigueur (solde nul)', async () => {
      statut(await admin.api('POST', `/api/finance/${ids.n1}/restaurer`, {}), 200, 'restaurer');
      egal((await lire(ids.t1)).estAnnulee, true, 'origine neutralisée');
      egal(await solde(admin), soldeInitial, 'solde');
    });

    await verifie('toutes ces manipulations sont dans l’historique, lisible par le responsable', async () => {
      const r = await responsable.api('GET', `/api/finance/historique?cible=transaction&id=${ids.t1}`);
      statut(r, 200, 'GET historique');
      const actions = (r.json?.data as Array<{ action: string }>).map((l) => l.action);
      for (const a of ['modification', 'suppression', 'restauration']) {
        attendu(actions.includes(a), `action « ${a} » absente`);
      }
    });

    await verifie('une catégorie portée (même par une pièce en corbeille) ne se supprime pas', async () => {
      statut(await admin.api('DELETE', `/api/finance/categories/${ids.catLoyer}`), 409, 'DELETE');
    });

    // =================================================================
    console.log('\n6. Commandes d’inventaire');
    // =================================================================

    await verifie('création avec catégorie ; une catégorie de transaction est refusée', async () => {
      const base = { titre: `${PREFIXE} Rayonnage`, montant: 800, modePaiement: 'Virement', dateCommande: '2026-09-12' };
      statut(await responsable.api('POST', '/api/commandes-stock-hub', { ...base, categorieId: ids.catLoyer }), 400, 'mauvaise portée');
      const r = await responsable.api('POST', '/api/commandes-stock-hub', { ...base, categorieId: ids.catCommande });
      statut(r, 201, 'POST');
      ids.c1 = String(r.json?.id);
      egal((r.json?.categorie as { id: string }).id, ids.catCommande, 'catégorie');
      egal(typeof r.json?.montant, 'number', 'montant en nombre');
    });

    await verifie('le responsable fait avancer le statut, mais ne réécrit ni ne supprime', async () => {
      statut(await responsable.api('PATCH', `/api/commandes-stock-hub/${ids.c1}/statut`, { statut: 'commandee' }), 200, 'statut');
      statut(await responsable.api('PATCH', `/api/commandes-stock-hub/${ids.c1}`, { titre: 'x' }), 403, 'PATCH');
      statut(await responsable.api('DELETE', `/api/commandes-stock-hub/${ids.c1}`), 403, 'DELETE');
    });

    await verifie('l’admin réécrit la commande (tracé) ; le statut n’y passe pas', async () => {
      statut(await admin.api('PATCH', `/api/commandes-stock-hub/${ids.c1}`, { statut: 'recue' }), 400, 'statut par PATCH');
      statut(
        await admin.api('PATCH', `/api/commandes-stock-hub/${ids.c1}`, { titre: `${PREFIXE} Rayonnage lourd`, montant: 950, categorieId: null }),
        200,
        'PATCH'
      );
      const c = await prisma.commandeStockHub.findUniqueOrThrow({ where: { id: ids.c1 }, omit: { preuveUrl: true } });
      egal(Number(c.montant), 950, 'montant');
      egal(c.categorieId, null, 'catégorie retirée');
      egal(c.statut, 'commandee', 'statut inchangé');
      const h = await historique('commande_stock_hub', ids.c1);
      egal(h.length, 1, 'traces');
      egal(Object.keys(h[0].apres as object).sort().join(','), 'categorie,montant,titre', 'champs tracés');
    });

    await verifie('suppression : hors liste, en corbeille, statut figé ; restauration', async () => {
      statut(await admin.api('DELETE', `/api/commandes-stock-hub/${ids.c1}`), 200, 'DELETE');
      const liste = await admin.api('GET', '/api/commandes-stock-hub');
      attendu(!(liste.json?.data as Array<{ id: string }>).some((c) => c.id === ids.c1), 'encore dans la liste');
      const corbeille = await admin.api('GET', '/api/commandes-stock-hub?supprimees=1');
      attendu((corbeille.json?.data as Array<{ id: string }>).some((c) => c.id === ids.c1), 'absente de la corbeille');
      statut(await responsable.api('GET', '/api/commandes-stock-hub?supprimees=1'), 403, 'corbeille responsable');
      statut(await admin.api('PATCH', `/api/commandes-stock-hub/${ids.c1}/statut`, { statut: 'recue' }), 409, 'statut en corbeille');
      statut(await admin.api('POST', `/api/commandes-stock-hub/${ids.c1}/restaurer`, {}), 200, 'restaurer');
      statut(await admin.api('PATCH', `/api/commandes-stock-hub/${ids.c1}/statut`, { statut: 'recue' }), 200, 'statut après restauration');
    });
  } finally {
    await nettoyer([comptes.admin.id, comptes.responsable.id, comptes.moderateur.id]);
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
