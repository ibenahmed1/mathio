import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { Prisma } from '@/app/generated/prisma/client';
import type {
  ActionHistoriqueComptable,
  CibleHistoriqueComptable,
  PorteeCategorieComptable,
  TypeTransaction,
} from '@/app/generated/prisma/enums';
import {
  LABELS_PORTEE_CATEGORIE,
  LONGUEUR_MAX_NOM_CATEGORIE,
  normaliserNomCategorie,
  type CodeCategorieSysteme,
  type ModificationTransaction,
} from '@/lib/finance';
import type { ModificationCommandeStockHub } from '@/lib/commandes-stock-hub';

// Manipulation des pièces comptables depuis /admin/comptabilite : modifier,
// supprimer (logiquement), restaurer, gérer les catégories — et tracer chacun
// de ces gestes dans HistoriqueComptable (§ prisma/schema.prisma).
//
// Tout se fait dans une transaction interactive : la lecture de l'état, la
// décision, l'écriture ET la trace. Une trace écrite hors de la transaction
// pourrait survivre à une modification annulée, ou manquer à une
// modification réussie — un historique qui ment est pire que pas d'historique.

type Db = Prisma.TransactionClient;

// Valeur d'un champ dans un instantané d'historique : jamais d'objet, jamais
// de Decimal, jamais de Date — ce qui est écrit en JSON doit se relire tel
// quel, sans connaître le modèle.
type ValeurInstantane = string | number | boolean | null;
export type Instantane = Record<string, ValeurInstantane>;

// ------------------------------------------------------------
// Règles pures (testées dans lib/__tests__/journal-comptable.test.ts)
// ------------------------------------------------------------

/** Les seuls champs qui diffèrent entre deux instantanés, de part et
 *  d'autre. `null` quand rien n'a changé : l'appelant n'écrit alors ni la
 *  modification ni sa trace — un PATCH qui renvoie les mêmes valeurs ne doit
 *  pas remplir l'historique de lignes vides. */
export function champsModifies(
  avant: Instantane,
  apres: Instantane
): { avant: Instantane; apres: Instantane } | null {
  const a: Instantane = {};
  const b: Instantane = {};
  for (const cle of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
    const va = avant[cle] ?? null;
    const vb = apres[cle] ?? null;
    if (va !== vb) {
      a[cle] = va;
      b[cle] = vb;
    }
  }
  return Object.keys(a).length ? { avant: a, apres: b } : null;
}

/** État du justificatif tel que l'historique le note : sa présence, jamais
 *  son contenu. « remplacé » existe parce qu'une photo changée pour une autre
 *  laisserait sinon « joint → joint », une modification invisible. */
export function etatPreuveApres(avaitPreuve: boolean, nouvelle: string | null | undefined): string {
  if (nouvelle === undefined) return avaitPreuve ? 'joint' : 'aucun';
  if (nouvelle === null) return 'aucun';
  return avaitPreuve ? 'remplacé' : 'joint';
}

/** Une compensation (écriture d'annulation) suit son écriture d'origine :
 *  même montant, sens inverse. La modifier seule casserait la neutralisation
 *  qui est sa raison d'être — c'est l'origine qu'on modifie, la compensation
 *  suit (cf. modifierTransaction). */
export function refusModificationCompensation(
  estCompensation: boolean,
  actuel: { montant: number; type: TypeTransaction },
  champs: Pick<ModificationTransaction, 'montant' | 'type'>
): string | null {
  if (!estCompensation) return null;
  const montantChange = champs.montant !== undefined && champs.montant !== actuel.montant;
  const typeChange = champs.type !== undefined && champs.type !== actuel.type;
  if (montantChange || typeChange) {
    return "Le montant et le sens d'une neutralisation suivent l'écriture qu'elle neutralise : modifiez plutôt celle-ci";
  }
  return null;
}

// Ce que la suppression ou la restauration d'une écriture doit toucher, selon
// sa place dans un couple annulation/compensation.
export interface EtatCouple {
  id: string;
  supprimeLe: Date | null;
  // L'écriture est une compensation : son origine.
  origine: { id: string; supprimeLe: Date | null } | null;
  // L'écriture a été annulée : sa compensation.
  compensation: { id: string; supprimeLe: Date | null } | null;
}

