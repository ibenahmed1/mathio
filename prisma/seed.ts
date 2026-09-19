import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { getPasswordPolicyError, hashSecret, isValidEmail } from '../lib/auth';
import { chargerReferentiel } from '../scripts/charger-referentiel';

/**
 * Seed = le compte administrateur initial, puis le référentiel de
 * sous-traitance sur une base qui ne l’a pas encore.
 *
 * Le référentiel y a été ajouté pour une raison d’exploitation, pas de
 * conception : il vivait dans sept scripts enchaînés par un `&&` dans
 * `package.json`, dont un à lancer en `npx tsx scripts/…`. Personne
 * d’extérieur au dépôt ne pouvait déployer une base neuve sans cette liste
 * sous les yeux, et une base migrée sans elle n’a ni hub, ni ville, ni tarif —
 * donc aucun colis créable. Le déploiement tient maintenant en deux commandes :
 * `npm run db:deploy` puis `npm run build`.
 *
 * LE RESTE ne s’y trouve toujours pas — pôles du Kanban, utilisateurs,
 * marchands, produits, tarifs livreur/ville : ce sont des données
 * d’exploitation qui se créent depuis l’application (/admin/hubs,
 * /admin/tasks, /admin/utilisateurs) et n’existent qu’en base. Les figer dans
 * le dépôt ferait diverger le fichier de la réalité dès la première
 * modification faite depuis l’app.
 *
 * Exécuté à chaque déploiement (`npm run db:deploy`, après les migrations).
 * Idempotent et non destructif dans les deux moitiés : un compte qui porte
 * déjà cet email n’est ni recréé ni modifié, et le référentiel n’est pas
 * rechargé sur une base qui en a déjà un (voir `seedReferentiel` plus bas).
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

/**
 * Le référentiel n’est chargé que sur une base qui n’a AUCUN prestataire.
 *
 * La raison est dans les imports eux-mêmes : « un second passage ne fait que
 * réaligner les tarifs ». Autrement dit, ils réécrivent les tarifs avec les
 * valeurs des fichiers sources. Or ce seed tourne à CHAQUE déploiement : sans
 * cette condition, un tarif corrigé depuis /admin/prestataires serait annulé au
 * déploiement suivant, silencieusement, et la correction reviendrait à faire
 * tant que personne ne comprendrait d’où vient le retour en arrière.
 *
 * Le rechargement reste possible, mais il doit être VOULU :
 *   npm run db:reseau                 — rejoue les imports
 *   SEED_RESEAU_FORCER=1 npm run db:deploy
 */
async function seedReferentiel(): Promise<void> {
  const forcer = process.env.SEED_RESEAU_FORCER === '1';
  const deja = await prisma.prestataire.count();

  if (deja > 0 && !forcer) {
    console.log(
      `Référentiel déjà en base (${deja} prestataire(s)) — laissé intact. ` +
        'Pour le recharger : npm run db:reseau'
    );
    return;
  }

  if (deja > 0) {
    console.log(
      'SEED_RESEAU_FORCER=1 — rechargement du référentiel demandé. Les tarifs saisis ' +
        'depuis /admin/prestataires vont être réalignés sur les fichiers sources.'
    );
  }

  await chargerReferentiel();
}

async function main(): Promise<void> {
  const { compte, cree } = await seedAdmin();
  console.log(
    cree
      ? `Compte administrateur créé : ${compte.email} — changez son mot de passe dès la première connexion.`
      : `Compte administrateur déjà existant, inchangé : ${compte.email}`
  );

  await seedReferentiel();
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
