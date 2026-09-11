import { Prisma } from '@/app/generated/prisma/client';
import type { EnvironnementApi } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { hashSecretImpossible } from '@/lib/auth';
import {
  SCOPES_INTERDITS_EN_TEST,
  SCOPES_TRANSPORTEUR,
  SCOPES_VENTE,
  assainirScopes,
  genererCle,
} from '@/lib/plateforme-cles';

// Administration des plateformes partenaires (§ /admin/integrations).
//
// Toute la logique vit ici, les handlers ne font que valider l'entrée et
// sérialiser la sortie. Ce fichier ne parle QUE du back-office : ce qu'une
// plateforme a le droit de faire au bout de sa clé est décidé ailleurs
// (lib/plateforme-auth.ts).

// Au plus DEUX clés actives par plateforme ET PAR ENVIRONNEMENT — c'est ce
// qui rend une rotation possible sans coupure : la nouvelle est créée pendant
// que l'ancienne fonctionne encore, le partenaire déploie, puis l'ancienne
// est expirée. Sans plafond, des clés oubliées s'accumuleraient et chacune
// resterait un accès valide que personne ne surveille.
export const MAX_CLES_ACTIVES = 2;

export interface PlateformeResume {
  id: string;
  code: string;
  nom: string;
  actif: boolean;
  dateCreation: Date;
  nbClesActives: number;
  nbMarchands: number;
  /**
   * Transporteur derrière ce compte machine, ou `null` pour un canal de vente.
   * C'est ce champ — et lui seul — qui dit la NATURE du compte : rempli, il
   * déclare des issues de livraison ; vide, il dépose des colis. Voir
   * PlateformePartenaire.prestataireId (prisma/schema.prisma).
   */
  prestataire: { id: string; nom: string } | null;
}

export interface CleResume {
  id: string;
  prefixe: string;
  environnement: EnvironnementApi;
  scopes: string[];
  libelle: string | null;
  quotaParMinute: number;
  creeeLe: Date;
  expireLe: Date | null;
  revoqueeLe: Date | null;
  derniereUtilisationLe: Date | null;
  nbAppels: number;
  /** Dérivé, jamais stocké : révoquée ou échue comptent pour inactives. */
  active: boolean;
}

export interface MarchandLie {
  id: string;
  idExterne: string;
  environnement: EnvironnementApi;
  dateCreation: Date;
  marchandId: string;
  nomBoutique: string;
  statut: string;
}

export interface AppelJournalise {
  id: string;
  methode: string;
  chemin: string;
  statut: number;
  dureeMs: number | null;
  reference: string | null;
  erreur: string | null;
  horodatage: Date;
}

export interface PlateformeDetail extends PlateformeResume {
  cles: CleResume[];
  marchands: MarchandLie[];
  appels: AppelJournalise[];
  /** Ce que le bac à sable a laissé dans les vraies tables. Voir §purge. */
  volumeTest: VolumeTest;
}

function cleEstActive(cle: { expireLe: Date | null; revoqueeLe: Date | null }, maintenant = new Date()): boolean {
  if (cle.revoqueeLe) return false;
  return !cle.expireLe || cle.expireLe > maintenant;
}

// Le code d'une plateforme sert dans les URL d'administration et dans les
// journaux : on le contraint plutôt que de le nettoyer en silence, pour qu'un
// code inattendu se voie à la création et non six mois plus tard dans une URL
// cassée.
// Deux caractères minimum, trente-deux maximum, sans tiret aux extrémités.
//
// Écrit `[a-z0-9] [a-z0-9-]{0,30} [a-z0-9]` et non avec un groupe optionnel :
// la forme précédente, `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$`, acceptait un
// code d'UN caractère et refusait ceux de DEUX — l'inverse exact de la règle
// que son propre message d'erreur annonçait.
const MOTIF_CODE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

export function normaliserCodePlateforme(valeur: unknown): string {
  const code = typeof valeur === 'string' ? valeur.trim().toLowerCase() : '';
  if (!MOTIF_CODE.test(code)) {
    throw new ApiError(
      400,
      'code invalide : 2 à 32 caractères, minuscules, chiffres et tirets, ne commençant ni ne finissant par un tiret'
    );
  }
  return code;
}