/** Supprimer une écriture annulée supprime AUSSI sa compensation, au même
 *  instant : laissée seule, la compensation ferait apparaître dans les totaux
 *  un mouvement inverse d'une écriture qui n'y est plus. Supprimer une
 *  compensation seule, en revanche, n'emporte pas l'origine — c'est défaire
 *  l'annulation, et l'origine redevient une écriture ordinaire. */
export function idsASupprimer(e: EtatCouple): string[] {
  const ids = [e.id];
  if (e.compensation && !e.compensation.supprimeLe) ids.push(e.compensation.id);
  return ids;
}

/** Restaurer une écriture restaure la compensation supprimée AVEC elle (même
 *  horodatage), pas une compensation supprimée à part avant — celle-là avait
 *  été retirée pour elle-même. Une compensation ne se restaure pas sans son
 *  origine : elle neutraliserait une écriture absente du journal. */
export function idsARestaurer(e: EtatCouple): { statut: 'ok'; ids: string[] } | { statut: 'refus'; message: string } {
  if (!e.supprimeLe) return { statut: 'refus', message: "Cette pièce n'est pas supprimée" };
  if (e.origine?.supprimeLe) {
    return { statut: 'refus', message: "Restaurez d'abord l'écriture que cette neutralisation vise" };
  }
  const ids = [e.id];
  if (e.compensation?.supprimeLe && e.compensation.supprimeLe.getTime() === e.supprimeLe.getTime()) {
    ids.push(e.compensation.id);
  }
  return { statut: 'ok', ids };
}

// ------------------------------------------------------------
// Historique
// ------------------------------------------------------------

async function tracer(
  db: Db,
  cibleType: CibleHistoriqueComptable,
  cibleId: string,
  action: ActionHistoriqueComptable,
  auteurId: string,
  avant: Instantane | null,
  apres: Instantane | null
): Promise<void> {
  await db.historiqueComptable.create({
    data: {
      cibleType,
      cibleId,
      action,
      auteurId,
      // Clé omise plutôt que `null` : un Json nullable Prisma exige
      // `Prisma.DbNull` pour écrire NULL, et l'absence donne le même résultat.
      ...(avant ? { avant } : {}),
      ...(apres ? { apres } : {}),
    },
  });
}

export interface LigneHistoriqueComptable {
  id: string;
  action: ActionHistoriqueComptable;
  avant: Instantane | null;
  apres: Instantane | null;
  auteur: string;
  dateAction: string;
}

export async function historiqueComptable(
  cibleType: CibleHistoriqueComptable,
  cibleId: string
): Promise<LigneHistoriqueComptable[]> {
  const lignes = await prisma.historiqueComptable.findMany({
    where: { cibleType, cibleId },
    orderBy: { dateAction: 'desc' },
    include: { auteur: { select: { nomComplet: true } } },
  });
  return lignes.map((l) => ({
    id: l.id,
    action: l.action,
    avant: (l.avant as Instantane | null) ?? null,
    apres: (l.apres as Instantane | null) ?? null,
    auteur: l.auteur.nomComplet,
    dateAction: l.dateAction.toISOString(),
  }));
}

// ------------------------------------------------------------
// Catégories
// ------------------------------------------------------------

export interface CategorieExposee {
  id: string;
  nom: string;
  portee: PorteeCategorieComptable;
  // Référencée par le code (écritures automatiques) : renommable, pas
  // supprimable. Cf. CODES_CATEGORIE_SYSTEME.
  protegee: boolean;
  // Pièces qui la portent, SUPPRIMÉES COMPRISES : la clé étrangère les
  // compte, et c'est elle qui refuserait la suppression.
  nbUtilisations: number;
}

const SELECT_CATEGORIE = {
  id: true,
  nom: true,
  portee: true,
  code: true,
  _count: { select: { transactions: true, commandesStockHub: true } },
} as const;

type CategorieLue = Prisma.CategorieComptableGetPayload<{ select: typeof SELECT_CATEGORIE }>;

