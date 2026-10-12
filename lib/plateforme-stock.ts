import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ErreurPlateforme, type ContextePlateforme } from '@/lib/plateforme-auth';
import { resoudreMarchand } from '@/lib/plateforme-colis';
import { journaliserMouvements } from '@/lib/stock-mouvements';
import { resoudreSkuUnivers, type SkuResolu } from '@/lib/stock-sku';

// § Stock d'une plateforme partenaire (décision du 12/10/2026).
//
//   POST /v1/stock/envois   annonce d'un envoi de marchandise (le réassort)
//   GET  /v1/stock          lecture du stock de son univers
//
// L'univers d'une plateforme, dans un environnement : son stock COMMUN et le
// stock PERSONNEL de chacun de ses marchands. Un SKU y est unique.

const QUANTITE_MAX = 2_147_483_647;
export const LIGNES_MAX_PAR_ENVOI = 500;

// --- POST /v1/stock/envois ----------------------------------------------------

export interface EntreeEnvoi {
  referenceEnvoi: string;
  lignes: { sku: string; quantite: number }[];
}

export function analyserEntreeEnvoi(corpsBrut: unknown): EntreeEnvoi {
  if (typeof corpsBrut !== 'object' || corpsBrut === null || Array.isArray(corpsBrut)) {
    throw new ErreurPlateforme(400, 'corps_invalide', 'Le corps de la requête doit être un objet JSON');
  }
  const corps = corpsBrut as Record<string, unknown>;
  const referenceEnvoi = typeof corps.referenceEnvoi === 'string' ? corps.referenceEnvoi.trim() : '';
  if (!referenceEnvoi) {
    throw new ErreurPlateforme(400, 'champ_requis', 'Le champ « referenceEnvoi » est requis');
  }
  if (!Array.isArray(corps.lignes) || corps.lignes.length === 0) {
    throw new ErreurPlateforme(400, 'lignes_invalides', '« lignes » doit être un tableau d’au moins une ligne');
  }
  if (corps.lignes.length > LIGNES_MAX_PAR_ENVOI) {
    throw new ErreurPlateforme(400, 'lignes_invalides', `Un envoi ne peut pas dépasser ${LIGNES_MAX_PAR_ENVOI} lignes`);
  }
  // Un même SKU répété (casse comprise) n'en fait qu'une ligne.
  const parSku = new Map<string, { sku: string; quantite: number }>();
  for (const [index, brut] of corps.lignes.entries()) {
    const l = (typeof brut === 'object' && brut !== null ? brut : {}) as Record<string, unknown>;
    const sku = typeof l.sku === 'string' ? l.sku.trim() : '';
    if (!sku) throw new ErreurPlateforme(400, 'champ_requis', `Le champ « lignes[${index}].sku » est requis`);
    const quantite = Number(l.quantite);
    if (!Number.isInteger(quantite) || quantite <= 0 || quantite > QUANTITE_MAX) {
      throw new ErreurPlateforme(400, 'quantite_invalide', `lignes[${index}].quantite doit être un entier positif`);
    }
    const deja = parSku.get(sku.toLowerCase());
    if (deja) deja.quantite += quantite;
    else parSku.set(sku.toLowerCase(), { sku, quantite });
  }
  return { referenceEnvoi, lignes: [...parSku.values()] };
}

export interface ResultatEnvoi {
  issue: 'cree' | 'deja_recu';
  referenceEnvoi: string;
  statut: string;
  lignes: { sku: string; quantiteAnnoncee: number; quantiteRecue: number }[];
}

function resultatEnvoi(
  issue: ResultatEnvoi['issue'],
  envoi: { reference: string; statut: string; lignes: { sku: string; quantiteAnnoncee: number; quantiteRecue: number }[] }
): ResultatEnvoi {
  return {
    issue,
    referenceEnvoi: envoi.reference,
    statut: envoi.statut,
    lignes: envoi.lignes.map((l) => ({ sku: l.sku, quantiteAnnoncee: l.quantiteAnnoncee, quantiteRecue: l.quantiteRecue })),
  };
}

const SELECT_ENVOI = {
  reference: true,
  statut: true,
  lignes: { select: { sku: true, quantiteAnnoncee: true, quantiteRecue: true }, orderBy: { sku: 'asc' } },
} as const;