export async function listerPlateformes(): Promise<PlateformeResume[]> {
  const lignes = await prisma.plateformePartenaire.findMany({
    orderBy: { dateCreation: 'asc' },
    include: {
      cles: { select: { expireLe: true, revoqueeLe: true } },
      prestataire: { select: { id: true, nom: true } },
      _count: { select: { comptesMarchands: true } },
    },
  });

  const maintenant = new Date();
  return lignes.map((p) => ({
    id: p.id,
    code: p.code,
    nom: p.nom,
    actif: p.actif,
    dateCreation: p.dateCreation,
    nbClesActives: p.cles.filter((c) => cleEstActive(c, maintenant)).length,
    nbMarchands: p._count.comptesMarchands,
    prestataire: p.prestataire,
  }));
}

/**
 * Les transporteurs qui peuvent encore recevoir un compte machine : actifs, et
 * pas déjà rattachés à un autre. Le filtre n'est pas cosmétique — l'unicité de
 * `prestataireId` ferait échouer la création en 409, et proposer un choix qui
 * ne peut pas aboutir est une erreur qu'on fait porter à l'utilisateur.
 */
export async function listerTransporteursDisponibles(): Promise<{ id: string; nom: string }[]> {
  return prisma.prestataire.findMany({
    where: { actif: true, compteMachine: { is: null } },
    orderBy: { nom: 'asc' },
    select: { id: true, nom: true },
  });
}

export async function detaillerPlateforme(id: string): Promise<PlateformeDetail | null> {
  const p = await prisma.plateformePartenaire.findUnique({
    where: { id },
    include: {
      cles: { orderBy: { creeeLe: 'desc' } },
      comptesMarchands: {
        orderBy: { dateCreation: 'desc' },
        take: 200,
        include: { marchand: { select: { nomBoutique: true, statut: true } } },
      },
      // Le journal n'est là que pour le diagnostic à chaud : les 100 derniers
      // appels suffisent à voir ce qui arrive en ce moment, et charger tout
      // l'historique d'une intégration active rendrait l'écran inutilisable.
      appels: { orderBy: { horodatage: 'desc' }, take: 100 },
      prestataire: { select: { id: true, nom: true } },
      _count: { select: { comptesMarchands: true } },
    },
  });
  if (!p) return null;

  const maintenant = new Date();
  return {
    id: p.id,
    code: p.code,
    nom: p.nom,
    actif: p.actif,
    dateCreation: p.dateCreation,
    nbClesActives: p.cles.filter((c) => cleEstActive(c, maintenant)).length,
    nbMarchands: p._count.comptesMarchands,
    prestataire: p.prestataire,
    cles: p.cles.map((c) => ({
      id: c.id,
      prefixe: c.prefixe,
      environnement: c.environnement,
      scopes: c.scopes,
      libelle: c.libelle,
      quotaParMinute: c.quotaParMinute,
      creeeLe: c.creeeLe,
      expireLe: c.expireLe,
      revoqueeLe: c.revoqueeLe,
      derniereUtilisationLe: c.derniereUtilisationLe,
      nbAppels: c.nbAppels,
      active: cleEstActive(c, maintenant),
    })),
    marchands: p.comptesMarchands.map((m) => ({
      id: m.id,
      idExterne: m.idExterne,
      environnement: m.environnement,
      dateCreation: m.dateCreation,
      marchandId: m.marchandId,
      nomBoutique: m.marchand.nomBoutique,
      statut: m.marchand.statut,
    })),
    appels: p.appels.map((a) => ({
      id: a.id,
      methode: a.methode,
      chemin: a.chemin,
      statut: a.statut,
      dureeMs: a.dureeMs,
      reference: a.reference,
      erreur: a.erreur,
      horodatage: a.horodatage,
    })),
    volumeTest: await compterDonneesTest(id),
  };
}