function exposerCategorie(c: CategorieLue): CategorieExposee {
  return {
    id: c.id,
    nom: c.nom,
    portee: c.portee,
    protegee: c.code !== null,
    nbUtilisations: c._count.transactions + c._count.commandesStockHub,
  };
}

export async function listerCategories(portee?: PorteeCategorieComptable): Promise<CategorieExposee[]> {
  const categories = await prisma.categorieComptable.findMany({
    where: portee ? { portee } : undefined,
    orderBy: [{ portee: 'asc' }, { nom: 'asc' }],
    select: SELECT_CATEGORIE,
  });
  return categories.map(exposerCategorie);
}

function validerNomCategorie(brut: unknown): string {
  const nom = normaliserNomCategorie(brut);
  if (!nom) throw new ApiError(400, 'Le nom de la catégorie est requis');
  if (nom.length > LONGUEUR_MAX_NOM_CATEGORIE) {
    throw new ApiError(400, `Le nom ne peut pas dépasser ${LONGUEUR_MAX_NOM_CATEGORIE} caractères`);
  }
  return nom;
}

// L'index unique (portee, nom) est sensible à la casse : c'est ici que
// « salaire » et « Salaire » deviennent un doublon.
async function refuserDoublon(db: Db, portee: PorteeCategorieComptable, nom: string, saufId?: string): Promise<void> {
  const doublon = await db.categorieComptable.findFirst({
    where: { portee, nom: { equals: nom, mode: 'insensitive' }, ...(saufId ? { NOT: { id: saufId } } : {}) },
    select: { id: true },
  });
  if (doublon) {
    throw new ApiError(409, `La catégorie « ${nom} » existe déjà pour les ${LABELS_PORTEE_CATEGORIE[portee].toLowerCase()}`);
  }
}

function traduireConflitCategorie(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ApiError(409, 'Cette catégorie existe déjà');
  }
  throw error;
}

export async function creerCategorie(
  nomBrut: unknown,
  portee: PorteeCategorieComptable,
  auteurId: string
): Promise<CategorieExposee> {
  const nom = validerNomCategorie(nomBrut);
  try {
    return await prisma.$transaction(async (tx) => {
      await refuserDoublon(tx, portee, nom);
      const creee = await tx.categorieComptable.create({ data: { nom, portee }, select: SELECT_CATEGORIE });
      await tracer(tx, 'categorie', creee.id, 'creation', auteurId, null, { nom, portee });
      return exposerCategorie(creee);
    });
  } catch (error) {
    traduireConflitCategorie(error);
  }
}

export async function renommerCategorie(id: string, nomBrut: unknown, auteurId: string): Promise<CategorieExposee> {
  const nom = validerNomCategorie(nomBrut);
  try {
    return await prisma.$transaction(async (tx) => {
      const actuelle = await tx.categorieComptable.findUnique({ where: { id }, select: SELECT_CATEGORIE });
      if (!actuelle) throw new ApiError(404, 'Catégorie introuvable');
      if (actuelle.nom === nom) return exposerCategorie(actuelle);
      await refuserDoublon(tx, actuelle.portee, nom, id);
      // Le renommage vaut pour toutes les pièces qui la portent, passées
      // comprises : elles pointent l'identifiant, pas le libellé.
      const renommee = await tx.categorieComptable.update({ where: { id }, data: { nom }, select: SELECT_CATEGORIE });
      await tracer(tx, 'categorie', id, 'modification', auteurId, { nom: actuelle.nom }, { nom });
      return exposerCategorie(renommee);
    });
  } catch (error) {
    traduireConflitCategorie(error);
  }
}

export async function supprimerCategorie(id: string, auteurId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const actuelle = await tx.categorieComptable.findUnique({ where: { id }, select: SELECT_CATEGORIE });
    if (!actuelle) throw new ApiError(404, 'Catégorie introuvable');
    if (actuelle.code !== null) {
      throw new ApiError(
        409,
        `« ${actuelle.nom} » reçoit les écritures automatiques (tournées, factures, paie) : elle peut être renommée, pas supprimée`
      );
    }
    const { nbUtilisations } = exposerCategorie(actuelle);
    // Refus plutôt que réaffectation silencieuse : choisir la catégorie de
    // remplacement est une décision comptable, pas un effet de bord.
    if (nbUtilisations > 0) {
      throw new ApiError(
        409,
        `« ${actuelle.nom} » est portée par ${nbUtilisations} pièce(s), supprimées comprises : changez-leur de catégorie d'abord`
      );
    }
    await tx.categorieComptable.delete({ where: { id } });
    await tracer(tx, 'categorie', id, 'suppression', auteurId, { nom: actuelle.nom, portee: actuelle.portee }, null);
  });
}

