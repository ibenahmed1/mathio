import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { HOST_API } from '../lib/spaces';
import { CATALOGUE_SCOPES, analyserCle, type EnvironnementCle } from '../lib/plateforme-cles';
import { TAILLE_MAX_LOT } from '../lib/plateforme-colis';
import { creerCleApi } from '../lib/plateformes';
import { creerClient, type Reponse } from './audit-http';

// CONSOLE INTERACTIVE — tenir le rôle de Shipeh à la main.
//
//   npm run shipeh
//
// Le pendant d'un Swagger UI pour cette intégration, mais en terminal. Ce
// n'est pas un choix d'esthétique : l'API machine ne pose AUCUN en-tête CORS
// (c'est ce qui rend l'absence de contrôle d'`Origin` correcte sur son hôte),
// donc un Swagger servi dans un navigateur se ferait refuser chaque appel.
// Deux obstacles s'y ajoutent sous Windows : `api.localhost` ne résout pas, et
// PowerShell 5.1 mutile le JSON passé en ligne de commande. Cette console
// contourne les trois d'un coup — elle parle le même HTTP que le partenaire,
// avec le `Host` forgé, et compose les charges utiles elle-même.
//
// Elle fait DEUX choses que le simulateur ne fait pas :
//   - elle laisse improviser (un champ à changer, un rejeu, un cas tordu),
//   - elle montre le SUIVI côté Mathio — journal des appels, marchands liés,
//     colis ingérés — sans quitter le terminal.
//
// Le simulateur (`npm run simuler:shipeh`) reste le juge : 37 vérifications
// automatiques qui passent ou non. Celle-ci est un établi, pas un test.

const hoteApi = HOST_API ?? 'api.localhost:3000';
const client = creerClient('admin');

// Lecture de l'entrée, ouverte à la DEMANDE — jamais au chargement du module.
//
// Créée trop tôt, l'interface met `stdin` en mode « flowing » et consomme les
// lignes pendant l'attente du serveur, sans personne pour les écouter. La file
// ci-dessous ne sert QU'AU MODE TUBE (console rejouée par un script) ; au
// clavier, c'est `question()` qui lit, et la file est vidée avant chaque
// question — cf. lireLigne pour la raison, qui n'a rien d'anecdotique.
let lecteur: ReturnType<typeof createInterface> | null = null;
const lignesEnAttente: string[] = [];
let demandeur: ((ligne: string) => void) | null = null;
let entreeClose = false;

function ouvrirLecteur() {
  if (lecteur) return lecteur;
  lecteur = createInterface({ input: stdin, output: stdout });
  lecteur.on('line', (ligne) => {
    // En terminal, `question()` consomme la ligne lui-même : l'empiler ici la
    // ferait servir DEUX fois.
    if (stdin.isTTY) return;
    if (demandeur) {
      const resoudre = demandeur;
      demandeur = null;
      resoudre(ligne);
    } else {
      lignesEnAttente.push(ligne);
    }
  });
  // Sans ça, une entrée épuisée laisserait la console suspendue pour toujours.
  lecteur.on('close', () => {
    entreeClose = true;
    if (demandeur) {
      const resoudre = demandeur;
      demandeur = null;
      resoudre('');
    }
  });
  return lecteur;
}