export async function creerPlateforme(
  code: string,
  nom: string,
  prestataireId?: string | null
): Promise<PlateformeResume> {
  // Le rattachement est vérifié AVANT la transaction : un identifiant inconnu
  // finirait sinon en violation de clé étrangère, donc en 500 — « le problème
  // est chez nous » pour une valeur que l'appelant a mal choisie.
  let prestataire: { id: string; nom: string } | null = null;
  if (prestataireId) {
    const trouve = await prisma.prestataire.findUnique({
      where: { id: prestataireId },
      select: { id: true, nom: true, actif: true },
    });
    if (!trouve) throw new ApiError(404, 'Transporteur introuvable');
    if (!trouve.actif) {
      throw new ApiError(400, `Le transporteur « ${trouve.nom} » est désactivé`);
    }
    prestataire = { id: trouve.id, nom: trouve.nom };
  }

  // Le compte de service et la plateforme naissent ENSEMBLE, dans une seule
  // transaction : une plateforme sans compte technique ne pourrait rien
  // écrire (HistoriqueStatutCommande.utilisateurId est non nullable) et un
  // compte technique orphelin serait un compte de plus dans la table des
  // utilisateurs, sans rien pour dire à quoi il sert.
  try {
    const creee = await prisma.$transaction(async (tx) => {
      const technique = await tx.utilisateur.create({
        data: {
          nomComplet: nom,
          // Ni téléphone ni email : ce compte n'a aucun moyen d'être trouvé
          // par /api/auth/login, qui cherche sur l'un ou l'autre.
          motDePasseHash: await hashSecretImpossible(),
          role: 'plateforme',
          // Deuxième barrière, après l'absence d'espace pour ce rôle.
          actif: false,
        },
      });

      return tx.plateformePartenaire.create({
        data: { code, nom, utilisateurTechniqueId: technique.id, prestataireId: prestataire?.id },
      });
    });

    return {
      id: creee.id,
      code: creee.code,
      nom: creee.nom,
      actif: creee.actif,
      dateCreation: creee.dateCreation,
      nbClesActives: 0,
      nbMarchands: 0,
      prestataire,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Deux unicités peuvent tomber ici, et les confondre enverrait chercher
      // la panne du mauvais côté : le code de la plateforme, ou le transporteur
      // qui a déjà son compte machine. `meta.target` dit laquelle.
      const cible = String(error.meta?.target ?? '');
      if (cible.includes('prestataire')) {
        throw new ApiError(
          409,
          `Le transporteur « ${prestataire?.nom ?? 'sélectionné'} » a déjà un compte machine`
        );
      }
      throw new ApiError(409, `Une plateforme porte déjà le code « ${code} »`);
    }
    throw error;
  }
}

export async function majPlateforme(
  id: string,
  champs: { nom?: string; actif?: boolean }
): Promise<PlateformeResume> {
  const existante = await prisma.plateformePartenaire.findUnique({ where: { id } });
  if (!existante) throw new ApiError(404, 'Plateforme introuvable');

  const misAJour = await prisma.$transaction(async (tx) => {
    const p = await tx.plateformePartenaire.update({
      where: { id },
      data: {
        ...(champs.nom !== undefined ? { nom: champs.nom } : {}),
        ...(champs.actif !== undefined ? { actif: champs.actif } : {}),
      },
    });
    // Le compte de service porte le nom de la plateforme : c'est lui qui
    // s'affiche comme auteur dans l'historique des colis. Le laisser diverger
    // ferait apparaître l'ancien nom sur les colis ingérés après le
    // changement.
    if (champs.nom !== undefined) {
      await tx.utilisateur.update({
        where: { id: p.utilisateurTechniqueId },
        data: { nomComplet: champs.nom },
      });
    }
    return p;
  });

  const [nbClesActives, nbMarchands, prestataire] = await Promise.all([
    compterClesActives(id),
    prisma.compteMarchandExterne.count({ where: { plateformeId: id } }),
    // Le rattachement ne se modifie pas ici — c'est un choix de création, pas
    // un réglage : le déplacer d'un transporteur à l'autre changerait le
    // périmètre de clés déjà émises et déjà déployées chez un tiers. On le
    // relit seulement, pour que la réponse porte le même résumé complet que
    // les autres.
    prisma.prestataire.findFirst({
      where: { compteMachine: { id } },
      select: { id: true, nom: true },
    }),
  ]);

  return {
    id: misAJour.id,
    code: misAJour.code,
    nom: misAJour.nom,
    actif: misAJour.actif,
    dateCreation: misAJour.dateCreation,
    nbClesActives,
    nbMarchands,
    prestataire,
  };
}

