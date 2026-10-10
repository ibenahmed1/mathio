import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ErreurPlateforme, type ContextePlateforme } from '@/lib/plateforme-auth';
import { resoudreMarchand } from '@/lib/plateforme-colis';
import { genererReferenceProduit } from '@/lib/sku';
import { skuDejaPris } from '@/lib/stock-sku';

// Déclaration des produits de stock d'un marchand par une plateforme
// partenaire (§ POST /v1/produits).
//
// Même modèle que la page marchand « Ajouter Produit » (POST /api/produits) :
// un produit porte son SKU (`reference`), et en option des variantes ayant
// chacune leur SKU et leur quantité. Les SKU sont CEUX DE LA PLATEFORME — on
// n'en génère pas. Ils partagent un seul espace de noms par marchand, produit
// et variantes confondus, sans tenir compte de la casse (lib/stock-sku.ts) :
// c'est ce qui permet ensuite à POST /v1/colis de désigner une unité de stock
// par son seul SKU.
//
// La quantité déclarée est ANNONCÉE (quantiteEnCours) : elle devient du stock
// réel quand l'entrepôt la réceptionne (/admin/stock/inventaire), comme pour
// un produit saisi par le marchand lui-même.
//
// Idempotent : redéclarer un produit déjà connu de ce marchand — reconnu à
// son SKU, ou à ses variantes s'il n'en a pas — ne réécrit rien et ne rajoute
// AUCUNE quantité : un rejeu après timeout ne doit pas doubler un stock annoncé.

// Bornes : `quantite_en_cours` est un Int (4 octets) ; une photo en data URL
// au-delà de 2 Mo n'a rien à faire dans une ligne de base.
const QUANTITE_MAX = 2_147_483_647;
const PHOTO_OCTETS_MAX = 2 * 1024 * 1024;
const VARIANTES_MAX = 200;

export interface VarianteExterne {
  nom: string;
  reference: string;
  quantiteEnCours: number;
}

export interface EntreeProduitExterne {
  idExterneMarchand: string;
  nom: string;
  // null : produit à variantes déclaré sans SKU propre (cf. analyserEntreeProduit).
  reference: string | null;
  note: string | null;
  photoUrl: string | null;
  variantesActivees: boolean;
  // 0 pour un produit à variantes : le stock vit alors sur ses variantes.
  quantiteEnCours: number;
  variantes: VarianteExterne[];
}

function texte(corps: Record<string, unknown>, cle: string): string {
  return typeof corps[cle] === 'string' ? (corps[cle] as string).trim() : '';
}

function requis(corps: Record<string, unknown>, cle: string, libelle = cle): string {
  const valeur = texte(corps, cle);
  if (!valeur) throw new ErreurPlateforme(400, 'champ_requis', `Le champ « ${libelle} » est requis`);
  return valeur;
}

function quantite(valeur: unknown, libelle: string): number {
  if (valeur === undefined || valeur === null || valeur === '') {
    throw new ErreurPlateforme(400, 'champ_requis', `Le champ « ${libelle} » est requis`);
  }
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 0 || n > QUANTITE_MAX) {
    throw new ErreurPlateforme(400, 'quantite_invalide', `${libelle} doit être un entier positif ou nul`);
  }
  return n;
}

// Une URL web, ou une image embarquée (comme le formulaire marchand, qui
// envoie la photo en data URL) — rien d'autre ne s'affiche dans un <img>.
function photo(corps: Record<string, unknown>): string | null {
  const valeur = texte(corps, 'photoUrl');
  if (!valeur) return null;
  if (/^https?:\/\//i.test(valeur)) return valeur;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(valeur)) {
    if (Buffer.byteLength(valeur, 'utf8') > PHOTO_OCTETS_MAX) {
      throw new ErreurPlateforme(400, 'photo_invalide', 'photoUrl dépasse 2 Mo : préférez une URL https');
    }
    return valeur;
  }
  throw new ErreurPlateforme(400, 'photo_invalide', 'photoUrl doit être une URL https ou une image data:image/…;base64');
}