// AU CLAVIER, on jette la frappe d'avance ; PAR TUBE, on la garde.
//
// La distinction n'est pas un raffinement, elle corrige une désynchronisation
// silencieuse. Une requête HTTP prend deux à six dixièmes de seconde ; une
// Entrée pressée pendant ce temps arrivait dans la file, puis satisfaisait la
// question SUIVANTE en renvoyant « vide », donc la valeur par défaut — pendant
// que readline continuait d'afficher ce que l'utilisateur tapait. La réponse
// affichée n'était alors plus celle envoyée : on croyait saisir une référence,
// le serveur en recevait une autre, et les questions restantes défilaient sans
// s'afficher.
//
// Un terminal doit donc IGNORER ce qui a été tapé avant que la question ne
// soit posée — c'est le comportement attendu de toute invite de confirmation.
// Une entrée par tube, elle, arrive forcément en bloc et à l'avance : sa file
// est le seul moyen de la lire, et il n'y a personne pour se désynchroniser.
function lireLigne(invite: string): Promise<string> {
  const lu = ouvrirLecteur();

  if (stdin.isTTY) {
    lignesEnAttente.length = 0;
    // `question()` gère lui-même l'invite et l'écho : ne rien écrire dans son
    // dos, sous peine de retrouver le « > » par-dessus le libellé du champ.
    return lu.question(invite);
  }

  const dejaLue = lignesEnAttente.shift();
  if (dejaLue !== undefined) {
    stdout.write(`${invite}${dejaLue}\n`);
    return Promise.resolve(dejaLue);
  }
  if (entreeClose) return Promise.resolve('');

  return new Promise((resolve) => {
    demandeur = resolve;
  });
}

// --- Affichage ---------------------------------------------------------------

const GRAS = '\x1b[1m';
const FAIBLE = '\x1b[2m';
const OK = '\x1b[32m';
const KO = '\x1b[31m';
const ATTENTION = '\x1b[33m';
const ACCENT = '\x1b[36m';
const NEUTRE = '\x1b[0m';

function titre(texte: string) {
  console.log(`\n${GRAS}${texte}${NEUTRE}`);
  console.log(FAIBLE + '─'.repeat(Math.min(72, texte.length + 20)) + NEUTRE);
}

function info(texte: string) {
  console.log(`${FAIBLE}${texte}${NEUTRE}`);
}

// Un statut se lit d'abord à la couleur : sur une session d'essais, on
// enchaîne les appels et on ne relit pas chaque corps de réponse.
function couleurStatut(statut: number): string {
  if (statut < 300) return OK;
  if (statut < 500) return ATTENTION;
  return KO;
}

function afficherReponse(methode: string, chemin: string, corps: unknown, reponse: Reponse) {
  console.log(`\n${ACCENT}→ ${methode} ${chemin}${NEUTRE}`);
  if (corps !== undefined) {
    console.log(FAIBLE + JSON.stringify(corps, null, 2).split('\n').map((l) => '  ' + l).join('\n') + NEUTRE);
  }
  const c = couleurStatut(reponse.status);
  console.log(`${c}← ${reponse.status}${NEUTRE}`);
  const rendu = reponse.json ? JSON.stringify(reponse.json, null, 2) : reponse.texte || '(corps vide)';
  console.log(rendu.split('\n').map((l) => '  ' + l).join('\n'));
}

// --- Transport ---------------------------------------------------------------

let cleCourante: string | null = null;

function appel(methode: string, chemin: string, corps?: unknown): Promise<Reponse> {
  return client.api(methode, chemin, corps, {
    host: hoteApi,
    // Ni `Origin`, ni cookie : c'est exactement ce qu'envoie un serveur tiers,
    // et c'est ce qui doit être exercé.
    origin: null,
    cookie: null,
    entetes: cleCourante ? { Authorization: `Bearer ${cleCourante}` } : {},
  });
}

async function envoyer(methode: string, chemin: string, corps?: unknown): Promise<Reponse> {
  const r = await appel(methode, chemin, corps);
  afficherReponse(methode, chemin, corps, r);
  return r;
}