async function compterClesActives(plateformeId: string, environnement?: EnvironnementApi): Promise<number> {
  return prisma.cleApiPlateforme.count({
    where: {
      plateformeId,
      ...(environnement ? { environnement } : {}),
      revoqueeLe: null,
      OR: [{ expireLe: null }, { expireLe: { gt: new Date() } }],
    },
  });
}

export interface CleCreee {
  /**
   * Valeur complète de la clé. Elle n'existe QUE dans cette réponse : seul son
   * hash part en base, exactement comme un jeton de réinitialisation.
   */
  cleComplete: string;
  cle: CleResume;
}

export async function creerCleApi(
  plateformeId: string,
  options: {
    environnement: EnvironnementApi;
    scopes: unknown;
    libelle?: string | null;
    quotaParMinute?: number;
  }
): Promise<CleCreee> {
  const plateforme = await prisma.plateformePartenaire.findUnique({ where: { id: plateformeId } });
  if (!plateforme) throw new ApiError(404, 'Plateforme introuvable');

  const scopes = assainirScopes(options.scopes);
  if (scopes.length === 0) {
    throw new ApiError(400, 'Une clé sans aucun scope ne pourrait rien faire : en choisir au moins un');
  }

  // Ce qu'une clé de BAC À SABLE ne peut pas recevoir (§ SCOPES_INTERDITS_EN_TEST,
  // lib/plateforme-cles.ts, où le pourquoi de chaque entrée est écrit). La
  // règle est ici, à l'ÉMISSION, plutôt que dans le handler : une clé qui ne
  // détient pas le scope ne peut pas l'exercer, quoi qu'il arrive ensuite au
  // code.
  if (options.environnement === 'test') {
    const interditsEnTest = scopes.filter((s) => SCOPES_INTERDITS_EN_TEST.includes(s));
    if (interditsEnTest.length > 0) {
      throw new ApiError(
        400,
        `Ces scopes ne peuvent pas être accordés à une clé de test : ${interditsEnTest.join(', ')}`
      );
    }
  }

  // Cohérence entre la NATURE du compte et ce que sa clé peut faire, dans les
  // deux sens. Même raisonnement que la règle ci-dessus : refuser à
  // l'émission, parce qu'une clé qui ne détient pas le scope ne peut pas
  // l'exercer, quoi qu'il arrive ensuite au code.
  //
  // Le sens qui compte vraiment est le premier : `livraisons:statut` permet de
  // FERMER un colis, donc de le rendre facturable. Accordé à un compte sans
  // transporteur, il n'aurait de toute façon aucun périmètre
  // (prestataireDeLaCle, lib/livraison-statut.ts) — mais le refuser ici évite
  // d'émettre une clé qui répondrait 403 à chaque appel sans que personne ne
  // comprenne pourquoi.
  const estTransporteur = plateforme.prestataireId !== null;
  const interdits = estTransporteur
    ? scopes.filter((s) => SCOPES_VENTE.includes(s))
    : scopes.filter((s) => SCOPES_TRANSPORTEUR.includes(s));
  if (interdits.length > 0) {
    throw new ApiError(
      400,
      estTransporteur
        ? `Un compte de transporteur ne peut pas recevoir ces scopes : ${interdits.join(', ')}`
        : `Ces scopes sont réservés aux comptes rattachés à un transporteur : ${interdits.join(', ')}`
    );
  }

  const actives = await compterClesActives(plateformeId, options.environnement);
  if (actives >= MAX_CLES_ACTIVES) {
    throw new ApiError(
      409,
      `Cette plateforme a déjà ${MAX_CLES_ACTIVES} clés ${options.environnement} actives. ` +
        'Expirer ou révoquer la plus ancienne avant d’en émettre une nouvelle.'
    );
  }

  const quotaParMinute =
    Number.isInteger(options.quotaParMinute) && (options.quotaParMinute as number) > 0
      ? (options.quotaParMinute as number)
      : undefined;

  const { cleComplete, prefixe, secretHash } = genererCle(options.environnement);

  const creee = await prisma.cleApiPlateforme.create({
    data: {
      plateformeId,
      prefixe,
      secretHash,
      environnement: options.environnement,
      scopes,
      libelle: options.libelle?.trim() || null,
      ...(quotaParMinute !== undefined ? { quotaParMinute } : {}),
    },
  });

  return {
    cleComplete,
    cle: {
      id: creee.id,
      prefixe: creee.prefixe,
      environnement: creee.environnement,
      scopes: creee.scopes,
      libelle: creee.libelle,
      quotaParMinute: creee.quotaParMinute,
      creeeLe: creee.creeeLe,
      expireLe: creee.expireLe,
      revoqueeLe: creee.revoqueeLe,
      derniereUtilisationLe: creee.derniereUtilisationLe,
      nbAppels: creee.nbAppels,
      active: true,
    },
  };
}