export function analyserEntreeProduit(corpsBrut: unknown): EntreeProduitExterne {
  if (typeof corpsBrut !== 'object' || corpsBrut === null || Array.isArray(corpsBrut)) {
    throw new ErreurPlateforme(400, 'corps_invalide', 'Le corps de la requête doit être un objet JSON');
  }
  const corps = corpsBrut as Record<string, unknown>;

  const idExterneMarchand = requis(corps, 'idExterneMarchand');
  const nom = requis(corps, 'nom');
  const variantesActivees = corps.variantesActivees === true;
  // Le SKU du produit n'est REQUIS que pour un produit sans variantes, dont il
  // est la seule unité de stock. Avec variantes, ce sont elles qui portent le
  // stock et que les colis désignent : le SKU du produit devient facultatif
  // (décision du 10/10/2026) — une référence interne lui est alors attribuée.
  const reference = variantesActivees ? texte(corps, 'reference') || null : requis(corps, 'reference');

  const variantes: VarianteExterne[] = [];
  if (variantesActivees) {
    if (!Array.isArray(corps.variantes) || corps.variantes.length === 0) {
      throw new ErreurPlateforme(
        400,
        'champ_requis',
        'variantesActivees vaut true : « variantes » doit contenir au moins une variante'
      );
    }
    if (corps.variantes.length > VARIANTES_MAX) {
      throw new ErreurPlateforme(400, 'variantes_trop_nombreuses', `Au plus ${VARIANTES_MAX} variantes par produit`);
    }
    // Même espace de noms que le produit : une variante ne peut porter ni le
    // SKU de son produit, ni celui d'une autre variante de la requête.
    const vues = new Set<string>(reference ? [reference.toLowerCase()] : []);
    for (const [index, brut] of corps.variantes.entries()) {
      const libelle = `variantes[${index}]`;
      if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
        throw new ErreurPlateforme(400, 'corps_invalide', `${libelle} doit être un objet`);
      }
      const v = brut as Record<string, unknown>;
      const variante = {
        nom: requis(v, 'nom', `${libelle}.nom`),
        reference: requis(v, 'reference', `${libelle}.reference`),
        quantiteEnCours: quantite(v.quantiteEnCours, `${libelle}.quantiteEnCours`),
      };
      const cle = variante.reference.toLowerCase();
      if (vues.has(cle)) {
        throw new ErreurPlateforme(400, 'sku_duplique', `SKU en double dans la requête : ${variante.reference}`);
      }
      vues.add(cle);
      variantes.push(variante);
    }
  }

  return {
    idExterneMarchand,
    nom,
    reference,
    note: texte(corps, 'note') || null,
    photoUrl: photo(corps),
    variantesActivees,
    quantiteEnCours: variantesActivees ? 0 : quantite(corps.quantiteEnCours, 'quantiteEnCours'),
    variantes,
  };
}

export type IssueProduit = 'cree' | 'deja_existant';

export interface ResultatProduit {
  issue: IssueProduit;
  reference: string;
  produitId: string;
  statutReception: string;
  variantes: { reference: string; varianteId: string }[];
}

const SELECT_RESULTAT = {
  id: true,
  reference: true,
  statutReception: true,
  variantes: { select: { id: true, reference: true }, orderBy: { reference: 'asc' } },
} as const;

function resultat(
  issue: IssueProduit,
  produit: { id: string; reference: string; statutReception: string; variantes: { id: string; reference: string }[] }
): ResultatProduit {
  return {
    issue,
    reference: produit.reference,
    produitId: produit.id,
    statutReception: produit.statutReception,
    variantes: produit.variantes.map((v) => ({ reference: v.reference, varianteId: v.id })),
  };
}

type Tx = Prisma.TransactionClient;

async function produitExistant(db: Tx, marchandId: string, reference: string) {
  return db.produit.findFirst({
    where: { marchandId, reference: { equals: reference, mode: 'insensitive' } },
    select: SELECT_RESULTAT,
  });
}

// Rejeu d'un produit à variantes déclaré SANS SKU propre : on le reconnaît à
// ses variantes. Il est « déjà déclaré » si TOUTES les variantes reçues
// existent et appartiennent au MÊME produit. Un recouvrement partiel n'est
// pas un rejeu : il est laissé au contrôle des SKU, qui le refuse.
async function produitParVariantes(db: Tx, marchandId: string, variantes: VarianteExterne[]) {
  const trouvees = await db.produitVariante.findMany({
    where: {
      produit: { marchandId },
      OR: variantes.map((v) => ({ reference: { equals: v.reference, mode: 'insensitive' as const } })),
    },
    select: { produitId: true },
  });
  const produits = new Set(trouvees.map((v) => v.produitId));
  if (trouvees.length !== variantes.length || produits.size !== 1) return null;
  return db.produit.findUnique({ where: { id: [...produits][0] }, select: SELECT_RESULTAT });
}

