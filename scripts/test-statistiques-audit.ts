import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { api, attendreServeur, reinitialiserSession, sessionOuverte } from './audit-http';
import {
  filtrePeriode,
  getCodEncaisse,
  getCompteurs,
  getVentilationClient,
  getVentilationLivreur,
  getVentilationVille,
  resoudrePeriode,
  tauxLivraison,
} from '../lib/statistiques';

// Audit local du module statistiques, exécutable via
//   npx tsx scripts/test-statistiques-audit.ts
// avec un serveur de développement en cours (cf. scripts/audit-http.ts).
//
// Deux volets que les tests unitaires ne peuvent pas couvrir :
//
//   1. Les AGRÉGATS lus en base. lib/__tests__/statistiques.test.ts prouve que
//      le calcul est juste sur des compteurs fournis à la main ; ici on vérifie
//      que les groupBy Prisma ramènent bien ces compteurs-là depuis de vraies
//      lignes, bornes de période comprises.
//   2. Le RENDU et le RBAC. Les six pages sont des Server Components : elles ne
//      passent par aucune route API, donc aucun test d'API ne dirait qu'elles
//      plantent. Et la garde de rôle vit dans le layout — masquer un lien dans
//      la sidebar n'a jamais empêché personne de taper l'URL.
//
// Toutes les données créées sont préfixées et supprimées en fin d'exécution.

const PREFIXE = `AUDIT-${Date.now()}`;
const MOT_DE_PASSE = 'Audit1234!';

const PAGES = ['tout', 'livreur', 'ville', 'zone', 'client', 'comparer'];

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

function egal(reel: unknown, espere: unknown, quoi: string) {
  if (reel !== espere) throw new Error(`${quoi} = ${String(reel)}, attendu ${String(espere)}`);
}

// --- Jeu de données ---------------------------------------------------------

let compteur = 0;
function code() {
  compteur += 1;
  return `${PREFIXE}-C${compteur}`;
}