// --- Données de bac à sable -------------------------------------------------
//
// L'isolation retenue (§ prisma/schema.prisma) est LOGIQUE : les marchands et
// les colis d'une clé `test` sont de vraies lignes dans les vraies tables. Une
// clé de test ne peut pas ATTEINDRE la production — c'est structurel — mais ce
// qu'elle crée y réside. C'est le prix assumé de n'avoir qu'une base.
//
// Les deux fonctions ci-dessous sont la contrepartie de ce choix : rendre ces
// données COMPTABLES et EFFAÇABLES. Une pollution qu'on mesure et qu'on peut
// supprimer d'un geste n'est plus une dette, c'est un état transitoire.

export interface VolumeTest {
  /** Marchands que la purge supprimera. */
  marchands: number;
  /** Colis que la purge supprimera — ceux des marchands ci-dessus. */
  colis: number;
  /**
   * Marchands liés en `test` que la purge NE supprimera PAS : rattachés
   * (ils existaient déjà chez nous) ou également liés ailleurs.
   */
  marchandsConserves: number;
  /**
   * LIMITE CONNUE. Colis appartenant aux marchands conservés, qui survivront
   * donc à la purge.
   *
   * `commandes` ne porte aucune marque d'environnement — c'est le choix qui
   * évite une colonne sur la table la plus chaude du schéma — si bien qu'on ne
   * sait pas distinguer, chez un marchand qui est AUSSI un vrai client, un
   * colis déposé par la clé de test d'une commande réelle. Les supprimer
   * « au cas où » effacerait de vraies commandes ; on préfère les laisser et
   * le dire.
   *
   * Le cas est rare et évitable : il suppose qu'une plateforme ait revendiqué,
   * pendant ses essais, un marchand déjà inscrit chez nous en direct. D'où la
   * consigne de n'utiliser que des coordonnées fictives en test.
   */
  colisConserves: number;
}

// Marchands qu'une purge a le droit d'effacer : créés par la synchronisation
// ET rattachés à rien d'autre. Les deux conditions comptent — un marchand créé
// en test puis lié aussi en `live` (même personne, deux espaces de noms) doit
// survivre, sans quoi la purge casserait l'intégration de production.
async function marchandsTestSupprimables(plateformeId: string): Promise<string[]> {
  const liens = await prisma.compteMarchandExterne.findMany({
    where: { plateformeId, environnement: 'test', creeParSynchro: true },
    select: { marchandId: true },
  });
  if (liens.length === 0) return [];

  const ids = liens.map((l) => l.marchandId);
  const autresLiens = await prisma.compteMarchandExterne.findMany({
    where: { marchandId: { in: ids }, NOT: { plateformeId, environnement: 'test' } },
    select: { marchandId: true },
  });
  const aConserver = new Set(autresLiens.map((l) => l.marchandId));

  return ids.filter((id) => !aConserver.has(id));
}