/** Identifiant d'une catégorie référencée par le code (écritures
 *  automatiques). Son absence est une anomalie de déploiement — la migration
 *  les crée, et elles ne se suppriment pas — d'où une erreur franche plutôt
 *  qu'une écriture rangée n'importe où. */
export async function idCategorieSysteme(db: Db, code: CodeCategorieSysteme): Promise<string> {
  const categorie = await db.categorieComptable.findUnique({ where: { code }, select: { id: true } });
  if (!categorie) {
    throw new ApiError(500, `Catégorie comptable « ${code} » absente : la migration des catégories n'a pas été appliquée`);
  }
  return categorie.id;
}

/** Une catégorie choisie par l'utilisateur doit exister ET appartenir à la
 *  bonne carte — un identifiant de catégorie « commande » posé sur une
 *  écriture passerait la clé étrangère sans broncher. */
export async function verifierCategorie(
  db: Db | typeof prisma,
  id: string,
  portee: PorteeCategorieComptable
): Promise<{ id: string; nom: string }> {
  const categorie = await db.categorieComptable.findUnique({ where: { id }, select: { id: true, nom: true, portee: true } });
  if (!categorie || categorie.portee !== portee) throw new ApiError(400, 'Catégorie invalide');
  return { id: categorie.id, nom: categorie.nom };
}

// ------------------------------------------------------------
// Transactions
// ------------------------------------------------------------

const INCLUDE_ETAT_TRANSACTION = {
  categorie: { select: { nom: true } },
  annulation: { select: { id: true, supprimeLe: true } },
  transactionOrigine: { select: { id: true, supprimeLe: true } },
} as const;

async function lireTransaction(db: Db, id: string) {
  // `omit` du justificatif : on n'a besoin que de savoir s'il existe, ce que
  // la requête suivante dit sans rapatrier le base64 (§ Transaction.preuveUrl).
  const t = await db.transaction.findUnique({
    where: { id },
    omit: { preuveUrl: true },
    include: INCLUDE_ETAT_TRANSACTION,
  });
  if (!t) throw new ApiError(404, 'Transaction introuvable');
  const aPreuve = (await db.transaction.count({ where: { id, preuveUrl: { not: null } } })) > 0;
  return { ...t, aPreuve };
}

type TransactionLue = Awaited<ReturnType<typeof lireTransaction>>;

function instantaneTransaction(t: TransactionLue): Instantane {
  return {
    titre: t.titre,
    montant: Number(t.montant),
    type: t.type,
    categorie: t.categorie.nom,
    dateEffet: t.dateEffet.toISOString(),
    description: t.description,
    preuve: t.aPreuve ? 'joint' : 'aucun',
  };
}

function etatCouple(t: TransactionLue): EtatCouple {
  return { id: t.id, supprimeLe: t.supprimeLe, origine: t.transactionOrigine, compensation: t.annulation };
}

const TYPE_INVERSE: Record<TypeTransaction, TypeTransaction> = { revenu: 'depense', depense: 'revenu' };

// Invariant tenu après chaque suppression / restauration : une écriture est
// « annulée » tant que sa compensation est dans le journal, et seulement
// alors. Recalculé plutôt que déduit du geste, pour qu'aucun enchaînement de
// suppressions et de restaurations ne le désaccorde.
async function recalculerEstAnnulee(db: Db, origineId: string): Promise<void> {
  const compensation = await db.transaction.findUnique({
    where: { transactionOrigineId: origineId },
    select: { supprimeLe: true },
  });
  await db.transaction.update({
    where: { id: origineId },
    data: { estAnnulee: !!compensation && compensation.supprimeLe === null },
  });
}