// Annonce un envoi : chaque SKU déjà déclaré reçoit la quantité en « en
// route » (quantiteEnCours), que l'entrepôt réceptionnera. Tout ou rien : un
// seul SKU inconnu et rien n'est annoncé. Idempotent sur `referenceEnvoi` :
// rejouer le même envoi ne compte jamais deux fois.
export async function declarerEnvoi(contexte: ContextePlateforme, entree: EntreeEnvoi): Promise<ResultatEnvoi> {
  const cle = { plateformeId: contexte.plateformeId, environnement: contexte.environnement, reference: entree.referenceEnvoi };

  const existant = await prisma.envoiStock.findUnique({
    where: { plateformeId_environnement_reference: cle },
    select: SELECT_ENVOI,
  });
  if (existant) return resultatEnvoi('deja_recu', existant);

  const resolus = await Promise.all(
    entree.lignes.map((l) => resoudreSkuUnivers(contexte.plateformeId, contexte.environnement, l.sku))
  );
  const inconnus = entree.lignes.filter((_, i) => !resolus[i]).map((l) => l.sku);
  if (inconnus.length > 0) {
    throw new ErreurPlateforme(
      400,
      'sku_inconnu',
      `SKU inconnu${inconnus.length > 1 ? 's' : ''} : ${inconnus.join(', ')}. Déclarer le produit d’abord via POST /v1/produits.`
    );
  }
  const parent = resolus.find((r) => r && r.produit.variantesActivees && !r.variante);
  if (parent) {
    throw new ErreurPlateforme(
      400,
      'sku_a_variantes',
      `« ${parent.produit.reference} » est un produit à variantes : annoncer chaque variante par son SKU`
    );
  }

  const auteur = contexte.utilisateurTechniqueId;
  try {
    return await prisma.$transaction(async (tx) => {
      const envoi = await tx.envoiStock.create({
        data: {
          ...cle,
          lignes: {
            create: entree.lignes.map((l, i) => {
              const r = resolus[i] as SkuResolu;
              return {
                produitId: r.produit.id,
                varianteId: r.variante?.id ?? null,
                sku: r.variante?.reference ?? r.produit.reference,
                quantiteAnnoncee: l.quantite,
              };
            }),
          },
        },
        select: { id: true },
      });

      for (const [i, l] of entree.lignes.entries()) {
        const r = resolus[i] as SkuResolu;
        if (r.variante) {
          await tx.produitVariante.update({ where: { id: r.variante.id }, data: { quantiteEnCours: { increment: l.quantite } } });
        } else {
          await tx.produit.update({ where: { id: r.produit.id }, data: { quantiteEnCours: { increment: l.quantite } } });
        }
        await tx.historiqueProduit.create({
          data: {
            produitId: r.produit.id,
            texte: `${l.quantite}, ${r.variante ? `${r.produit.nom} — ${r.variante.nom}` : r.produit.nom} annoncé(s) — envoi ${entree.referenceEnvoi} (${contexte.plateformeCode})`,
            utilisateurId: auteur,
          },
        });
      }
      await journaliserMouvements(
        tx,
        entree.lignes.map((l, i) => {
          const r = resolus[i] as SkuResolu;
          return {
            type: 'annonce' as const,
            produitId: r.produit.id,
            varianteId: r.variante?.id ?? null,
            quantite: l.quantite,
            envoiId: envoi.id,
            utilisateurId: auteur,
            motif: `envoi ${entree.referenceEnvoi}`,
          };
        })
      );

      const cree = await tx.envoiStock.findUniqueOrThrow({ where: { id: envoi.id }, select: SELECT_ENVOI });
      return resultatEnvoi('cree', cree);
    });
  } catch (error) {
    // Deux annonces simultanées du même envoi : la contrainte d'unicité
    // tranche, le perdant reçoit l'envoi créé par l'autre, comme un rejeu.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const gagnant = await prisma.envoiStock.findUnique({
        where: { plateformeId_environnement_reference: cle },
        select: SELECT_ENVOI,
      });
      if (gagnant) return resultatEnvoi('deja_recu', gagnant);
    }
    throw error;
  }
}

// --- GET /v1/stock --------------------------------------------------------------