export async function compterDonneesTest(plateformeId: string): Promise<VolumeTest> {
  const [liens, supprimables] = await Promise.all([
    prisma.compteMarchandExterne.findMany({
      where: { plateformeId, environnement: 'test' },
      select: { marchandId: true },
    }),
    marchandsTestSupprimables(plateformeId),
  ]);

  const aSupprimer = new Set(supprimables);
  const conserves = liens.map((l) => l.marchandId).filter((id) => !aSupprimer.has(id));

  const [colis, colisConserves] = await Promise.all([
    supprimables.length === 0
      ? Promise.resolve(0)
      : prisma.commande.count({ where: { marchandId: { in: supprimables } } }),
    conserves.length === 0
      ? Promise.resolve(0)
      : prisma.commande.count({ where: { marchandId: { in: conserves } } }),
  ]);

  return {
    marchands: supprimables.length,
    colis,
    marchandsConserves: conserves.length,
    colisConserves,
  };
}

// Supprime les données de bac à sable d'une plateforme. Ne touche JAMAIS à
// `live` : ni les liens, ni les marchands, ni les colis.
//
// L'ordre suit les dépendances — l'historique et les commentaires avant les
// colis, les colis avant les marchands, les marchands avant leurs comptes.
// `onDelete: Cascade` couvre les tables du chantier, pas `commandes`, qui n'a
// justement aucun lien vers les plateformes.
export async function purgerDonneesTest(plateformeId: string): Promise<VolumeTest> {
  const plateforme = await prisma.plateformePartenaire.findUnique({ where: { id: plateformeId } });
  if (!plateforme) throw new ApiError(404, 'Plateforme introuvable');

  const volume = await compterDonneesTest(plateformeId);
  const supprimables = await marchandsTestSupprimables(plateformeId);

  await prisma.$transaction(async (tx) => {
    if (supprimables.length > 0) {
      const commandes = await tx.commande.findMany({
        where: { marchandId: { in: supprimables } },
        select: { id: true },
      });
      const ids = commandes.map((c) => c.id);
      if (ids.length > 0) {
        await tx.historiqueStatutCommande.deleteMany({ where: { commandeId: { in: ids } } });
        await tx.commentaireCommande.deleteMany({ where: { commandeId: { in: ids } } });
        await tx.commande.deleteMany({ where: { id: { in: ids } } });
      }
    }

    // Tous les liens `test` de cette plateforme partent, y compris ceux des
    // marchands conservés : le lien est une donnée de test, même quand le
    // marchand qu'il désigne n'en est pas une.
    await tx.compteMarchandExterne.deleteMany({ where: { plateformeId, environnement: 'test' } });

    if (supprimables.length > 0) {
      const marchands = await tx.marchand.findMany({
        where: { id: { in: supprimables } },
        select: { utilisateurId: true },
      });
      await tx.marchand.deleteMany({ where: { id: { in: supprimables } } });
      await tx.utilisateur.deleteMany({
        where: { id: { in: marchands.map((m) => m.utilisateurId) } },
      });
    }
  });

  return volume;
}

// Révocation : refus DUR et immédiat. La ligne n'est jamais supprimée —
// `derniereUtilisationLe` et `nbAppels` restent exploitables pour savoir, après
// coup, quand une clé fuitée a servi et combien de fois.
// --- Purge du journal des appels -------------------------------------------
//
// `JournalAppelApi` grossit d'une ligne par appel REÇU, sur toutes les
// intégrations à la fois. À 600 appels/minute et par clé — le quota par
// défaut — la table dépasse le million de lignes en une journée soutenue.
//
// Elle ne porte aucune donnée personnelle : le corps rejeté n'est
// volontairement pas conservé (cf. le commentaire du modèle), seuls le
// chemin, le statut, la durée, l'IP et une référence de colis y figurent. Le
// problème est donc de VOLUME, pas de confidentialité — et il se règle par une
// fenêtre glissante plutôt que par une anonymisation.
//
// Trente jours par défaut : le journal sert au diagnostic à chaud (« vos colis
// ne passent pas », « où est passé le colis X »), pas à l'archivage. Au-delà,
// personne ne l'a jamais relu, et les compteurs qui survivent à une révocation
// — `derniereUtilisationLe`, `nbAppels` sur la clé — portent seuls ce qui est
// utile en analyse post-incident.
export interface PurgeJournal {
  joursConserves: number;
  supprimes: number;
  restants: number;
  plusAncienRestant: Date | null;
}

