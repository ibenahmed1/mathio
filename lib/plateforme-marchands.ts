import { Prisma } from '@/app/generated/prisma/client';
import type { StatutMarchand, TypeCompteMarchand } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import {
  INVITATION_TOKEN_TTL_MS,
  generateResetToken,
  hashSecretImpossible,
  isValidEmail,
  normalizePhoneMaroc,
  spaceOrigin,
} from '@/lib/auth';
import { sendPasswordResetEmail } from '@/lib/mailer';
import { TYPES_COMPTE } from '@/lib/marchand-form-options';
import { ErreurPlateforme, type ContextePlateforme } from '@/lib/plateforme-auth';

// Synchronisation des comptes marchands depuis une plateforme partenaire
// (§ POST /v1/marchands).
//
// Trois issues possibles, et il faut les trois — c'est ce qui fait qu'une
// plateforme n'a jamais de cas qu'elle ne peut pas résoudre de son côté :
//
//   cree              le marchand n'existait pas : compte + profil + lien
//   rattache          il s'était déjà inscrit chez nous en direct : on crée
//                     seulement le lien, sans toucher à sa fiche
//   deja_synchronise  cet idExterne nous est déjà connu : aucune écriture
//
// Le troisième cas rend l'appel IDEMPOTENT : rejouer la même synchronisation
// (reprise après timeout, file de messages qui redélivre) ne crée pas un
// second marchand.

const RIB_REGEX = /^\d{24}$/;

export interface EntreeMarchandExterne {
  idExterne: string;
  nomComplet: string;
  nomBoutique: string;
  telephone: string;
  email: string;
  ville: string | null;
  adresse: string | null;
  rib: string | null;
  cin: string | null;
  siteWeb: string | null;
  nomBanque: string | null;
  registreCommerce: string | null;
  villeRamassage: string | null;
  raisonSociale: string | null;
  iceRc: string | null;
  typeCompte: TypeCompteMarchand;
}

function requis(corps: Record<string, unknown>, cle: string): string {
  const valeur = typeof corps[cle] === 'string' ? (corps[cle] as string).trim() : '';
  if (!valeur) throw new ErreurPlateforme(400, 'champ_requis', `Le champ « ${cle} » est requis`);
  return valeur;
}

function optionnel(corps: Record<string, unknown>, cle: string): string | null {
  const valeur = typeof corps[cle] === 'string' ? (corps[cle] as string).trim() : '';
  return valeur || null;
}

// Validation à la main depuis `unknown`, comme partout dans ce dépôt (pas de
// bibliothèque de schéma, cf. CLAUDE.md).
//
// Le jeu de champs REQUIS est volontairement plus court que celui de
// l'auto-inscription (app/api/marchands/inscription) : une plateforme ne
// détient ni photo du RIB, ni mot de passe choisi par le marchand. Exiger
// l'un ou l'autre rendrait la synchronisation impossible, et exiger une
// valeur bidon serait pire — on préfère une fiche incomplète, complétable
// ensuite depuis le back-office, à une fiche fausse.
export function analyserEntreeMarchand(corpsBrut: unknown): EntreeMarchandExterne {
  if (typeof corpsBrut !== 'object' || corpsBrut === null || Array.isArray(corpsBrut)) {
    throw new ErreurPlateforme(400, 'corps_invalide', 'Le corps de la requête doit être un objet JSON');
  }
  const corps = corpsBrut as Record<string, unknown>;

  const idExterne = requis(corps, 'idExterne');
  const nomComplet = requis(corps, 'nomComplet');
  const nomBoutique = requis(corps, 'nomBoutique');

  const telephone = normalizePhoneMaroc(requis(corps, 'telephone'));
  if (!telephone) {
    throw new ErreurPlateforme(
      400,
      'telephone_invalide',
      'Numéro de téléphone invalide (format marocain attendu, ex. 06XXXXXXXX)'
    );
  }

  // Email REQUIS, contrairement au reste des coordonnées : c'est par lui que
  // passe le lien « définir mon mot de passe », donc le seul chemin du
  // marchand vers son espace. Un compte créé sans email serait un compte que
  // personne ne peut ouvrir.
  const email = requis(corps, 'email').toLowerCase();
  if (!isValidEmail(email)) {
    throw new ErreurPlateforme(400, 'email_invalide', 'Adresse électronique invalide');
  }

  const rib = optionnel(corps, 'rib');
  if (rib && !RIB_REGEX.test(rib)) {
    throw new ErreurPlateforme(400, 'rib_invalide', 'Le RIB doit contenir exactement 24 chiffres');
  }

  const typeCompteBrut = typeof corps.typeCompte === 'string' ? corps.typeCompte : 'marchand';
  if (!TYPES_COMPTE.includes(typeCompteBrut as TypeCompteMarchand)) {
    throw new ErreurPlateforme(
      400,
      'type_compte_invalide',
      `typeCompte invalide. Valeurs possibles : ${TYPES_COMPTE.join(', ')}`
    );
  }

  return {
    idExterne,
    nomComplet,
    nomBoutique,
    telephone,
    email,
    ville: optionnel(corps, 'ville'),
    adresse: optionnel(corps, 'adresse'),
    rib,
    cin: optionnel(corps, 'cin'),
    siteWeb: optionnel(corps, 'siteWeb'),
    nomBanque: optionnel(corps, 'nomBanque'),
    registreCommerce: optionnel(corps, 'registreCommerce'),
    villeRamassage: optionnel(corps, 'villeRamassage'),
    raisonSociale: optionnel(corps, 'raisonSociale'),
    iceRc: optionnel(corps, 'iceRc'),
    typeCompte: typeCompteBrut as TypeCompteMarchand,
  };
}

