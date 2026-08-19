import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { getPasswordPolicyError, hashSecret, isValidEmail } from '../lib/auth';

/**
 * Seed = le compte administrateur initial, et rien d'autre.
 *
 * Tout le reste — hubs et villes couvertes, pôles du Kanban, utilisateurs,
 * marchands, produits, tarifs livreur/ville — se crée depuis l'application
 * (/admin/hubs, /admin/tasks, /admin/utilisateurs) au fur et à mesure des
 * besoins, et vit donc uniquement en base de données. Ce sont des données
 * d'exploitation qui évoluent : les figer dans le dépôt ferait diverger le
 * fichier de la réalité dès la première modification faite depuis l'app.
 *
 * Exécuté à chaque déploiement (`npm run db:deploy`, après les migrations).
 * Le script est idempotent et non destructif : si un compte porte déjà cet
 * email, il n'est ni recréé ni modifié.
 */

// Identifiants d'amorçage du tout premier compte : ils servent uniquement à
// ouvrir l'application une première fois, quand la base est encore vide.
//
// ⚠️ En production, surchargez SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD dans
// l'environnement de déploiement : les valeurs par défaut ci-dessous sont en
// clair dans le dépôt et ne conviennent qu'au développement local. À défaut,
// changez le mot de passe depuis l'application dès la première connexion — le
// seed ne le réappliquera jamais sur un compte existant.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@mathio.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';
const ADMIN_NOM_COMPLET = process.env.SEED_ADMIN_NOM?.trim() || 'Administrateur';

async function seedAdmin() {
  const email = ADMIN_EMAIL.toLowerCase();

  // Mêmes règles que la création d'un utilisateur depuis /admin/utilisateurs,
  // pour qu'un compte seedé soit indiscernable d'un compte créé dans l'UI — et
  // pour refuser tout de suite un identifiant mal saisi, ou une surcharge
  // SEED_ADMIN_* invalide qui ne se verrait sinon qu'au premier login raté.
  if (!isValidEmail(email)) {
    throw new Error(`SEED_ADMIN_EMAIL invalide ("${email}").`);
  }

  const erreurMotDePasse = getPasswordPolicyError(ADMIN_PASSWORD);
  if (erreurMotDePasse) {
    throw new Error(`SEED_ADMIN_PASSWORD refusé — ${erreurMotDePasse}`);
  }

  const existant = await prisma.utilisateur.findUnique({ where: { email } });
  if (existant) {
    return { compte: existant, cree: false };
  }

  const compte = await prisma.utilisateur.create({
    data: {
      nomComplet: ADMIN_NOM_COMPLET,
      email,
      // Pas de téléphone : l'admin se connecte avec son email (la route de
      // login résout l'identifiant sur les deux colonnes) et renseigne son
      // numéro plus tard depuis son profil s'il le souhaite.
      motDePasseHash: await hashSecret(ADMIN_PASSWORD),
      role: 'admin',
    },
  });

  return { compte, cree: true };
}

seedAdmin()
  .then(async ({ compte, cree }) => {
    console.log(
      cree
        ? `Compte administrateur créé : ${compte.email} — changez son mot de passe dès la première connexion.`
        : `Compte administrateur déjà existant, inchangé : ${compte.email}`
    );
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