export async function purgerJournalAppels(
  joursConserves = 30,
  simuler = false
): Promise<PurgeJournal> {
  if (!Number.isInteger(joursConserves) || joursConserves < 1) {
    throw new ApiError(400, 'Le nombre de jours à conserver doit être un entier positif');
  }

  const limite = new Date(Date.now() - joursConserves * 24 * 60 * 60 * 1000);

  // En simulation on COMPTE au lieu de supprimer : une purge est
  // irréversible, et pouvoir la chiffrer avant de la lancer est la seule
  // façon de distinguer « rien à supprimer » de « je vise la mauvaise
  // fenêtre ».
  const supprimes = simuler
    ? await prisma.journalAppelApi.count({ where: { horodatage: { lt: limite } } })
    : (await prisma.journalAppelApi.deleteMany({ where: { horodatage: { lt: limite } } })).count;

  const [restants, plusAncien] = await Promise.all([
    prisma.journalAppelApi.count(simuler ? { where: { horodatage: { gte: limite } } } : undefined),
    prisma.journalAppelApi.findFirst({
      where: simuler ? { horodatage: { gte: limite } } : undefined,
      orderBy: { horodatage: 'asc' },
      select: { horodatage: true },
    }),
  ]);

  return {
    joursConserves,
    supprimes,
    restants,
    plusAncienRestant: plusAncien?.horodatage ?? null,
  };
}

export async function revoquerCleApi(plateformeId: string, cleId: string): Promise<CleResume> {
  const cle = await prisma.cleApiPlateforme.findUnique({ where: { id: cleId } });
  if (!cle || cle.plateformeId !== plateformeId) throw new ApiError(404, 'Clé introuvable');
  if (cle.revoqueeLe) throw new ApiError(409, 'Cette clé est déjà révoquée');

  const misAJour = await prisma.cleApiPlateforme.update({
    where: { id: cleId },
    data: { revoqueeLe: new Date() },
  });

  return {
    id: misAJour.id,
    prefixe: misAJour.prefixe,
    environnement: misAJour.environnement,
    scopes: misAJour.scopes,
    libelle: misAJour.libelle,
    quotaParMinute: misAJour.quotaParMinute,
    creeeLe: misAJour.creeeLe,
    expireLe: misAJour.expireLe,
    revoqueeLe: misAJour.revoqueeLe,
    derniereUtilisationLe: misAJour.derniereUtilisationLe,
    nbAppels: misAJour.nbAppels,
    active: false,
  };
}

// Expiration programmée : refus DOUX à l'échéance, précédé d'un en-tête de
// dépréciation sur chaque appel de la fenêtre de grâce. C'est la moitié
// « ancienne clé » d'une rotation.
export async function programmerExpiration(
  plateformeId: string,
  cleId: string,
  expireLe: Date
): Promise<CleResume> {
  const cle = await prisma.cleApiPlateforme.findUnique({ where: { id: cleId } });
  if (!cle || cle.plateformeId !== plateformeId) throw new ApiError(404, 'Clé introuvable');
  if (cle.revoqueeLe) throw new ApiError(409, 'Cette clé est révoquée : son expiration n’a plus d’objet');

  const misAJour = await prisma.cleApiPlateforme.update({
    where: { id: cleId },
    data: { expireLe },
  });

  return {
    id: misAJour.id,
    prefixe: misAJour.prefixe,
    environnement: misAJour.environnement,
    scopes: misAJour.scopes,
    libelle: misAJour.libelle,
    quotaParMinute: misAJour.quotaParMinute,
    creeeLe: misAJour.creeeLe,
    expireLe: misAJour.expireLe,
    revoqueeLe: misAJour.revoqueeLe,
    derniereUtilisationLe: misAJour.derniereUtilisationLe,
    nbAppels: misAJour.nbAppels,
    active: cleEstActive(misAJour),
  };
}
