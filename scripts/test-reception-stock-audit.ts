import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { api, attendreServeur, sessionOuverte } from './audit-http';

// Audit local du circuit « réception de stock », exécutable via
//   npx tsx scripts/test-reception-stock-audit.ts
// avec un serveur de développement en cours (npm run dev). La configuration
// d'hôte du dépôt est reprise telle quelle par scripts/audit-http.ts : il n'y
// a ni serveur à reconfigurer ni variable à surcharger.
//
// Contrairement aux deux autres scripts d'audit de ce dossier, celui-ci
// n'appelle PAS les fonctions partagées : il tape les VRAIES routes HTTP.
// La logique auditée ici (garde-fou du retour arrière, clôture de réception,
// traçabilité de l'auteur) vit entièrement dans les handlers de route, que la
// dépendance à next/headers rend inappelables hors serveur — la rejouer
// reviendrait à tester une re-implémentation plutôt que le code livré.
//
// Trois volets, un par décision produit du 26/08/2026 :
//   1. Traçabilité — tout mouvement de stock nomme son auteur, et la
//      suppression d'un compte ne l'efface pas (ON DELETE SET NULL).
//   2. Retour arrière — refusé (409) tant qu'il n'est pas confirmé
//      explicitement, y compris sur les produits à variantes où les compteurs
//      du produit lui-même valent 0.
//   3. Clôture de réception — solde le reliquat, trace le détail, ouvre une
//      réclamation contre le marchand.
//
// Toutes les données créées sont préfixées et supprimées en fin d'exécution,
// succès ou échec.

const PREFIXE = `AUDIT-${Date.now()}`;
const MOT_DE_PASSE = 'Audit1234!';

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

// --- Jeu de données ---------------------------------------------------------

async function creerJeuDeDonnees() {
  const hash = await bcrypt.hash(MOT_DE_PASSE, 10);

  const admin = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Agent Entrepot`,
      email: `${PREFIXE.toLowerCase()}-admin@audit.local`,
      motDePasseHash: hash,
      role: 'admin',
    },
  });

  const utilisateurMarchand = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Marchand`,
      email: `${PREFIXE.toLowerCase()}-marchand@audit.local`,
      motDePasseHash: hash,
      role: 'marchand',
    },
  });

  const marchand = await prisma.marchand.create({
    data: {
      utilisateurId: utilisateurMarchand.id,
      nomBoutique: `${PREFIXE} Boutique`,
      statut: 'actif',
    },
  });

  // Produit simple : le marchand déclare 10 pièces, rien n'est encore validé.
  const produitSimple = await prisma.produit.create({
    data: {
      marchandId: marchand.id,
      nom: `${PREFIXE} Chaussures`,
      reference: `${PREFIXE}-SIMPLE`,
      quantiteEnCours: 10,
    },
  });

  // Produit à variantes : les compteurs du PRODUIT restent à 0, tout vit sur
  // les variantes — c'est l'état qui piège une lecture naïve.
  const produitVariantes = await prisma.produit.create({
    data: {
      marchandId: marchand.id,
      nom: `${PREFIXE} T-shirt`,
      reference: `${PREFIXE}-VAR`,
      variantesActivees: true,
      variantes: {
        create: [
          { nom: 'Rouge / M', reference: `${PREFIXE}-VAR-RM`, quantiteEnCours: 6 },
          { nom: 'Bleu / L', reference: `${PREFIXE}-VAR-BL`, quantiteEnCours: 4 },
        ],
      },
    },
    include: { variantes: { orderBy: { reference: 'asc' } } },
  });

  return { admin, utilisateurMarchand, marchand, produitSimple, produitVariantes };
}