export async function modifierTransaction(id: string, champs: ModificationTransaction, auteurId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await lireTransaction(tx, id);
    if (t.supprimeLe) throw new ApiError(409, 'Écriture supprimée : restaurez-la avant de la modifier');

    const refus = refusModificationCompensation(
      !!t.transactionOrigineId,
      { montant: Number(t.montant), type: t.type },
      champs
    );
    if (refus) throw new ApiError(409, refus);

    let nomCategorie = t.categorie.nom;
    if (champs.categorieId !== undefined && champs.categorieId !== t.categorieId) {
      nomCategorie = (await verifierCategorie(tx, champs.categorieId, 'transaction')).nom;
    }

    const avant = instantaneTransaction(t);
    const apres: Instantane = {
      titre: champs.titre ?? t.titre,
      montant: champs.montant ?? Number(t.montant),
      type: champs.type ?? t.type,
      categorie: nomCategorie,
      dateEffet: (champs.dateEffet ?? t.dateEffet).toISOString(),
      description: champs.description !== undefined ? champs.description : t.description,
      preuve: etatPreuveApres(t.aPreuve, champs.preuveUrl),
    };
    const diff = champsModifies(avant, apres);
    if (!diff) return;

    await tx.transaction.update({
      where: { id },
      data: {
        titre: champs.titre,
        montant: champs.montant,
        type: champs.type,
        categorieId: champs.categorieId,
        dateEffet: champs.dateEffet,
        description: champs.description,
        preuveUrl: champs.preuveUrl,
      },
      select: { id: true },
    });
    await tracer(tx, 'transaction', id, 'modification', auteurId, diff.avant, diff.apres);

    // L'écriture a été annulée : sa compensation suit le nouveau montant et
    // le nouveau sens, sans quoi l'annulation ne neutraliserait plus rien.
    // Elle reçoit sa propre trace — c'est une ligne du journal qui change.
    if (t.annulation && ('montant' in diff.apres || 'type' in diff.apres)) {
      const compensation = await lireTransaction(tx, t.annulation.id);
      const nouveauType = TYPE_INVERSE[(champs.type ?? t.type) as TypeTransaction];
      const nouveauMontant = champs.montant ?? Number(t.montant);
      const diffCompensation = champsModifies(
        { montant: Number(compensation.montant), type: compensation.type },
        { montant: nouveauMontant, type: nouveauType }
      );
      if (diffCompensation) {
        await tx.transaction.update({
          where: { id: compensation.id },
          data: { montant: nouveauMontant, type: nouveauType },
          select: { id: true },
        });
        await tracer(tx, 'transaction', compensation.id, 'modification', auteurId, diffCompensation.avant, diffCompensation.apres);
      }
    }
  });
}

export async function supprimerTransaction(id: string, auteurId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await lireTransaction(tx, id);
    if (t.supprimeLe) throw new ApiError(409, 'Cette écriture est déjà supprimée');

    const ids = idsASupprimer(etatCouple(t));
    // Un seul horodatage pour tout le lot : c'est l'égalité des `supprimeLe`
    // qui permettra de restaurer l'écriture et sa compensation ensemble.
    const maintenant = new Date();
    for (const cibleId of ids) {
      const cible = cibleId === t.id ? t : await lireTransaction(tx, cibleId);
      await tx.transaction.update({
        where: { id: cibleId },
        data: { supprimeLe: maintenant, supprimeParId: auteurId },
        select: { id: true },
      });
      await tracer(tx, 'transaction', cibleId, 'suppression', auteurId, instantaneTransaction(cible), null);
    }

    // Supprimer une compensation seule défait l'annulation de son origine.
    if (t.transactionOrigine) await recalculerEstAnnulee(tx, t.transactionOrigine.id);
  });
}

