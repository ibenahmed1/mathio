import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/api-utils';
import { HOST_API } from '../lib/spaces';
import { genererCle } from '../lib/plateforme-cles';
import { creerCleApi } from '../lib/plateformes';
import { STATUTS_TERMINAUX } from '../lib/statuts';
import { creerClient, type Reponse } from './audit-http';

// SIMULATEUR DE TRANSPORTEUR SOUS-TRAITANT — joue le rôle de Meta Livraison
// de bout en bout (§ API_SUIVI_PRESTATAIRES.md).
//
//   npx tsx scripts/simuler-prestataire.ts [codeA codeB codeC]
//
// avec un serveur de développement en cours (`npm run dev`).
//
// Pendant du simulateur Shipeh, pour l'autre audience. Sans les trois codes en
// argument, le script choisit lui-même trois colis déclarables.
//
// CE QU'IL FAIT QUE POSTMAN NE PEUT PAS FAIRE
//
// Postman voit les réponses HTTP ; lui voit la BASE. C'est là que se jouent
// les deux garanties qu'aucune assertion sur un corps JSON ne peut établir :
//
//   - l'historique est signé du COMPTE DE SERVICE du prestataire, et pas d'un
//     collègue — la seule chose qui rende la trace honnête ;
//   - un rejeu n'écrit AUCUNE seconde ligne d'historique. Sans ce contrôle,
//     l'idempotence pourrait répondre « inchange » tout en empilant des lignes
//     qui laisseraient croire à une seconde tentative de livraison.
//
// ⚠ IL ÉCRIT POUR DE VRAI. Le premier colis finit `livre` — écriture d'ARGENT :
// il devient facturable au marchand. Le script n'utilise que les colis qu'on
// lui donne, et ne crée ni ne supprime aucun colis.
//
// La clé d'API est temporaire : créée au début, RÉVOQUÉE à la fin, jamais
// supprimée (même règle que partout : une clé garde ses compteurs pour une
// analyse post-incident).

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

function attendu(reponse: Reponse, statut: number, code?: string) {
  if (reponse.status !== statut) {
    throw new Error(`statut ${reponse.status} au lieu de ${statut} (${reponse.texte.slice(0, 200)})`);
  }
  if (code && reponse.json?.code !== code) {
    throw new Error(`code « ${String(reponse.json?.code)} » au lieu de « ${code} »`);
  }
}

function egal(obtenu: unknown, voulu: unknown, quoi: string) {
  if (obtenu !== voulu) throw new Error(`${quoi} : « ${String(obtenu)} » au lieu de « ${String(voulu)} »`);
}

// ------------------------------------------------------------
// Transport — l'hôte de l'API, jamais un hôte d'espace
// ------------------------------------------------------------

const client = creerClient('admin');
const hoteApi = HOST_API ?? 'api.localhost:3000';

function appel(methode: string, chemin: string, cle: string | null, corps?: unknown): Promise<Reponse> {
  return client.api(methode, chemin, corps, {
    host: hoteApi,
    origin: null,
    cookie: null,
    entetes: cle ? { Authorization: `Bearer ${cle}` } : {},
  });
}