async function nettoyer(ids: { produitIds: string[]; marchandId?: string; utilisateurIds: string[] }) {
  await prisma.historiqueProduit.deleteMany({ where: { produitId: { in: ids.produitIds } } });
  await prisma.produitVariante.deleteMany({ where: { produitId: { in: ids.produitIds } } });
  if (ids.marchandId) {
    await prisma.reclamation.deleteMany({ where: { marchandId: ids.marchandId } });
    await prisma.produit.deleteMany({ where: { marchandId: ids.marchandId } });
    await prisma.marchand.deleteMany({ where: { id: ids.marchandId } });
  }
  await prisma.auditLog.deleteMany({ where: { adminId: { in: ids.utilisateurIds } } });
  await prisma.utilisateur.deleteMany({ where: { id: { in: ids.utilisateurIds } } });
}

// --- Audit ------------------------------------------------------------------

async function main() {
  console.log(`\n§ Audit réception de stock — ${PREFIXE}\n`);
  await attendreServeur();

  const jeu = await creerJeuDeDonnees();
  const { admin, marchand, produitSimple, produitVariantes } = jeu;
  const utilisateurIds = [admin.id, jeu.utilisateurMarchand.id];
  const produitIds = [produitSimple.id, produitVariantes.id];

  try {
    // ---------------------------------------------------------------
    console.log('1. Session');
    // ---------------------------------------------------------------
    await verifie('connexion de l’agent en tant qu’admin', async () => {
      const r = await api('POST', '/api/auth/login', {
        telephone: admin.email,
        secret: MOT_DE_PASSE,
      });
      attendu(r.status === 200, `login refusé (${r.status}) : ${r.texte.slice(0, 200)}`);
      attendu(sessionOuverte(), 'aucun cookie de session posé');
    });

    // ---------------------------------------------------------------
    console.log('\n2. Traçabilité de l’auteur');
    // ---------------------------------------------------------------
    await verifie('passage sur « Reçu » : tracé et nominatif', async () => {
      const r = await api('PATCH', `/api/produits/${produitSimple.id}`, { statutReception: 'recu' });
      attendu(r.status === 200, `PATCH refusé (${r.status}) : ${r.texte.slice(0, 200)}`);

      const ligne = await prisma.historiqueProduit.findFirst({
        where: { produitId: produitSimple.id },
        orderBy: { dateCreation: 'desc' },
      });
      attendu(ligne !== null, 'aucune entrée d’historique créée');
      attendu(ligne!.texte.includes('Pas encore reçu → Reçu'), `texte inattendu : ${ligne!.texte}`);
      attendu(ligne!.utilisateurId === admin.id, 'auteur non enregistré sur le changement de statut');
    });

    await verifie('validation de 8 unités : tracée et nominative', async () => {
      const r = await api('POST', `/api/produits/${produitSimple.id}/reception`, { quantite: 8 });
      attendu(r.status === 200, `réception refusée (${r.status}) : ${r.texte.slice(0, 200)}`);

      const p = await prisma.produit.findUniqueOrThrow({ where: { id: produitSimple.id } });
      attendu(p.quantiteRecue === 8, `quantiteRecue = ${p.quantiteRecue}, attendu 8`);
      attendu(p.quantiteEnCours === 2, `quantiteEnCours = ${p.quantiteEnCours}, attendu 2`);

      const ligne = await prisma.historiqueProduit.findFirst({
        where: { produitId: produitSimple.id, texte: { contains: 'a été reçu' } },
        orderBy: { dateCreation: 'desc' },
      });
      attendu(ligne !== null, 'aucune entrée d’historique pour la réception');
      attendu(ligne!.utilisateurId === admin.id, 'auteur non enregistré sur la réception');
    });

    await verifie('supprimer un compte n’efface pas l’historique (ON DELETE SET NULL)', async () => {
      const ephemere = await prisma.utilisateur.create({
        data: {
          nomComplet: `${PREFIXE} Ephemere`,
          email: `${PREFIXE.toLowerCase()}-ephemere@audit.local`,
          motDePasseHash: 'x',
          role: 'admin',
        },
      });
      const ligne = await prisma.historiqueProduit.create({
        data: { produitId: produitSimple.id, texte: `${PREFIXE} mouvement`, utilisateurId: ephemere.id },
      });

      await prisma.utilisateur.delete({ where: { id: ephemere.id } });

      const apres = await prisma.historiqueProduit.findUnique({ where: { id: ligne.id } });
      attendu(apres !== null, 'la ligne d’historique a été supprimée avec le compte');
      attendu(apres!.utilisateurId === null, `auteur = ${apres!.utilisateurId}, attendu null`);
    });

    // ---------------------------------------------------------------
    console.log('\n3. Retour arrière du statut de réception');
    // ---------------------------------------------------------------
    await verifie('refusé en 409 sans confirmation explicite', async () => {
      const r = await api('PATCH', `/api/produits/${produitSimple.id}`, {
        statutReception: 'pas_encore_recu',
      });
      attendu(r.status === 409, `statut ${r.status}, attendu 409 — ${r.texte.slice(0, 200)}`);
      attendu(
        typeof r.json?.error === 'string' && r.json.error.includes('8'),
        `message peu explicite : ${r.json?.error}`
      );

      const p = await prisma.produit.findUniqueOrThrow({ where: { id: produitSimple.id } });
      attendu(p.statutReception === 'recu', 'le statut a changé malgré le refus');
    });

    await verifie('accepté avec confirmation, trace nominative et motif', async () => {
      const r = await api('PATCH', `/api/produits/${produitSimple.id}`, {
        statutReception: 'pas_encore_recu',
        confirmerRetourArriere: true,
        motif: 'Erreur de saisie du bon de réception',
      });
      attendu(r.status === 200, `statut ${r.status}, attendu 200 — ${r.texte.slice(0, 200)}`);

      const p = await prisma.produit.findUniqueOrThrow({ where: { id: produitSimple.id } });
      attendu(p.statutReception === 'pas_encore_recu', 'le statut n’a pas changé');

      const ligne = await prisma.historiqueProduit.findFirst({
        where: { produitId: produitSimple.id, texte: { contains: 'Reçu → Pas encore reçu' } },
        orderBy: { dateCreation: 'desc' },
      });
      attendu(ligne !== null, 'aucune trace du retour arrière');
      attendu(ligne!.utilisateurId === admin.id, 'retour arrière non imputé à son auteur');
      attendu(
        ligne!.texte.includes('8 unité(s) déjà validée(s)'),
        `la trace ne rappelle pas la quantité en jeu : ${ligne!.texte}`
      );
      attendu(
        ligne!.texte.includes('Erreur de saisie du bon de réception'),
        `le motif n’est pas repris : ${ligne!.texte}`
      );
    });

    // Le cas qui piège une lecture naïve : sur un produit à variantes,
    // produit.quantiteRecue vaut 0. Sans quantiteRecueTotale, le garde-fou ne
    // se déclencherait jamais ici — exactement là où il compte le plus.
    await verifie('garde-fou actif sur un produit À VARIANTES', async () => {
      await api('PATCH', `/api/produits/${produitVariantes.id}`, { statutReception: 'recu' });
      const premiere = produitVariantes.variantes[0];
      const r1 = await api('POST', `/api/produits/variantes/${premiere.id}/reception`, { quantite: 3 });
      attendu(r1.status === 200, `réception variante refusée (${r1.status}) : ${r1.texte.slice(0, 200)}`);

      const produitApres = await prisma.produit.findUniqueOrThrow({ where: { id: produitVariantes.id } });
      attendu(produitApres.quantiteRecue === 0, 'préalable faux : le produit porterait lui-même la quantité');

      const r2 = await api('PATCH', `/api/produits/${produitVariantes.id}`, {
        statutReception: 'pas_encore_recu',
      });
      attendu(r2.status === 409, `statut ${r2.status}, attendu 409 — le garde-fou a ignoré les variantes`);
      attendu(
        typeof r2.json?.error === 'string' && r2.json.error.includes('3'),
        `message attendu sur 3 unités, reçu : ${r2.json?.error}`
      );
    });

    // ---------------------------------------------------------------
    console.log('\n4. Clôture de réception');
    // ---------------------------------------------------------------
    await verifie('produit simple : reliquat soldé, tracé, réclamation ouverte', async () => {
      const r = await api('POST', `/api/produits/${produitSimple.id}/cloturer-reception`, {
        motif: 'Colis marchand incomplet',
      });
      attendu(r.status === 200, `clôture refusée (${r.status}) : ${r.texte.slice(0, 200)}`);

      const p = await prisma.produit.findUniqueOrThrow({ where: { id: produitSimple.id } });
      attendu(p.quantiteEnCours === 0, `reliquat = ${p.quantiteEnCours}, attendu 0`);
      attendu(p.quantiteRecue === 8, `quantiteRecue altérée : ${p.quantiteRecue}, attendu 8`);

      const ligne = await prisma.historiqueProduit.findFirst({
        where: { produitId: produitSimple.id, texte: { contains: 'Réception clôturée' } },
        orderBy: { dateCreation: 'desc' },
      });
      attendu(ligne !== null, 'aucune trace de la clôture');
      attendu(ligne!.utilisateurId === admin.id, 'clôture non imputée à son auteur');
      attendu(ligne!.texte.includes('2 unité(s)'), `reliquat absent de la trace : ${ligne!.texte}`);

      const reclamation = await prisma.reclamation.findFirst({
        where: { marchandId: marchand.id, sujet: { contains: `${PREFIXE} Chaussures` } },
      });
      attendu(reclamation !== null, 'aucune réclamation ouverte');
      attendu(reclamation!.statut === 'ouverte', `statut ${reclamation!.statut}, attendu ouverte`);
      attendu(reclamation!.commandeId === null, 'la réclamation ne doit être liée à aucun colis');
      attendu(reclamation!.utilisateurId === admin.id, 'réclamation non imputée à son auteur');
      attendu(
        reclamation!.message.includes('Colis marchand incomplet'),
        'le motif de l’agent n’est pas repris dans la réclamation'
      );
    });

    await verifie('seconde clôture refusée : plus aucun reliquat', async () => {
      const r = await api('POST', `/api/produits/${produitSimple.id}/cloturer-reception`, {});
      attendu(r.status === 400, `statut ${r.status}, attendu 400 — ${r.texte.slice(0, 200)}`);
    });

    await verifie('produit à variantes : toutes les variantes soldées, détail conservé', async () => {
      const r = await api('POST', `/api/produits/${produitVariantes.id}/cloturer-reception`, {});
      attendu(r.status === 200, `clôture refusée (${r.status}) : ${r.texte.slice(0, 200)}`);

      const variantes = await prisma.produitVariante.findMany({
        where: { produitId: produitVariantes.id },
      });
      const reliquat = variantes.reduce((s, v) => s + v.quantiteEnCours, 0);
      attendu(reliquat === 0, `reliquat total = ${reliquat}, attendu 0`);
      attendu(
        variantes.reduce((s, v) => s + v.quantiteRecue, 0) === 3,
        'les quantités déjà reçues ont été altérées par la clôture'
      );

      const ligne = await prisma.historiqueProduit.findFirst({
        where: { produitId: produitVariantes.id, texte: { contains: 'Réception clôturée' } },
        orderBy: { dateCreation: 'desc' },
      });
      attendu(ligne !== null, 'aucune trace de la clôture');
      // 6 déclarées − 3 validées = 3 sur la première variante, 4 sur la seconde.
      attendu(
        ligne!.texte.includes('Rouge / M') && ligne!.texte.includes('Bleu / L'),
        `le détail par variante manque : ${ligne!.texte}`
      );
      attendu(ligne!.texte.includes('7 unité(s)'), `reliquat attendu 7 : ${ligne!.texte}`);
    });
  } finally {
    await nettoyer({ produitIds, marchandId: marchand.id, utilisateurIds });
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