function rechercherDeclaration(db: Tx, marchandId: string, entree: EntreeProduitExterne) {
  return entree.reference
    ? produitExistant(db, marchandId, entree.reference)
    : produitParVariantes(db, marchandId, entree.variantes);
}

// Référence interne d'un produit à variantes déclaré sans SKU : même
// générateur que le formulaire « Ajouter Produit ». Elle ne sert qu'à nos
// écrans — les colis désignent toujours la variante.
async function referenceInterneLibre(db: Tx, marchandId: string): Promise<string> {
  for (let essai = 0; essai < 5; essai++) {
    const candidate = genererReferenceProduit();
    if (!(await skuDejaPris(marchandId, [candidate], db))) return candidate;
  }
  throw new Error('Impossible d’attribuer une référence interne libre');
}

export async function declarerProduit(
  contexte: ContextePlateforme,
  entree: EntreeProduitExterne
): Promise<ResultatProduit> {
  const marchandId = await resoudreMarchand(contexte, entree.idExterneMarchand);
  const auteur = contexte.utilisateurTechniqueId;
  const origine = `déclaré par ${contexte.plateformeCode}`;

  // Contrôles et création SÉRIALISÉS par marchand (verrou transactionnel) :
  // l'unicité des SKU est applicative (lib/stock-sku.ts) — les @@unique ne
  // couvrent pas les variantes de deux produits différents — et sans SKU
  // produit, deux déclarations simultanées du même produit passeraient toutes
  // les deux le contrôle. Le verrou ne bloque que les écritures de stock de
  // CE marchand, le temps d'une création.
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`produits:${marchandId}`}))`;

      // 1. Déjà déclaré ? Aucune écriture : ni la fiche (corrigée peut-être depuis
      // notre back-office), ni surtout la quantité.
      const existant = await rechercherDeclaration(tx, marchandId, entree);
      if (existant) return resultat('deja_existant', existant);

      // 2. Un SKU de la requête déjà porté par un AUTRE produit ou une de ses
      // variantes — y compris le SKU du produit lui-même, qui peut être celui
      // d'une variante ailleurs : une étiquette désigne une seule unité de stock.
      const references = [...(entree.reference ? [entree.reference] : []), ...entree.variantes.map((v) => v.reference)];
      const pris = await skuDejaPris(marchandId, references, tx);
      if (pris) {
        throw new ErreurPlateforme(
          409,
          'sku_deja_utilise',
          `Le SKU « ${pris} » désigne déjà un autre produit de ce marchand`
        );
      }

      const cree = await tx.produit.create({
        data: {
          marchandId,
          nom: entree.nom,
          reference: entree.reference ?? (await referenceInterneLibre(tx, marchandId)),
          quantiteEnCours: entree.quantiteEnCours,
          note: entree.note,
          photoUrl: entree.photoUrl,
          variantesActivees: entree.variantesActivees,
          variantes: { create: entree.variantes },
          historique: {
            create: [
              {
                texte: entree.variantesActivees
                  ? `${entree.nom} a été ajouté (${origine})`
                  : `${entree.nom} a été ajouté, ${entree.quantiteEnCours} annoncé(s) (${origine})`,
                utilisateurId: auteur,
              },
              ...entree.variantes.map((v) => ({
                texte: `${v.nom} a été ajouté, ${v.quantiteEnCours} annoncé(s) (${origine})`,
                utilisateurId: auteur,
              })),
            ],
          },
        },
        select: SELECT_RESULTAT,
      });
      return resultat('cree', cree);
    });
  } catch (error) {
    // Le verrou ne couvre que les déclarations par API : une création
    // simultanée du même SKU depuis l'espace marchand peut encore buter sur
    // la contrainte (marchandId, reference). Le perdant reçoit le produit de
    // l'autre, comme un rejeu.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const gagnant = await prisma.$transaction((tx) => rechercherDeclaration(tx, marchandId, entree));
      if (gagnant) return resultat('deja_existant', gagnant);
    }
    throw error;
  }
}