export interface LigneStock {
  sku: string;
  nom: string;
  // `plateforme` pour le stock commun, sinon l'idExterne du marchand propriétaire.
  proprietaire: string;
  // En route : annoncé, pas encore réceptionné par l'entrepôt.
  annonce: number;
  // Reçu, ni réservé ni sorti pour un colis : ce qui peut encore être vendu.
  disponible: number;
  // Avec ?idExterneMarchand, pour un produit commun : unités consommées par
  // ce marchand (sorties pour ses colis, moins ses retours).
  consommeParMarchand?: number;
}

const SELECT_PRODUIT_STOCK = {
  id: true,
  nom: true,
  reference: true,
  marchandId: true,
  variantesActivees: true,
  quantiteEnCours: true,
  quantiteRecue: true,
  variantes: {
    select: { id: true, nom: true, reference: true, quantiteEnCours: true, quantiteRecue: true },
    orderBy: { reference: 'asc' },
  },
} as const;

type ProduitStock = Prisma.ProduitGetPayload<{ select: typeof SELECT_PRODUIT_STOCK }>;

// Une ligne par UNITÉ de stock : le produit simple, ou chacune des variantes.
function unites(produit: ProduitStock, proprietaire: string): (LigneStock & { produitId: string; varianteId: string | null })[] {
  if (produit.variantesActivees) {
    return produit.variantes.map((v) => ({
      produitId: produit.id,
      varianteId: v.id,
      sku: v.reference,
      nom: `${produit.nom} — ${v.nom}`,
      proprietaire,
      annonce: v.quantiteEnCours,
      disponible: v.quantiteRecue,
    }));
  }
  return [
    {
      produitId: produit.id,
      varianteId: null,
      sku: produit.reference,
      nom: produit.nom,
      proprietaire,
      annonce: produit.quantiteEnCours,
      disponible: produit.quantiteRecue,
    },
  ];
}

export async function lireStock(contexte: ContextePlateforme, idExterneMarchand: string | null): Promise<LigneStock[]> {
  const liens = await prisma.compteMarchandExterne.findMany({
    where: { plateformeId: contexte.plateformeId, environnement: contexte.environnement },
    select: { marchandId: true, idExterne: true },
  });
  const idExterneDe = new Map(liens.map((l) => [l.marchandId, l.idExterne]));
  const commun = { plateformeId: contexte.plateformeId, environnementPlateforme: contexte.environnement };

  if (!idExterneMarchand) {
    const produits = await prisma.produit.findMany({
      where: { OR: [commun, { marchandId: { in: liens.map((l) => l.marchandId) } }] },
      select: SELECT_PRODUIT_STOCK,
      orderBy: { reference: 'asc' },
    });
    return produits.flatMap((p) =>
      unites(p, p.marchandId ? (idExterneDe.get(p.marchandId) ?? 'inconnu') : 'plateforme')
    ).map(({ produitId: _p, varianteId: _v, ...l }) => l);
  }

  const marchandId = await resoudreMarchand(contexte, idExterneMarchand);

  // Ses produits personnels…
  const personnels = await prisma.produit.findMany({
    where: { marchandId },
    select: SELECT_PRODUIT_STOCK,
    orderBy: { reference: 'asc' },
  });

  // …et les produits communs qu'il a vendus, avec sa consommation nette.
  const consommation = await prisma.mouvementStock.groupBy({
    by: ['produitId', 'varianteId'],
    where: { marchandId, type: { in: ['sortie_colis', 'retour_colis'] }, produit: commun },
    _sum: { quantite: true },
  });
  const consommeDe = new Map(consommation.map((c) => [`${c.produitId}|${c.varianteId ?? ''}`, -(c._sum.quantite ?? 0)]));
  const communs = consommation.length
    ? await prisma.produit.findMany({
        where: { ...commun, id: { in: [...new Set(consommation.map((c) => c.produitId))] } },
        select: SELECT_PRODUIT_STOCK,
        orderBy: { reference: 'asc' },
      })
    : [];

  return [
    ...personnels.flatMap((p) => unites(p, idExterneMarchand)).map(({ produitId: _p, varianteId: _v, ...l }) => l),
    ...communs
      .flatMap((p) => unites(p, 'plateforme'))
      .filter((u) => consommeDe.has(`${u.produitId}|${u.varianteId ?? ''}`))
      .map(({ produitId, varianteId, ...l }) => ({ ...l, consommeParMarchand: consommeDe.get(`${produitId}|${varianteId ?? ''}`) ?? 0 })),
  ];
}