export type IssueSynchro = 'cree' | 'rattache' | 'deja_synchronise';

export interface ResultatSynchro {
  issue: IssueSynchro;
  idExterne: string;
  marchandId: string;
  nomBoutique: string;
  statut: StatutMarchand;
  /**
   * Faux quand aucun email n'est parti : SMTP non configuré, envoi en échec,
   * ou environnement de test. Le compte existe quand même — un admin peut
   * relancer une réinitialisation depuis /admin/utilisateurs.
   */
  invitationEnvoyee: boolean;
}

export async function synchroniserMarchand(
  contexte: ContextePlateforme,
  entree: EntreeMarchandExterne,
  options: { activer: boolean }
): Promise<ResultatSynchro> {
  // 1. Déjà synchronisé ? Aucune écriture — et surtout pas une mise à jour de
  // la fiche : les corrections faites depuis notre back-office (une ville
  // rectifiée, un RIB complété) ne doivent pas être écrasées à chaque rejeu
  // par les valeurs figées de la plateforme.
  //
  // La clé de recherche porte l'ENVIRONNEMENT, et la porter n'est pas
  // facultatif : c'est la contrainte d'unicité qui l'impose (cf.
  // CompteMarchandExterne dans prisma/schema.prisma). Une version antérieure
  // cherchait sur le seul couple (plateforme, idExterne) — une clé `live` y
  // retrouvait alors le lien de TEST du même identifiant, répondait « déjà
  // synchronisé », et le dépôt de colis échouait ensuite en 404. La mise en
  // production était cassée pour tout marchand ayant servi aux essais, sans
  // qu'aucune réponse ne le signale.
  const lienExistant = await prisma.compteMarchandExterne.findUnique({
    where: {
      plateformeId_environnement_idExterne: {
        plateformeId: contexte.plateformeId,
        environnement: contexte.environnement,
        idExterne: entree.idExterne,
      },
    },
    include: { marchand: { select: { id: true, nomBoutique: true, statut: true } } },
  });
  if (lienExistant) {
    return {
      issue: 'deja_synchronise',
      idExterne: lienExistant.idExterne,
      marchandId: lienExistant.marchand.id,
      nomBoutique: lienExistant.marchand.nomBoutique,
      statut: lienExistant.marchand.statut,
      invitationEnvoyee: false,
    };
  }

  // 2. Le compte existe-t-il déjà chez nous ? `telephone` et `email` sont tous
  // deux uniques : on interroge les deux, et on refuse s'ils désignent deux
  // personnes différentes plutôt que d'en choisir une au hasard.
  const [parTelephone, parEmail] = await Promise.all([
    prisma.utilisateur.findUnique({
      where: { telephone: entree.telephone },
      include: { marchand: { select: { id: true, nomBoutique: true, statut: true } } },
    }),
    prisma.utilisateur.findUnique({
      where: { email: entree.email },
      include: { marchand: { select: { id: true, nomBoutique: true, statut: true } } },
    }),
  ]);

  if (parTelephone && parEmail && parTelephone.id !== parEmail.id) {
    throw new ErreurPlateforme(
      409,
      'conflit_identifiants',
      'Le téléphone et l’email fournis appartiennent à deux comptes différents chez nous'
    );
  }

  const existant = parTelephone ?? parEmail;

  if (existant) {
    // Un compte porté par un livreur, un agent de hub ou un membre du
    // back-office : le rattacher en ferait un marchand, ce qui n'est pas une
    // décision qu'une machine tierce a à prendre.
    if (!existant.marchand) {
      throw new ErreurPlateforme(
        409,
        'compte_non_marchand',
        'Un compte existe déjà avec ces coordonnées, mais ce n’est pas un compte marchand'
      );
    }

    // 3. Rattachement — mais JAMAIS entre les deux environnements.
    //
    // Un marchand est soit un artefact de bac à sable (créé par une clé
    // `test`), soit un vrai client (inscrit en direct, ou créé par une clé
    // `live`). Les deux guards ci-dessous interdisent de franchir cette
    // frontière, dans un sens comme dans l'autre. Ils sont symétriques parce
    // que les deux traversées font du dégât, chacune à sa façon.
    const liensDuMarchand = await prisma.compteMarchandExterne.findMany({
      where: { marchandId: existant.marchand.id },
      select: { environnement: true, creeParSynchro: true },
    });
    const estArtefactDeTest = liensDuMarchand.some((l) => l.environnement === 'test' && l.creeParSynchro);

    // LIVE → artefact de test. Sans ce refus, une clé de production qui
    // retrouvait un compte de bac à sable par son téléphone ou son email s'y
    // rattachait : la plateforme croyait obtenir un marchand actif, elle
    // héritait d'un compte resté en attente de validation — un rattachement ne
    // réécrit jamais une fiche. Et le marchand devenait dès lors NON
    // PURGEABLE : le résidu d'essai s'installait en production pour de bon.
    if (contexte.environnement === 'live' && estArtefactDeTest) {
      throw new ErreurPlateforme(
        409,
        'marchand_de_test',
        'Ces coordonnées appartiennent à un marchand créé dans le bac à sable. ' +
          'Purger l’environnement de test avant d’activer ce compte en production.'
      );
    }

    // TEST → vrai client. C'est la traversée la plus coûteuse, et elle ne se
    // rattrape pas : les colis déposés ensuite atterrissent chez un marchand
    // RÉEL, dans son tableau de bord et dans ses statistiques. La purge ne
    // peut pas les en retirer — `commandes` ne porte aucune marque
    // d'environnement, et distinguer un colis d'essai d'une vraie commande
    // chez un client qui a les deux est impossible sans se tromper.
    //
    // On ferme donc à la SOURCE plutôt que de nettoyer après : une clé de bac
    // à sable ne travaille que sur des marchands qu'elle a elle-même créés.
    // C'est aussi ce qui garantit qu'un marchand lié en `test` reste toujours
    // purgeable.
    if (contexte.environnement === 'test' && !estArtefactDeTest) {
      throw new ErreurPlateforme(
        409,
        'marchand_de_production',
        'Ces coordonnées appartiennent à un marchand réel. Une clé de test ne peut pas s’y rattacher : ' +
          'utiliser des coordonnées fictives en bac à sable.'
      );
    }

    // Borné à l'environnement courant, comme la recherche ci-dessus : un
    // marchand peut légitimement être lié à la fois en `test` et en `live`,
    // ce sont deux espaces de noms distincts.
    const dejaLie = await prisma.compteMarchandExterne.findUnique({
      where: {
        plateformeId_environnement_marchandId: {
          plateformeId: contexte.plateformeId,
          environnement: contexte.environnement,
          marchandId: existant.marchand.id,
        },
      },
    });
    if (dejaLie) {
      throw new ErreurPlateforme(
        409,
        'deja_lie',
        `Ce marchand est déjà rattaché à cette plateforme sous l’identifiant « ${dejaLie.idExterne} »`
      );
    }

    // Le contrôle ci-dessus est une COURTOISIE : il produit un message précis
    // dans le cas courant. Ce n'est pas lui qui garantit l'unicité — deux
    // synchronisations concurrentes le franchiraient toutes les deux. La
    // garantie est la contrainte de base, et c'est son violation qu'on traduit
    // ici, faute de quoi une redélivrance simultanée sortirait en 500.
    try {
      await prisma.compteMarchandExterne.create({
        data: {
          plateformeId: contexte.plateformeId,
          idExterne: entree.idExterne,
          marchandId: existant.marchand.id,
          environnement: contexte.environnement,
          // Rattachement : ce marchand s'était inscrit en direct chez nous. Une
          // purge des données de test ne doit jamais l'effacer.
          creeParSynchro: false,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ErreurPlateforme(
          409,
          'deja_lie',
          'Ce marchand vient d’être rattaché à cette plateforme par un appel concurrent'
        );
      }
      throw error;
    }

    return {
      issue: 'rattache',
      idExterne: entree.idExterne,
      marchandId: existant.marchand.id,
      nomBoutique: existant.marchand.nomBoutique,
      statut: existant.marchand.statut,
      invitationEnvoyee: false,
    };
  }

  // 4. Création. Le compte naît sans mot de passe utilisable : la plateforme
  // ne doit JAMAIS nous transmettre celui de son marchand, et nous n'avons
  // pas à en inventer un. Seul le lien d'invitation ouvre le compte — même
  // mécanique que l'invitation d'un membre à un pôle du Kanban.
  const { token, tokenHash, expiresAt } = generateResetToken(INVITATION_TOKEN_TTL_MS);

  // Les contrôles d'existence de l'étape 2 ne verrouillent rien : entre eux et
  // cette création, un appel concurrent — la même synchronisation redélivrée
  // par une file de messages, par exemple — peut avoir créé le compte. La
  // transaction échoue alors sur l'unicité de `telephone` ou d'`email`, et
  // c'est ce refus-là qui fait autorité. Le traduire en 409 plutôt que de le
  // laisser sortir en 500 change tout pour l'appelant : le premier se rejoue,
  // le second se signale.
  let creation;
  try {
    creation = await prisma.$transaction(async (tx) => {
    const utilisateur = await tx.utilisateur.create({
      data: {
        nomComplet: entree.nomComplet,
        telephone: entree.telephone,
        email: entree.email,
        motDePasseHash: await hashSecretImpossible(),
        role: 'marchand',
        // `activer` vient du SCOPE de la clé, pas de la charge utile : une
        // plateforme ne décide pas elle-même que son marchand est validé
        // (cf. marchands:creation vs marchands:creation_validee).
        actif: options.activer,
        resetTokenHash: tokenHash,
        resetTokenExpire: expiresAt,
      },
    });

    const cree = await tx.marchand.create({
      data: {
        utilisateurId: utilisateur.id,
        nomBoutique: entree.nomBoutique,
        ville: entree.ville,
        adresse: entree.adresse,
        rib: entree.rib,
        cin: entree.cin,
        siteWeb: entree.siteWeb,
        nomBanque: entree.nomBanque,
        registreCommerce: entree.registreCommerce,
        villeRamassage: entree.villeRamassage,
        raisonSociale: entree.raisonSociale,
        iceRc: entree.iceRc,
        typeCompte: entree.typeCompte,
        statut: options.activer ? 'actif' : 'en_attente_validation',
      },
    });

    await tx.compteMarchandExterne.create({
      data: {
        plateformeId: contexte.plateformeId,
        idExterne: entree.idExterne,
        marchandId: cree.id,
        environnement: contexte.environnement,
        // Création : ce marchand n'existe que parce que la plateforme l'a
        // déclaré. C'est le seul cas qu'une purge de test a le droit d'effacer.
        creeParSynchro: true,
      },
    });

      return { marchand: cree };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ErreurPlateforme(
        409,
        'synchronisation_concurrente',
        'Ce marchand vient d’être créé par un appel concurrent. Rejouer la requête renverra « deja_synchronise ».'
      );
    }
    throw error;
  }

  const { marchand } = creation;
  const invitationEnvoyee = await envoyerInvitation(contexte, entree.email, token);

  return {
    issue: 'cree',
    idExterne: entree.idExterne,
    marchandId: marchand.id,
    nomBoutique: marchand.nomBoutique,
    statut: marchand.statut,
    invitationEnvoyee,
  };
}

// Le lien part par email et n'est JAMAIS renvoyé à la plateforme : quiconque
// le détient peut choisir le mot de passe du compte. C'est une différence
// assumée avec l'invitation Kanban, qui affiche le lien à l'écran quand
// l'envoi échoue — là, le destinataire du repli est notre propre admin ; ici
// ce serait un tiers.
//
// `spaceOrigin('marchand')` et non l'origine de la requête : l'appel arrive
// sur l'hôte de l'API machine, où aucune session ne peut être posée. Le lien
// doit ramener sur le domaine marchand, seul endroit où son cookie existera.
async function envoyerInvitation(
  contexte: ContextePlateforme,
  email: string,
  token: string
): Promise<boolean> {
  // Pas d'email en bac à sable : les identifiants de test sont souvent des
  // adresses inventées ou, pire, celles de vrais marchands recopiées. Le
  // compte est créé, le jeton existe, seul l'envoi est court-circuité.
  if (contexte.environnement === 'test') return false;

  const lien = `${spaceOrigin('marchand')}/reinitialiser-mot-de-passe?token=${token}`;
  return sendPasswordResetEmail(email, lien);
}