function ilYaNJours(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function creerJeuDeDonnees() {
  const hash = await bcrypt.hash(MOT_DE_PASSE, 10);

  const admin = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Superviseur`,
      email: `${PREFIXE.toLowerCase()}-admin@audit.local`,
      motDePasseHash: hash,
      role: 'admin',
    },
  });

  // Rôle back-office SANS accès aux statistiques : sert à prouver la garde.
  const intrus = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Agent Suivi`,
      email: `${PREFIXE.toLowerCase()}-intrus@audit.local`,
      motDePasseHash: hash,
      role: 'equipe_suivi',
    },
  });

  const livreur = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Livreur`,
      email: `${PREFIXE.toLowerCase()}-livreur@audit.local`,
      motDePasseHash: hash,
      role: 'livreur',
    },
  });

  const userMarchand = await prisma.utilisateur.create({
    data: {
      nomComplet: `${PREFIXE} Marchand`,
      email: `${PREFIXE.toLowerCase()}-marchand@audit.local`,
      motDePasseHash: hash,
      role: 'marchand',
    },
  });
  const marchand = await prisma.marchand.create({
    data: { utilisateurId: userMarchand.id, nomBoutique: `${PREFIXE} Boutique`, statut: 'actif' },
  });

  async function colis(opts: {
    statut: 'livre' | 'retourne' | 'annule' | 'mise_en_distribution' | 'retourne_au_hub';
    cod: number;
    jours: number;
    livreurId?: string | null;
    ville?: string;
    tel?: string;
  }) {
    return prisma.commande.create({
      data: {
        marchandId: marchand.id,
        codeSuivi: code(),
        clientNom: `${PREFIXE} Client`,
        clientTelephone: opts.tel ?? '0600000001',
        ville: opts.ville ?? 'Casablanca',
        adresse: 'Adresse de test',
        montantCod: opts.cod,
        statut: opts.statut,
        livreurId: opts.livreurId ?? null,
        dateCreation: ilYaNJours(opts.jours),
      },
    });
  }

  // Dans la fenêtre 30 jours : 8 livrés, 2 retournés, 1 annulé, 1 en cours,
  // 1 rentré au hub (qui doit compter comme « en cours »).
  for (let i = 0; i < 8; i++) {
    await colis({ statut: 'livre', cod: 100, jours: 5, livreurId: livreur.id });
  }
  await colis({ statut: 'retourne', cod: 999, jours: 5, livreurId: livreur.id });
  await colis({ statut: 'retourne', cod: 999, jours: 5, livreurId: livreur.id });
  await colis({ statut: 'annule', cod: 500, jours: 5 });
  await colis({ statut: 'mise_en_distribution', cod: 300, jours: 5, livreurId: livreur.id });
  await colis({ statut: 'retourne_au_hub', cod: 300, jours: 5, livreurId: livreur.id });

  // HORS fenêtre : ne doit apparaître nulle part sur « 30 derniers jours ».
  await colis({ statut: 'livre', cod: 7777, jours: 200, livreurId: livreur.id });

  // Autre ville et autre destinataire, pour les ventilations.
  await colis({ statut: 'livre', cod: 100, jours: 3, ville: 'Agadir', tel: '0600000002' });

  return { admin, intrus, livreur, marchand, userMarchand };
}

async function nettoyer(ids: { marchandId: string; utilisateurIds: string[] }) {
  await prisma.commande.deleteMany({ where: { marchandId: ids.marchandId } });
  await prisma.marchand.deleteMany({ where: { id: ids.marchandId } });
  await prisma.auditLog.deleteMany({ where: { adminId: { in: ids.utilisateurIds } } });
  await prisma.utilisateur.deleteMany({ where: { id: { in: ids.utilisateurIds } } });
}

// --- Audit ------------------------------------------------------------------

async function main() {
  console.log(`\n§ Audit statistiques — ${PREFIXE}\n`);
  await attendreServeur();

  const jeu = await creerJeuDeDonnees();
  const utilisateurIds = [jeu.admin.id, jeu.intrus.id, jeu.livreur.id, jeu.userMarchand.id];

  try {
    // =================================================================
    console.log('1. Agrégats lus en base');
    // =================================================================

    const periode = resoudrePeriode('30j');
    const where = { ...filtrePeriode(periode), marchand: { nomBoutique: { startsWith: PREFIXE } } };

    await verifie('les compteurs correspondent aux colis créés dans la fenêtre', async () => {
      const c = await getCompteurs(where);
      egal(c.total, 14, 'total');
      egal(c.livres, 9, 'livrés');
      egal(c.retournes, 2, 'retournés');
      egal(c.annules, 1, 'annulés');
      // mise_en_distribution + retourne_au_hub : le second n'est PAS un retour.
      egal(c.enCours, 2, 'en cours');
      egal(tauxLivraison(c), 81.8, 'taux de livraison');
    });

    // La borne de cohorte est le seul rempart contre un tableau de bord qui
    // ramène tout l'historique en croyant montrer le mois.
    await verifie('un colis hors fenêtre est exclu, y compris son COD', async () => {
      const c = await getCompteurs(where);
      const cod = await getCodEncaisse(where);
      // 9 livrés à 100 DH ; le colis à 7 777 DH date de 200 jours.
      egal(cod, 900, 'COD encaissé');
      attendu(c.total === 14, 'le colis hors fenêtre a été compté');
    });

    await verifie('ventilation livreur : les colis sans livreur sont exclus', async () => {
      const lignes = await getVentilationLivreur(where);
      egal(lignes.length, 1, 'nombre de livreurs');
      // 8 livrés + 2 retournés + 1 en distribution + 1 au hub = 12.
      // L'annulé et le colis d'Agadir n'ont pas de livreur.
      egal(lignes[0].compteurs.total, 12, 'colis du livreur');
      egal(lignes[0].compteurs.livres, 8, 'livrés');
      egal(lignes[0].codEncaisse, 800, 'COD encaissé du livreur');
    });

    await verifie('ventilation ville : deux villes, triées par volume', async () => {
      const lignes = await getVentilationVille(where);
      egal(lignes.length, 2, 'nombre de villes');
      egal(lignes[0].libelle, 'Casablanca', 'ville en tête');
      egal(lignes[1].libelle, 'Agadir', 'seconde ville');
      egal(lignes[1].compteurs.total, 1, 'colis à Agadir');
    });

    await verifie('ventilation client : regroupement par téléphone', async () => {
      const lignes = await getVentilationClient(where);
      egal(lignes.length, 2, 'nombre de destinataires');
      egal(lignes[0].sousTitre, '0600000001', 'téléphone du destinataire principal');
      egal(lignes[0].compteurs.total, 13, 'colis du destinataire principal');
    });

    // =================================================================
    console.log('\n2. Rendu des pages et garde de rôle');
    // =================================================================

    await verifie('connexion en tant qu’admin', async () => {
      const r = await api('POST', '/api/auth/login', { telephone: jeu.admin.email, secret: MOT_DE_PASSE });
      attendu(r.status === 200, `login refusé (${r.status})`);
      attendu(sessionOuverte(), 'aucun cookie de session');
    });

    for (const page of PAGES) {
      await verifie(`/admin/statistique/${page} rend sans erreur`, async () => {
        const r = await api('GET', `/admin/statistique/${page}?periode=30j`);
        egal(r.status, 200, 'statut HTTP');
        attendu(r.texte.includes('Statistiques'), 'la page ne porte pas son titre');
        // Une erreur de rendu React côté serveur renvoie 200 avec la page
        // d'erreur de Next : on vérifie que le contenu attendu est bien là.
        attendu(
          !r.texte.includes('Application error') && !r.texte.includes('missing required error'),
          'la page contient une erreur de rendu'
        );
      });
    }

    await verifie('la page « Comparer » affiche bien deux périodes', async () => {
      const r = await api('GET', '/admin/statistique/comparer?periode=30j');
      egal(r.status, 200, 'statut HTTP');
      attendu(r.texte.includes('Période précédente'), 'la colonne de comparaison manque');
    });

    // Masquer l'entrée de menu ne protège rien : la garde doit vivre côté
    // serveur, et c'est ce qu'on vérifie ici en tapant l'URL directement.
    await verifie('un rôle non autorisé est renvoyé vers /admin', async () => {
      reinitialiserSession();
      const login = await api('POST', '/api/auth/login', {
        telephone: jeu.intrus.email,
        secret: MOT_DE_PASSE,
      });
      attendu(login.status === 200, `login intrus refusé (${login.status})`);

      const r = await api('GET', '/admin/statistique/tout');
      attendu(
        r.status === 307 || r.status === 302,
        `statut ${r.status} — la page a été servie à un rôle non autorisé`
      );
    });
  } finally {
    await nettoyer({ marchandId: jeu.marchand.id, utilisateurIds });
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