async function attendreServeur(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      const sansCle = await client.api('POST', '/api/v1/colis', {}, {
        host: hoteApi,
        origin: null,
        cookie: null,
      });
      if (sansCle.status === 401) return;
      if (sansCle.status === 404) {
        throw new Error(
          `Le serveur répond, mais « ${hoteApi} » n'est pas l'hôte de son API.\n` +
            'Vérifier le port (Next bascule sur 3001 si 3000 est pris) et HOST_API.'
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Le serveur répond')) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Serveur injoignable. Lancer `npm run dev` dans un autre terminal.');
}

// --- Saisie ------------------------------------------------------------------

async function demander(question: string, defaut?: string): Promise<string> {
  const suffixe = defaut ? ` ${FAIBLE}[${defaut}]${NEUTRE}` : '';
  const saisie = (await lireLigne(`${question}${suffixe} : `)).trim();
  return saisie || defaut || '';
}

// Une saisie invalide REDEMANDE, elle n'annule pas.
//
// La version précédente renvoyait `null` sur une frappe erronée, et l'appelant
// traitait `null` comme « annuler » — au menu principal, cela QUITTAIT la
// console. Une faute de frappe fermait donc la session, et avec elle la clé
// qui n'existe qu'en mémoire : il fallait tout recommencer et en émettre une
// autre. C'est ce qui explique les clés qui s'accumulaient.
//
// Seule une ligne VIDE annule, et c'est ce que l'invite annonce.
async function choisir<T>(
  libelle: string,
  options: { texte: string; valeur: T }[]
): Promise<T | null> {
  console.log(`\n${libelle}`);
  options.forEach((o, i) => console.log(`  ${GRAS}${i + 1}${NEUTRE}. ${o.texte}`));

  for (;;) {
    const brut = await demander('Choix (vide pour annuler)');
    if (!brut) return null;

    const i = Number(brut) - 1;
    if (Number.isInteger(i) && i >= 0 && i < options.length) return options[i].valeur;

    console.log(`${KO}« ${brut} » n’est pas un choix — entrer un nombre entre 1 et ${options.length}.${NEUTRE}`);
    // Une entrée épuisée (console pilotée par un script) ne doit pas tourner
    // en boucle sur son propre message d'erreur.
    if (entreeClose) return null;
  }
}

// --- Sélection de la plateforme et de la clé ---------------------------------

interface Session {
  plateformeId: string;
  code: string;
  nom: string;
  environnement: EnvironnementCle;
}

let session: Session | null = null;

async function choisirPlateforme(): Promise<void> {
  const plateformes = await prisma.plateformePartenaire.findMany({
    orderBy: { dateCreation: 'asc' },
    include: { _count: { select: { cles: true, comptesMarchands: true } } },
  });

  if (plateformes.length === 0) {
    console.log(`\n${ATTENTION}Aucune plateforme en base.${NEUTRE}`);
    const nom = await demander('Nom de la plateforme à créer', 'Shipeh');
    if (!nom) return;
    await creerPlateforme(nom);
    return choisirPlateforme();
  }

  const choix = await choisir('Plateforme :', [
    ...plateformes.map((p) => ({
      texte:
        `${p.nom} ${FAIBLE}(${p.code}) — ${p._count.cles} clé(s), ` +
        `${p._count.comptesMarchands} marchand(s)${p.actif ? '' : ` ${ATTENTION}SUSPENDUE`}${NEUTRE}`,
      valeur: p.id as string | 'nouvelle',
    })),
    { texte: `${FAIBLE}+ créer une nouvelle plateforme${NEUTRE}`, valeur: 'nouvelle' as const },
  ]);
  if (!choix) return;

  if (choix === 'nouvelle') {
    const nom = await demander('Nom de la plateforme');
    if (!nom) return;
    await creerPlateforme(nom);
    return choisirPlateforme();
  }

  const p = plateformes.find((x) => x.id === choix)!;
  session = { plateformeId: p.id, code: p.code, nom: p.nom, environnement: 'test' };
  await choisirCle();
}

// Crée la plateforme ET son compte de service, comme le fait
// `creerPlateforme()` côté back-office. On passe par Prisma plutôt que par
// l'API d'administration parce que celle-ci exige une session de back-office :
// cette console tient le rôle du PARTENAIRE, elle n'a pas de cookie.
async function creerPlateforme(nom: string): Promise<void> {
  const code = nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const technique = await prisma.utilisateur.create({
    data: { nomComplet: nom, motDePasseHash: 'console-sans-connexion', role: 'plateforme', actif: false },
  });
  const p = await prisma.plateformePartenaire.create({
    data: { code, nom, utilisateurTechniqueId: technique.id },
  });
  console.log(`${OK}Plateforme « ${nom} » créée (code ${p.code}).${NEUTRE}`);
}

async function choisirCle(): Promise<void> {
  if (!session) return;

  const cles = await prisma.cleApiPlateforme.findMany({
    where: { plateformeId: session.plateformeId, revoqueeLe: null },
    orderBy: { creeeLe: 'desc' },
  });

  const options: { texte: string; valeur: string }[] = cles.map((c) => ({
    texte:
      `${c.environnement.padEnd(4)} ${c.prefixe} ${FAIBLE}— ${c.nbAppels} appel(s), ` +
      `[${c.scopes.join(', ')}]${NEUTRE}`,
    valeur: `coller:${c.environnement}`,
  }));

  const choix = await choisir('Clé à utiliser :', [
    ...options,
    { texte: `${FAIBLE}+ émettre une clé test${NEUTRE}`, valeur: 'emettre:test' },
    { texte: `${FAIBLE}+ émettre une clé live${NEUTRE}`, valeur: 'emettre:live' },
  ]);
  if (!choix) return;

  const [action, env] = choix.split(':') as ['coller' | 'emettre', EnvironnementCle];

  if (action === 'emettre') {
    await emettreCle(env);
    return;
  }

  // Une clé existante ne peut pas être relue — seul son SHA-256 est stocké.
  // C'est le comportement voulu, et il vaut aussi pour cet outil.
  console.log(`\n${ATTENTION}Le secret d'une clé existante n'est pas récupérable${NEUTRE} (seul son hash est en base).`);
  const collee = await demander('Coller la clé complète, ou vide pour en émettre une nouvelle');
  if (collee) {
    // Vérifier la FORME avant de retenir la clé. Sans ce contrôle, une clé
    // tronquée à la copie était acceptée sans un mot, et chaque appel suivant
    // ressortait en 401 `cle_invalide` — un symptôme qui accuse le serveur
    // alors que la faute est dans le presse-papiers.
    if (!analyserCle(collee)) {
      console.log(`${KO}Ce n’est pas une clé valide.${NEUTRE}`);
      info('  Format attendu : mtk_<env>_<8 caractères hex>_<43 caractères>');
      info('  Copie tronquée, espace de trop, ou mauvaise ligne — vérifier, ou en émettre une nouvelle.');
      return;
    }
    cleCourante = collee;
    session.environnement = env;
    console.log(`${OK}Clé retenue pour cette session.${NEUTRE}`);
    await verifierCle();
    return;
  }

  // Vide : on ENCHAÎNE sur l'émission plutôt que de revenir au menu sans clé.
  // Auparavant on retombait dans un état sans clé où toutes les actions
  // étaient refusées — un cul-de-sac dont la seule sortie était de repasser
  // par « Changer de clé ».
  await emettreCle(env);
}

// Éprouve la clé retenue avec un appel SANS charge utile utilisable.
//
// Le serveur authentifie avant de valider le corps : un `401` dit donc que la
// clé est refusée, et tout le reste qu'elle est acceptée. C'est la seule façon
// de le savoir sans attendre le premier vrai appel — et découvrir alors, au
// milieu d'un scénario, qu'on travaillait avec une clé morte.
async function verifierCle(): Promise<void> {
  const r = await appel('POST', '/api/v1/colis', {});
  if (r.status === 401) {
    const code = String((r.json as { code?: string } | null)?.code ?? 'cle_invalide');
    console.log(`${KO}La clé est refusée par le serveur (${code}).${NEUTRE}`);
    info('  Révoquée, expirée, ou d’une autre plateforme. En émettre une nouvelle.');
    cleCourante = null;
    return;
  }
  info(`  Clé acceptée par le serveur (contrôle : ${r.status}).`);
}

async function emettreCle(env: EnvironnementCle): Promise<void> {
  if (!session) return;

  // Les clés émises par la console portent ce libellé, et la précédente est
  // RÉVOQUÉE avant d'en créer une autre. Sans ça, chaque session en ajoutait
  // une : le secret ne vivant qu'en mémoire, on ne peut pas réutiliser celle
  // d'hier, et les anciennes restaient valides sans que personne ne les
  // surveille — exactement ce que le plafond de deux clés actives cherche à
  // éviter.
  const LIBELLE = 'console de développement';
  const anciennes = await prisma.cleApiPlateforme.updateMany({
    where: { plateformeId: session.plateformeId, environnement: env, libelle: LIBELLE, revoqueeLe: null },
    data: { revoqueeLe: new Date() },
  });
  if (anciennes.count > 0) {
    info(`  ${anciennes.count} clé(s) de console précédente(s) révoquée(s).`);
  }

  // Tous les scopes de l'environnement : cette console sert à ESSAYER, et une
  // clé bridée forcerait à en réémettre une à chaque cas non prévu.
  const scopes = Object.keys(CATALOGUE_SCOPES).filter(
    (s) => !(env === 'test' && s === 'marchands:creation_validee')
  );

  try {
    // On passe par la fonction du back-office plutôt que d'écrire en base :
    // le plafond de deux clés actives et le refus de
    // `marchands:creation_validee` sur une clé test s'appliquent alors à
    // l'identique. Une console qui contourne les règles qu'elle sert à
    // éprouver ne vaut rien.
    const { cleComplete, cle } = await creerCleApi(session.plateformeId, {
      environnement: env,
      scopes,
      libelle: LIBELLE,
    });

    cleCourante = cleComplete;
    session.environnement = env;
    console.log(`\n${OK}Clé ${env} émise${NEUTRE} — gardée en mémoire pour cette session :`);
    console.log(`  ${GRAS}${cleComplete}${NEUTRE}`);
    console.log(`  ${FAIBLE}scopes : ${cle.scopes.join(', ')}${NEUTRE}`);
    info('  Elle ne sera plus jamais affichée : seule son empreinte part en base.');
  } catch (err) {
    console.log(`${KO}Émission refusée : ${err instanceof Error ? err.message : String(err)}${NEUTRE}`);
    info('  Révoquer une clé depuis /admin/integrations, puis réessayer.');
  }
}

// --- Actions -----------------------------------------------------------------

let dernierAppel: { methode: string; chemin: string; corps: unknown } | null = null;

async function envoyerEtRetenir(methode: string, chemin: string, corps: unknown): Promise<Reponse> {
  dernierAppel = { methode, chemin, corps };
  return envoyer(methode, chemin, corps);
}

async function actionMarchand(): Promise<void> {
  const idExterne = await demander('idExterne (identifiant chez Shipeh)', `SHIPEH-${Date.now() % 100000}`);
  const nomBoutique = await demander('nomBoutique', 'Atlas Store');
  const nomComplet = await demander('nomComplet', 'Ahmed Benali');
  const telephone = await demander('telephone', `06${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
  const email = await demander('email', `${idExterne.toLowerCase()}@mathio.test`);
  const ville = await demander('ville', 'Casablanca');

  if (session?.environnement === 'live') {
    console.log(`${ATTENTION}Clé live : un email d'invitation sera réellement envoyé à ${email}.${NEUTRE}`);
  }

  await envoyerEtRetenir('POST', '/api/v1/marchands', {
    idExterne,
    nomComplet,
    nomBoutique,
    telephone,
    email,
    ville,
  });
}

async function actionColis(): Promise<void> {
  const idExterneMarchand = await demander('idExterneMarchand', await dernierMarchandLie());
  const reference = await demander('reference (clé d’idempotence)', `REF-${Date.now() % 1000000}`);
  const clientNom = await demander('clientNom', 'Karim Idrissi');
  const clientTelephone = await demander('clientTelephone', '0655443322');
  const ville = await demander('ville', 'Rabat');
  const adresse = await demander('adresse', '18 avenue Mohammed V');
  const montantCod = Number(await demander('montantCod', '349.90'));

  await envoyerEtRetenir('POST', '/api/v1/colis', {
    idExterneMarchand,
    reference,
    clientNom,
    clientTelephone,
    ville,
    adresse,
    montantCod,
  });
}

async function actionLot(): Promise<void> {
  const idExterneMarchand = await demander('idExterneMarchand', await dernierMarchandLie());
  const combien = Number(await demander(`Combien de colis (max ${TAILLE_MAX_LOT})`, '5'));
  const taille = Number.isInteger(combien) && combien > 0 ? Math.min(combien, TAILLE_MAX_LOT) : 5;
  const prefixe = await demander('Préfixe des références', `LOT-${Date.now() % 100000}`);

  const invalides = (await demander('Rendre volontairement invalides les lignes n° (ex. 2,4)', '')).trim();
  const aCasser = new Set(
    invalides
      .split(',')
      .map((n) => Number(n.trim()) - 1)
      .filter((n) => Number.isInteger(n) && n >= 0)
  );

  const villes = ['Casablanca', 'Rabat', 'Fès', 'Marrakech', 'Agadir', 'Tanger'];
  const lot = Array.from({ length: taille }, (_, i) => ({
    idExterneMarchand,
    reference: `${prefixe}-${i + 1}`,
    clientNom: `Client ${i + 1}`,
    clientTelephone: '0655443322',
    // Une ville vide est le refus le plus lisible : il tombe à la validation,
    // pas en base, et le message nomme le champ.
    ville: aCasser.has(i) ? '' : villes[i % villes.length],
    adresse: `${10 + i} rue de la Simulation`,
    montantCod: 100 + i * 10,
  }));

  await envoyerEtRetenir('POST', '/api/v1/colis/lot', lot);
}

async function actionRejouer(): Promise<void> {
  if (!dernierAppel) {
    console.log(`${ATTENTION}Aucun appel à rejouer.${NEUTRE}`);
    return;
  }
  info('Rejeu à l’identique — attendu : « deja_synchronise » ou « deja_ingere », jamais un doublon.');
  await envoyer(dernierAppel.methode, dernierAppel.chemin, dernierAppel.corps);
}

async function actionLibre(): Promise<void> {
  const chemin = await demander('Chemin', '/api/v1/colis');

  console.log(`${FAIBLE}Corps JSON sur UNE ligne, ou @chemin/vers/fichier.json (vide = aucun corps).${NEUTRE}`);
  const brut = await demander('>');

  let corps: unknown;
  if (brut) {
    // La convention `@fichier` est celle de curl, et elle règle la seule vraie
    // limite de la saisie en ligne : un lot de cinquante colis ne tient pas sur
    // une ligne, et le coller sur plusieurs romprait la lecture ligne à ligne.
    let texte = brut;
    if (brut.startsWith('@')) {
      const chemin = brut.slice(1).trim().replace(/^["']|["']$/g, '');
      try {
        texte = await readFile(chemin, 'utf8');
      } catch {
        console.log(`${KO}Fichier illisible : ${chemin}${NEUTRE}`);
        return;
      }
    }
    try {
      corps = JSON.parse(texte);
    } catch (err) {
      console.log(`${KO}JSON illisible — envoi annulé.${NEUTRE}`);
      info(err instanceof Error ? `  ${err.message}` : '');
      return;
    }
  }

  await envoyerEtRetenir('POST', chemin, corps);
}

// --- Suivi côté Mathio -------------------------------------------------------

async function dernierMarchandLie(): Promise<string> {
  if (!session) return '';
  const lien = await prisma.compteMarchandExterne.findFirst({
    where: { plateformeId: session.plateformeId, environnement: session.environnement },
    orderBy: { dateCreation: 'desc' },
    select: { idExterne: true },
  });
  return lien?.idExterne ?? '';
}

async function suiviMarchands(): Promise<void> {
  if (!session) return;
  const liens = await prisma.compteMarchandExterne.findMany({
    where: { plateformeId: session.plateformeId },
    orderBy: { dateCreation: 'desc' },
    include: {
      marchand: {
        select: {
          nomBoutique: true,
          statut: true,
          _count: { select: { commandes: true } },
          utilisateur: { select: { actif: true, email: true } },
        },
      },
    },
  });

  titre(`Marchands liés à ${session.nom} (${liens.length})`);
  if (liens.length === 0) {
    info('Aucun. Un marchand n’apparaît qu’après un POST /v1/marchands réussi.');
    return;
  }
  for (const l of liens) {
    const provenance = l.creeParSynchro ? 'créé par la plateforme' : `${ATTENTION}rattaché (existait déjà)${NEUTRE}`;
    console.log(
      `  ${l.environnement.padEnd(4)} ${GRAS}${l.idExterne}${NEUTRE} → « ${l.marchand.nomBoutique} »\n` +
        `       ${FAIBLE}statut ${l.marchand.statut} · compte ${l.marchand.utilisateur.actif ? 'actif' : 'inactif'} · ` +
        `${l.marchand._count.commandes} colis · ${provenance}${NEUTRE}`
    );
  }
}

async function suiviColis(): Promise<void> {
  if (!session) return;
  const liens = await prisma.compteMarchandExterne.findMany({
    where: { plateformeId: session.plateformeId },
    select: { marchandId: true },
  });
  const ids = liens.map((l) => l.marchandId);

  const colis = ids.length
    ? await prisma.commande.findMany({
        where: { marchandId: { in: ids }, source: 'api' },
        orderBy: { dateCreation: 'desc' },
        take: 20,
        select: {
          codeSuivi: true,
          codeSuiviPartenaire: true,
          statut: true,
          ville: true,
          montantCod: true,
          aRisque: true,
          marchand: { select: { nomBoutique: true } },
        },
      })
    : [];

  titre(`20 derniers colis ingérés (${colis.length})`);
  if (colis.length === 0) {
    info('Aucun colis ingéré pour cette plateforme.');
    return;
  }
  for (const c of colis) {
    console.log(
      `  ${GRAS}${c.codeSuivi}${NEUTRE} ${FAIBLE}← ${c.codeSuiviPartenaire}${NEUTRE}  ` +
        `${c.statut.padEnd(18)} ${c.ville.padEnd(14)} ${String(c.montantCod).padStart(9)} MAD` +
        `${c.aRisque ? `  ${ATTENTION}À RISQUE${NEUTRE}` : ''}`
    );
  }
}

async function suiviJournal(): Promise<void> {
  if (!session) return;
  const appels = await prisma.journalAppelApi.findMany({
    where: { plateformeId: session.plateformeId },
    orderBy: { horodatage: 'desc' },
    take: 25,
  });

  titre(`25 derniers appels reçus (${appels.length})`);
  if (appels.length === 0) {
    info('Aucun appel journalisé.');
    return;
  }
  for (const a of appels) {
    const heure = a.horodatage.toLocaleTimeString('fr-FR');
    const c = couleurStatut(a.statut);
    console.log(
      `  ${FAIBLE}${heure}${NEUTRE}  ${c}${String(a.statut).padEnd(4)}${NEUTRE} ` +
        `${a.methode} ${a.chemin.padEnd(20)} ${FAIBLE}${a.dureeMs ?? '?'} ms` +
        `${a.reference ? ` · ${a.reference}` : ''}${a.erreur ? ` · ${a.erreur}` : ''}${NEUTRE}`
    );
  }
}

async function actionPurger(): Promise<void> {
  if (!session) return;
  const { compterDonneesTest, purgerDonneesTest } = await import('../lib/plateformes');

  const avant = await compterDonneesTest(session.plateformeId);
  titre('Purge des données de bac à sable');
  console.log(`  à supprimer : ${avant.marchands} marchand(s), ${avant.colis} colis`);
  if (avant.marchandsConserves > 0) {
    console.log(
      `  ${ATTENTION}conservés${NEUTRE} : ${avant.marchandsConserves} marchand(s) et ${avant.colisConserves} colis ` +
        `${FAIBLE}(rattachés — ils existaient déjà chez nous)${NEUTRE}`
    );
  }
  if (avant.marchands === 0 && avant.marchandsConserves === 0) {
    info('Rien à purger.');
    return;
  }

  const confirmation = await demander('Confirmer la suppression ? (oui/non)', 'non');
  if (confirmation.toLowerCase() !== 'oui') {
    info('Annulé.');
    return;
  }
  const volume = await purgerDonneesTest(session.plateformeId);
  console.log(`${OK}Purgé : ${volume.marchands} marchand(s), ${volume.colis} colis.${NEUTRE}`);
}

// --- Boucle principale -------------------------------------------------------

async function main() {
  console.log(`\n${GRAS}Console Shipeh${NEUTRE} — tenir le rôle du partenaire à la main`);
  info(`hôte API : ${hoteApi}`);

  await attendreServeur();
  await choisirPlateforme();

  // Une Entrée vide sur la liste des plateformes ne doit pas fermer la
  // console : c'est la toute première question, et la refermer aussitôt oblige
  // à tout relancer — y compris à réémettre une clé, puisqu'elle ne vit qu'en
  // mémoire.
  while (!session) {
    if (entreeClose) return;
    // En mode tube, une tentative infructueuse suffit : reboucler tournerait
    // sans fin sur une entrée épuisée.
    if (!stdin.isTTY) return;
    info('Choisir une plateforme pour continuer (Ctrl+C pour fermer).');
    await choisirPlateforme();
  }

  for (;;) {
    const etat = cleCourante
      ? `${OK}clé ${session.environnement}${NEUTRE}`
      : `${ATTENTION}aucune clé${NEUTRE}`;
    console.log(`\n${FAIBLE}────────  ${session.nom} · ${etat}${FAIBLE}  ────────${NEUTRE}`);

    const choix = await choisir('Que faire ?', [
      { texte: 'Synchroniser un marchand        POST /v1/marchands', valeur: 'marchand' },
      { texte: 'Déposer un colis                POST /v1/colis', valeur: 'colis' },
      { texte: 'Déposer un lot                  POST /v1/colis/lot', valeur: 'lot' },
      { texte: `Rejouer le dernier appel        ${FAIBLE}(test d’idempotence)${NEUTRE}`, valeur: 'rejouer' },
      { texte: `Requête libre                   ${FAIBLE}(chemin et corps au choix)${NEUTRE}`, valeur: 'libre' },
      { texte: 'Suivi — marchands liés', valeur: 'suivi-marchands' },
      { texte: 'Suivi — colis ingérés', valeur: 'suivi-colis' },
      { texte: 'Suivi — journal des appels', valeur: 'suivi-journal' },
      { texte: 'Purger les données de test', valeur: 'purger' },
      { texte: 'Changer de clé ou de plateforme', valeur: 'changer' },
      { texte: 'Quitter', valeur: 'quitter' },
    ]);

    if (choix === 'quitter') return;
    // Une ligne vide au menu principal redemande, elle ne quitte pas : seule
    // l'option « Quitter » ferme la session — et avec elle la clé en mémoire.
    if (!choix) {
      if (entreeClose) return;
      continue;
    }

    // Sans clé, on en ÉMET une sur-le-champ plutôt que de renvoyer vers un
    // autre menu. Le message précédent était un cul-de-sac : il fallait passer
    // par « Changer de clé », y choisir un environnement, et revenir — trois
    // écrans pour une chose que la console peut faire seule.
    if (['marchand', 'colis', 'lot', 'rejouer', 'libre'].includes(choix) && !cleCourante) {
      console.log(`${ATTENTION}Aucune clé en mémoire — émission d’une clé ${session.environnement}.${NEUTRE}`);
      await emettreCle(session.environnement);
      if (!cleCourante) continue;
    }

    try {
      if (choix === 'marchand') await actionMarchand();
      else if (choix === 'colis') await actionColis();
      else if (choix === 'lot') await actionLot();
      else if (choix === 'rejouer') await actionRejouer();
      else if (choix === 'libre') await actionLibre();
      else if (choix === 'suivi-marchands') await suiviMarchands();
      else if (choix === 'suivi-colis') await suiviColis();
      else if (choix === 'suivi-journal') await suiviJournal();
      else if (choix === 'purger') await actionPurger();
      else if (choix === 'changer') await choisirPlateforme();
    } catch (err) {
      console.error(`${KO}Erreur : ${err instanceof Error ? err.message : String(err)}${NEUTRE}`);
    }
  }
}

main()
  .catch((err) => console.error(`\n${KO}Interrompu : ${err instanceof Error ? err.message : err}${NEUTRE}`))
  .finally(async () => {
    lecteur?.close();
    await prisma.$disconnect();
  });