export async function restaurerTransaction(id: string, auteurId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await lireTransaction(tx, id);
    const plan = idsARestaurer(etatCouple(t));
    if (plan.statut === 'refus') throw new ApiError(409, plan.message);

    for (const cibleId of plan.ids) {
      const cible = cibleId === t.id ? t : await lireTransaction(tx, cibleId);
      await tx.transaction.update({
        where: { id: cibleId },
        data: { supprimeLe: null, supprimeParId: null },
        select: { id: true },
      });
      await tracer(tx, 'transaction', cibleId, 'restauration', auteurId, null, instantaneTransaction(cible));
    }

    await recalculerEstAnnulee(tx, t.transactionOrigine ? t.transactionOrigine.id : t.id);
  });
}

// ------------------------------------------------------------
// Commandes d'inventaire
// ------------------------------------------------------------

async function lireCommande(db: Db, id: string) {
  const c = await db.commandeStockHub.findUnique({
    where: { id },
    omit: { preuveUrl: true },
    include: { categorie: { select: { nom: true } } },
  });
  if (!c) throw new ApiError(404, 'Commande introuvable');
  const aPreuve = (await db.commandeStockHub.count({ where: { id, preuveUrl: { not: null } } })) > 0;
  return { ...c, aPreuve };
}

type CommandeLue = Awaited<ReturnType<typeof lireCommande>>;

function instantaneCommande(c: CommandeLue): Instantane {
  return {
    titre: c.titre,
    sousTitre: c.sousTitre,
    montant: Number(c.montant),
    modePaiement: c.modePaiement,
    dateCommande: c.dateCommande.toISOString(),
    categorie: c.categorie?.nom ?? null,
    statut: c.statut,
    preuve: c.aPreuve ? 'joint' : 'aucun',
  };
}

export async function modifierCommandeStockHub(
  id: string,
  champs: ModificationCommandeStockHub,
  auteurId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const c = await lireCommande(tx, id);
    if (c.supprimeLe) throw new ApiError(409, 'Commande supprimée : restaurez-la avant de la modifier');

    let nomCategorie = c.categorie?.nom ?? null;
    if (champs.categorieId !== undefined && champs.categorieId !== c.categorieId) {
      nomCategorie = champs.categorieId
        ? (await verifierCategorie(tx, champs.categorieId, 'commande_stock_hub')).nom
        : null;
    }

    const avant = instantaneCommande(c);
    const apres: Instantane = {
      ...avant,
      titre: champs.titre ?? c.titre,
      sousTitre: champs.sousTitre !== undefined ? champs.sousTitre : c.sousTitre,
      montant: champs.montant ?? Number(c.montant),
      modePaiement: champs.modePaiement ?? c.modePaiement,
      dateCommande: (champs.dateCommande ?? c.dateCommande).toISOString(),
      categorie: nomCategorie,
      preuve: etatPreuveApres(c.aPreuve, champs.preuveUrl),
    };
    const diff = champsModifies(avant, apres);
    if (!diff) return;

    await tx.commandeStockHub.update({
      where: { id },
      data: {
        titre: champs.titre,
        sousTitre: champs.sousTitre,
        montant: champs.montant,
        modePaiement: champs.modePaiement,
        dateCommande: champs.dateCommande,
        categorieId: champs.categorieId,
        preuveUrl: champs.preuveUrl,
      },
      select: { id: true },
    });
    await tracer(tx, 'commande_stock_hub', id, 'modification', auteurId, diff.avant, diff.apres);
  });
}

export async function supprimerCommandeStockHub(id: string, auteurId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const c = await lireCommande(tx, id);
    if (c.supprimeLe) throw new ApiError(409, 'Cette commande est déjà supprimée');
    await tx.commandeStockHub.update({
      where: { id },
      data: { supprimeLe: new Date(), supprimeParId: auteurId },
      select: { id: true },
    });
    await tracer(tx, 'commande_stock_hub', id, 'suppression', auteurId, instantaneCommande(c), null);
  });
}

export async function restaurerCommandeStockHub(id: string, auteurId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const c = await lireCommande(tx, id);
    if (!c.supprimeLe) throw new ApiError(409, "Cette commande n'est pas supprimée");
    await tx.commandeStockHub.update({
      where: { id },
      data: { supprimeLe: null, supprimeParId: null },
      select: { id: true },
    });
    await tracer(tx, 'commande_stock_hub', id, 'restauration', auteurId, null, instantaneCommande(c));
  });
}