async function attendreApi(): Promise<void> {
  let dernier = '';
  for (let i = 0; i < 10; i++) {
    try {
      const r = await appel('POST', '/api/v1/auth', null);
      if (r.status === 401) return;
      if (r.status === 404) {
        throw new Error(
          `Le serveur répond, mais « ${hoteApi} » n'expose pas cette route.\n` +
            "       Si la réponse est du HTML, la route n'existe pas dans le serveur qui tourne :\n" +
            '       relancer `npm run dev`. Sinon vérifier le port et HOST_API.'
        );
      }
      dernier = `statut ${r.status}`;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Le serveur répond')) throw err;
      dernier = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Serveur injoignable (${dernier}). Lancer \`npm run dev\`.`);
}

// ------------------------------------------------------------
// Amorçage
// ------------------------------------------------------------

const CODE_CONCURRENT = 'simulation-concurrent';

interface Amorce {
  /** Clé de travail — `live`, faute de bac à sable pour ce flux (§ amorcer). */
  cle: string;
  cleRevoquee: string;
  cleExpiree: string;
  cleQuota: string;
  idsCles: string[];
  plateformeId: string;
  plateformeCode: string;
  utilisateurTechniqueId: string;
  prestataireNom: string;
  colis: string[];
  /** Second transporteur, pour le test d'isolation. Null si le référentiel n'en a qu'un. */
  concurrent: {
    cle: string;
    cleId: string;
    prestataireNom: string;
    plateformeCreee: string | null;
  } | null;
}

async function poserCle(
  plateformeId: string,
  environnement: 'live' | 'test',
  extra: { revoqueeLe?: Date; expireLe?: Date; quotaParMinute?: number } = {}
): Promise<{ cleComplete: string; id: string }> {
  const { cleComplete, prefixe, secretHash } = genererCle(environnement);
  const creee = await prisma.cleApiPlateforme.create({
    data: {
      plateformeId,
      prefixe,
      secretHash,
      environnement,
      scopes: ['livraisons:statut'],
      libelle: 'SIMULATION — temporaire, révoquée en fin de script',
      ...extra,
    },
  });
  return { cleComplete, id: creee.id };
}

/**
 * Un SECOND transporteur, pour la vérification qui compte le plus : qu'une clé
 * ne puisse pas toucher le colis d'un concurrent.
 *
 * Réutilise son compte machine s'il en a déjà un, en crée un temporaire sinon —
 * et ne supprime que ce qu'il a créé lui-même.
 */
async function amorcerConcurrent(
  prestataireIdPrincipal: string
): Promise<Amorce['concurrent']> {
  // Résidu d'une exécution interrompue : la contrainte d'unicité sur `code`
  // ferait échouer la création sans ça.
  const residu = await prisma.plateformePartenaire.findUnique({
    where: { code: CODE_CONCURRENT },
    select: { id: true, utilisateurTechniqueId: true },
  });
  if (residu) {
    await prisma.plateformePartenaire.delete({ where: { id: residu.id } });
    await prisma.utilisateur.delete({ where: { id: residu.utilisateurTechniqueId } }).catch(() => {});
  }

  const autre = await prisma.prestataire.findFirst({
    where: { actif: true, id: { not: prestataireIdPrincipal }, agences: { some: {} } },
    select: { id: true, nom: true, compteMachine: { select: { id: true } } },
    orderBy: { nom: 'asc' },
  });
  if (!autre) return null;

  if (autre.compteMachine) {
    const { cleComplete, id } = await poserCle(autre.compteMachine.id, 'test');
    return { cle: cleComplete, cleId: id, prestataireNom: autre.nom, plateformeCreee: null };
  }

  const technique = await prisma.utilisateur.create({
    data: {
      nomComplet: `SIMULATION ${autre.nom}`,
      motDePasseHash: 'simulation-sans-connexion-possible',
      role: 'plateforme',
      actif: false,
    },
  });
  const plateforme = await prisma.plateformePartenaire.create({
    data: {
      code: CODE_CONCURRENT,
      nom: `SIMULATION ${autre.nom}`,
      utilisateurTechniqueId: technique.id,
      prestataireId: autre.id,
    },
  });
  const { cleComplete, id } = await poserCle(plateforme.id, 'test');
  return { cle: cleComplete, cleId: id, prestataireNom: autre.nom, plateformeCreee: plateforme.id };
}

async function amorcer(codesDemandes: string[]): Promise<Amorce> {
  const compte = await prisma.plateformePartenaire.findFirst({
    where: { prestataireId: { not: null }, actif: true },
    select: {
      id: true,
      code: true,
      utilisateurTechniqueId: true,
      prestataireId: true,
      prestataire: { select: { nom: true } },
    },
  });

  if (!compte) {
    throw new Error(
      'Aucun compte machine actif rattaché à un transporteur.\n' +
        '       /admin/integrations → « Nouvelle plateforme », en choisissant un transporteur.'
    );
  }

  // Le périmètre de l'API, reproduit à l'identique.
  const declarables = await prisma.commande.findMany({
    where: {
      hubActuel: { prestataireId: compte.prestataireId! },
      statut: { notIn: STATUTS_TERMINAUX },
      ...(codesDemandes.length > 0 ? { codeSuivi: { in: codesDemandes } } : {}),
    },
    select: { codeSuivi: true },
    orderBy: { dateCreation: 'desc' },
    take: 3,
  });

  if (declarables.length < 3) {
    const trouves = declarables.map((c) => c.codeSuivi).join(', ') || 'aucun';
    throw new Error(
      `Il faut TROIS colis déclarables chez « ${compte.prestataire!.nom} », ${declarables.length} trouvé(s) : ${trouves}.\n` +
        '       Un colis est déclarable quand son hub actuel est une agence de ce transporteur\n' +
        '       et que son statut n’est pas terminal. Pour en trouver : npx tsx scripts/colis-confies.ts'
    );
  }

  const concurrent = await amorcerConcurrent(compte.prestataireId!);
  // La clé de travail est une clé `live`, et ce n'est pas un raccourci :
  // `livraisons:statut` est refusé à l'émission sur une clé `test`
  // (SCOPES_INTERDITS_EN_TEST) — il n'y a pas de bac à sable pour un flux qui
  // mute des colis réels. La clé `test` ci-dessous n'existe que pour vérifier
  // ce refus.
  const live = await poserCle(compte.id, 'live');
  const revoquee = await poserCle(compte.id, 'live', { revoqueeLe: new Date() });
  const expiree = await poserCle(compte.id, 'live', { expireLe: new Date(Date.now() - 60_000) });
  const quota = await poserCle(compte.id, 'live', { quotaParMinute: 2 });

  return {
    cle: live.cleComplete,
    cleRevoquee: revoquee.cleComplete,
    cleExpiree: expiree.cleComplete,
    cleQuota: quota.cleComplete,
    idsCles: [live.id, revoquee.id, expiree.id, quota.id, ...(concurrent ? [concurrent.cleId] : [])],
    plateformeId: compte.id,
    plateformeCode: compte.code,
    utilisateurTechniqueId: compte.utilisateurTechniqueId,
    prestataireNom: compte.prestataire!.nom,
    colis: declarables.map((c) => c.codeSuivi),
    concurrent,
  };
}

// ------------------------------------------------------------
// Scénario
// ------------------------------------------------------------

async function main(): Promise<void> {
  const codes = process.argv.slice(2).map((c) => c.trim().toUpperCase());

  console.log('\nSIMULATEUR DE TRANSPORTEUR SOUS-TRAITANT');
  console.log(`Hôte de l'API : ${hoteApi}\n`);

  await attendreApi();

  const a = await amorcer(codes);
  const [colisA, colisB, colisC] = a.colis;

  console.log(`Transporteur : ${a.prestataireNom}  (compte « ${a.plateformeCode} »)`);
  console.log(`Colis        : ${colisA} (sera LIVRÉ), ${colisB}, ${colisC}\n`);

  try {
    // --- 0. Branchement ---
    console.log('0 — Branchement');

    await verifie('sans clé → 401 cle_absente', async () => {
      attendu(await appel('POST', '/api/v1/auth', null), 401, 'cle_absente');
    });

    await verifie('clé valide → 200 avec le scope', async () => {
      const r = await appel('POST', '/api/v1/auth', a.cle);
      attendu(r, 200);
      egal(r.json?.valide, true, 'valide');
      const scopes = r.json?.scopes as string[];
      if (!scopes.includes('livraisons:statut')) throw new Error('scope absent');
    });

    await verifie('catalogue → 12 statuts, aucun interne', async () => {
      const r = await appel('GET', '/api/v1/statuts', a.cle);
      attendu(r, 200);
      const statuts = r.json?.statuts as { statut: string }[];
      egal(statuts.length, 12, 'nombre de statuts');
      for (const interne of ['recu_au_hub', 'en_transit', 'mise_en_distribution', 'retourne']) {
        if (statuts.some((s) => s.statut === interne)) throw new Error(`${interne} exposé`);
      }
    });

    // --- 1. Écriture ---
    console.log('\n1 — Déclarer un colis');

    const avant = await prisma.historiqueStatutCommande.count({
      where: { commande: { codeSuivi: colisA } },
    });

    await verifie('livré → 200 applique', async () => {
      const r = await appel('POST', '/api/v1/livraisons/statut', a.cle, {
        codeSuivi: colisA,
        statut: 'livre',
        note: 'Remis en main propre',
      });
      attendu(r, 200);
      egal(r.json?.issue, 'applique', 'issue');
      egal(r.json?.statut, 'livre', 'statut');
    });

    await verifie('rejeu du même statut → 200 inchange', async () => {
      const r = await appel('POST', '/api/v1/livraisons/statut', a.cle, {
        codeSuivi: colisA,
        statut: 'livre',
      });
      attendu(r, 200);
      egal(r.json?.issue, 'inchange', 'issue');
    });

    await verifie('colis clos → 409 colis_clos', async () => {
      attendu(
        await appel('POST', '/api/v1/livraisons/statut', a.cle, {
          codeSuivi: colisA,
          statut: 'reporte',
          date: '2026-09-20',
        }),
        409,
        'colis_clos'
      );
    });

    await verifie('report daté → 200 applique', async () => {
      const r = await appel('POST', '/api/v1/livraisons/statut', a.cle, {
        codeSuivi: colisB,
        statut: 'reporte',
        date: '2026-09-15',
        note: 'Client absent, repasse mardi',
      });
      attendu(r, 200);
      egal(r.json?.issue, 'applique', 'issue');
    });

    await verifie('report sans date → 400 date_requise', async () => {
      attendu(
        await appel('POST', '/api/v1/livraisons/statut', a.cle, { codeSuivi: colisB, statut: 'reporte' }),
        400,
        'date_requise'
      );
    });

    await verifie('date ambiguë → 400, jamais devinée', async () => {
      attendu(
        await appel('POST', '/api/v1/livraisons/statut', a.cle, {
          codeSuivi: colisB,
          statut: 'reporte',
          date: '12/09/2026',
        }),
        400,
        'date_requise'
      );
    });

    await verifie('statut anglais → 400 statut_invalide', async () => {
      const r = await appel('POST', '/api/v1/livraisons/statut', a.cle, {
        codeSuivi: colisB,
        statut: 'DELIVERED',
      });
      attendu(r, 400, 'statut_invalide');
      if (!String(r.json?.message).includes('livre')) throw new Error('valeurs acceptées non citées');
    });

    await verifie('statut interne → 400 statut_invalide', async () => {
      attendu(
        await appel('POST', '/api/v1/livraisons/statut', a.cle, {
          codeSuivi: colisB,
          statut: 'recu_au_hub',
        }),
        400,
        'statut_invalide'
      );
    });

    await verifie('code minuscule → accepté', async () => {
      const r = await appel('POST', '/api/v1/livraisons/statut', a.cle, {
        codeSuivi: colisB.toLowerCase(),
        statut: 'reporte',
        date: '2026-09-15',
      });
      attendu(r, 200);
      egal(r.json?.codeSuivi, colisB, 'code normalisé');
    });

    await verifie('colis inconnu → 404 colis_introuvable', async () => {
      attendu(
        await appel('POST', '/api/v1/livraisons/statut', a.cle, {
          codeSuivi: 'PD-999999',
          statut: 'livre',
        }),
        404,
        'colis_introuvable'
      );
    });

    // --- 2. Lot ---
    console.log('\n2 — Déclarer un lot');

    await verifie('lot mixte → 200, 2 traitées / 1 refusée', async () => {
      const r = await appel('POST', '/api/v1/livraisons/statut/lot', a.cle, {
        livraisons: [
          { codeSuivi: colisB, statut: 'injoignable', note: 'Trois tentatives' },
          { codeSuivi: colisC, statut: 'refuse' },
          { codeSuivi: 'PD-999999', statut: 'livre' },
        ],
      });
      attendu(r, 200);
      egal(r.json?.totalTraite, 2, 'totalTraite');
      egal(r.json?.totalRefuse, 1, 'totalRefuse');
      const resultats = r.json?.resultats as { issue: string; code?: string }[];
      egal(resultats.length, 3, 'nombre de résultats');
      const refusee = resultats.find((x) => x.issue === 'refuse');
      egal(refusee?.code, 'colis_introuvable', 'code de la ligne refusée');
    });

    await verifie('lot vide → 400 champ_requis', async () => {
      attendu(
        await appel('POST', '/api/v1/livraisons/statut/lot', a.cle, { livraisons: [] }),
        400,
        'champ_requis'
      );
    });

    // --- 3. L'effet en base, que Postman ne voit pas ---
    console.log('\n3 — Ce que l’écriture a réellement produit');

    await verifie('le colis est passé à livré, avec sa date', async () => {
      const c = await prisma.commande.findUnique({
        where: { codeSuivi: colisA },
        select: { statut: true, dateLivraison: true },
      });
      egal(c?.statut, 'livre', 'statut en base');
      if (!c?.dateLivraison) throw new Error('dateLivraison non renseignée');
    });

    await verifie('UNE seule ligne d’historique, malgré le rejeu', async () => {
      const apres = await prisma.historiqueStatutCommande.count({
        where: { commande: { codeSuivi: colisA } },
      });
      egal(apres - avant, 1, 'lignes ajoutées');
    });

    await verifie('l’historique est signé du compte de service, pas d’un collègue', async () => {
      const ligne = await prisma.historiqueStatutCommande.findFirst({
        where: { commande: { codeSuivi: colisA } },
        orderBy: { horodatage: 'desc' },
        select: { nouveauStatut: true, utilisateurId: true, note: true, hubId: true },
      });
      egal(ligne?.nouveauStatut, 'livre', 'statut historisé');
      egal(ligne?.utilisateurId, a.utilisateurTechniqueId, 'auteur');
      if (!ligne?.note?.includes(a.plateformeCode)) {
        throw new Error(`la note ne cite pas le prestataire : « ${ligne?.note} »`);
      }
      // La colonne ne se renseigne que sur les transitions posées à un quai.
      egal(ligne?.hubId, null, 'hubId');
    });

    await verifie('la note du livreur est devenue un commentaire', async () => {
      const commentaire = await prisma.commentaireCommande.findFirst({
        where: { commande: { codeSuivi: colisA }, texte: 'Remis en main propre' },
        select: { utilisateurId: true },
      });
      if (!commentaire) throw new Error('commentaire absent');
      egal(commentaire.utilisateurId, a.utilisateurTechniqueId, 'auteur du commentaire');
    });

    await verifie('la date de report a atterri dans la file de relance', async () => {
      const c = await prisma.commande.findUnique({
        where: { codeSuivi: colisB },
        select: { dateNouvelleLivraison: true },
      });
      if (!c?.dateNouvelleLivraison) throw new Error('dateNouvelleLivraison non renseignée');
      egal(c.dateNouvelleLivraison.toISOString().slice(0, 10), '2026-09-15', 'date');
    });

    await verifie('le lot a bien écrit les deux lignes qu’il annonçait', async () => {
      const b = await prisma.commande.findUnique({
        where: { codeSuivi: colisB },
        select: { statut: true },
      });
      const c = await prisma.commande.findUnique({
        where: { codeSuivi: colisC },
        select: { statut: true },
      });
      egal(b?.statut, 'injoignable', `statut de ${colisB}`);
      egal(c?.statut, 'refuse', `statut de ${colisC}`);
    });

    // --- 4. Isolation entre transporteurs ---
    console.log('\n4 — Isolation entre transporteurs');

    if (!a.concurrent) {
      console.log('  --   ignoré : le référentiel ne contient qu’un transporteur avec des agences.');
    } else {
      await verifie(
        `« ${a.concurrent.prestataireNom} » ne peut pas toucher un colis de « ${a.prestataireNom} »`,
        async () => {
          // LA vérification du module. Une clé authentifiée, valide, avec le bon
          // scope, sur un colis qui EXISTE — et qui doit malgré tout se voir
          // opposer le même 404 qu'un code inventé. Le 403 serait une fuite : il
          // confirmerait que ce code de suivi est en circulation chez nous.
          const r = await appel('POST', '/api/v1/livraisons/statut', a.concurrent!.cle, {
            codeSuivi: colisB,
            statut: 'livre',
          });
          attendu(r, 404, 'colis_introuvable');
        }
      );

      await verifie('le colis du concurrent n’a pas bougé', async () => {
        const c = await prisma.commande.findUnique({
          where: { codeSuivi: colisB },
          select: { statut: true },
        });
        egal(c?.statut, 'injoignable', `statut de ${colisB}`);
      });
    }

    // --- 5. Cycle de vie des clés ---
    console.log('\n5 — Cycle de vie des clés');

    await verifie('la clé de travail est bien une clé live', async () => {
      const r = await appel('POST', '/api/v1/auth', a.cle);
      attendu(r, 200);
      egal(r.json?.environnement, 'live', 'environnement');
    });

    await verifie('« livraisons:statut » est refusé à une clé de test', async () => {
      // LE garde-fou du module : il n'y a pas de bac à sable pour un flux qui
      // mute des colis réels. Le refus est prononcé à l'ÉMISSION, donc ce test
      // n'appelle pas l'API — il tente de créer la clé, et c'est la création
      // qui doit échouer. Une clé émise malgré tout serait une clé capable de
      // fermer un vrai colis depuis un environnement présenté comme isolé.
      try {
        await creerCleApi(a.plateformeId, {
          environnement: 'test',
          scopes: ['livraisons:statut'],
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) return;
        throw err;
      }
      throw new Error('la clé de test a été émise alors qu’elle aurait dû être refusée');
    });

    await verifie('clé révoquée → 401 cle_revoquee', async () => {
      attendu(await appel('POST', '/api/v1/auth', a.cleRevoquee), 401, 'cle_revoquee');
    });

    await verifie('clé expirée → 401 cle_expiree', async () => {
      attendu(await appel('POST', '/api/v1/auth', a.cleExpiree), 401, 'cle_expiree');
    });

    await verifie('quota dépassé → 429 quota_depasse', async () => {
      // Quota à 2 par minute : le troisième appel doit tomber.
      await appel('POST', '/api/v1/auth', a.cleQuota);
      await appel('POST', '/api/v1/auth', a.cleQuota);
      attendu(await appel('POST', '/api/v1/auth', a.cleQuota), 429, 'quota_depasse');
    });

    // --- 6. Concurrence ---
    console.log('\n6 — Concurrence');

    await verifie('cinq déclarations simultanées → UNE seule ligne d’historique', async () => {
      // Le cas qu'un contrôle « lire puis écrire » ne couvre pas : cinq
      // requêtes lisent le même état avant qu'aucune n'ait écrit. Sans le
      // verrou optimiste (lib/livraison-statut.ts), cinq lignes d'historique
      // décriraient cinq tentatives de livraison là où il n'y en a eu qu'une.
      const avantC = await prisma.historiqueStatutCommande.count({
        where: { commande: { codeSuivi: colisC } },
      });

      const reponses = await Promise.all(
        Array.from({ length: 5 }, () =>
          appel('POST', '/api/v1/livraisons/statut', a.cle, {
            codeSuivi: colisC,
            statut: 'hors_zone',
          })
        )
      );

      const echecs = reponses.filter((r) => r.status !== 200);
      if (echecs.length > 0) {
        throw new Error(
          `${echecs.length} réponse(s) non-200 : ${echecs.map((r) => `${r.status}/${String(r.json?.code)}`).join(', ')}`
        );
      }

      const apresC = await prisma.historiqueStatutCommande.count({
        where: { commande: { codeSuivi: colisC } },
      });
      egal(apresC - avantC, 1, 'lignes d’historique ajoutées');
    });
  } finally {
    // Les clés du compte RÉEL sont révoquées, jamais supprimées : leurs
    // compteurs restent exploitables en analyse post-incident, comme toutes
    // les clés du dépôt.
    await prisma.cleApiPlateforme.updateMany({
      where: { id: { in: a.idsCles } },
      data: { revoqueeLe: new Date() },
    });

    // Les compteurs de quota, eux, sont nettoyés — et seulement ceux des clés
    // de ce script : purger tout le préfixe `plateforme` remettrait à zéro le
    // quota des vraies intégrations en cours.
    await prisma.rateLimitEntry.deleteMany({
      where: { cle: { in: a.idsCles.map((id) => `plateforme:${id}`) } },
    });

    // Le compte du concurrent, lui, est SUPPRIMÉ — mais seulement si c'est ce
    // script qui l'a créé. Un compte machine préexistant garde ses clés et sa
    // fiche ; on ne révoque que celle qu'on lui a ajoutée.
    if (a.concurrent?.plateformeCreee) {
      const p = await prisma.plateformePartenaire.findUnique({
        where: { id: a.concurrent.plateformeCreee },
        select: { utilisateurTechniqueId: true },
      });
      await prisma.plateformePartenaire.delete({ where: { id: a.concurrent.plateformeCreee } });
      if (p) await prisma.utilisateur.delete({ where: { id: p.utilisateurTechniqueId } }).catch(() => {});
    }

    console.log('\nClés de simulation révoquées, compte concurrent temporaire supprimé.');
  }

  console.log(`\n${reussis} vérification(s) au vert, ${echoues} au rouge.`);
  console.log(`État final — ${colisA} : livré · ${colisB} : injoignable · ${colisC} : hors-zone`);
  if (echoues > 0) process.exitCode = 1;
}

main()
  .catch((erreur) => {
    console.error(`\n${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
