import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';
import { ApiError } from '@/lib/api-utils';
import { lignesEffectives, regrouperBesoinsStock, type ColisBesoin, type MouvementStockSortant } from '@/lib/stock-quantites';

// § Gestion de stock — le stock vu depuis un colis.
//
// Trois moments, et eux seuls, touchent au stock d'un colis "stock" :
//   1. le rattachement à une unité de stock (création / édition du colis) ;
//   2. la RÉSERVATION au passage en préparation (/api/stock/pret-pour-preparation) ;
//   3. la RÉINTÉGRATION, action admin explicite sur un colis non livré
//      (/api/commandes/[id]/reintegrer-stock).
// Une unité de stock est une variante quand le produit suit ses variantes,
// le produit lui-même sinon (lib/stock-quantites.ts). Un colis puise dans
// autant d'unités qu'il a de lignes (§ Colis multi-produits, LigneColis).

type Db = Prisma.TransactionClient | typeof prisma;

const UNITE_PRODUIT = { select: { nom: true, variantesActivees: true } } as const;

// Ce qu'il faut lire d'un colis pour savoir ce qu'il prend au stock : ses
// lignes, et l'ancien produit unique pour le repli transitoire
// (lignesEffectives).
const SELECT_CONTENU_STOCK = {
  id: true,
  codeSuivi: true,
  quantite: true,
  produitId: true,
  varianteId: true,
  produit: UNITE_PRODUIT,
  lignes: {
    orderBy: { position: 'asc' },
    select: { libelle: true, quantite: true, produitId: true, varianteId: true, produit: UNITE_PRODUIT },
  },
} as const;

async function chargerContenuStock(db: Db, ids: string[]): Promise<ColisBesoin[]> {
  const colis = await db.commande.findMany({ where: { id: { in: ids } }, select: SELECT_CONTENU_STOCK });
  return colis.map((c) => ({ id: c.id, codeSuivi: c.codeSuivi, lignes: lignesEffectives(c) }));
}

// Valide le couple produit/variante d'un colis dans le périmètre du marchand
// propriétaire. Un produit à variantes exige sa variante : sans elle, le colis
// ne pourrait jamais consommer de stock.
export async function verifierUniteStock(
  marchandId: string,
  produitId: string,
  varianteId: string | null,
  db: Db = prisma
): Promise<{ produitId: string; varianteId: string | null; libelle: string }> {
  const produit = await db.produit.findUnique({
    where: { id: produitId },
    select: { id: true, nom: true, marchandId: true, variantesActivees: true },
  });
  if (!produit || produit.marchandId !== marchandId) {
    throw new ApiError(400, 'produitId invalide pour ce marchand');
  }
  if (!produit.variantesActivees) {
    return { produitId: produit.id, varianteId: null, libelle: produit.nom };
  }
  if (!varianteId) {
    throw new ApiError(400, `Choisissez la variante de « ${produit.nom} »`);
  }
  const variante = await db.produitVariante.findUnique({ where: { id: varianteId }, select: { id: true, nom: true, produitId: true } });
  if (!variante || variante.produitId !== produit.id) {
    throw new ApiError(400, 'varianteId invalide pour ce produit');
  }
  return { produitId: produit.id, varianteId: variante.id, libelle: `${produit.nom} — ${variante.nom}` };
}

// Réserve (décrémente) le stock réel des colis donnés, toutes leurs lignes,
// en tout ou rien : un seul colis sans unité de stock, ou une seule unité
// insuffisante, et rien n'est décrémenté. À appeler dans la transaction qui
// fait avancer les colis — le contenu est relu dans cette transaction.
//
// Renvoie les mouvements écrits (stock avant/après par unité), que
// l'appelant passe à notifierStockBas() APRÈS la transaction.
export async function reserverStockColis(
  tx: Prisma.TransactionClient,
  colisDemandes: { id: string }[],
  utilisateurId: string
): Promise<MouvementStockSortant[]> {
  const colis = await chargerContenuStock(tx, colisDemandes.map((c) => c.id));
  const { besoins, anomalies } = regrouperBesoinsStock(colis);
  if (anomalies.length > 0) {
    throw new ApiError(409, `Stock non identifié — ${anomalies.join(' ; ')}`);
  }

  const mouvements: MouvementStockSortant[] = [];
  for (const { unite, quantite, produitId } of besoins.values()) {
    const resultat =
      unite.type === 'variante'
        ? await tx.produitVariante.updateMany({
            where: { id: unite.id, quantiteRecue: { gte: quantite } },
            data: { quantiteRecue: { decrement: quantite } },
          })
        : await tx.produit.updateMany({
            where: { id: unite.id, quantiteRecue: { gte: quantite } },
            data: { quantiteRecue: { decrement: quantite } },
          });
    if (resultat.count === 0) {
      throw new ApiError(409, `Stock réel insuffisant pour « ${await libelleUnite(tx, unite.type, unite.id, produitId)} » (besoin : ${quantite})`);
    }
    const apres = await stockReelUnite(tx, unite.type, unite.id);
    mouvements.push({ unite, produitId, avant: apres + quantite, apres });
  }

  if (besoins.size > 0) {
    const lignes = await Promise.all(
      Array.from(besoins.values()).map(async ({ unite, quantite, produitId, codes }) => ({
        produitId,
        texte: `${quantite}, ${await libelleUnite(tx, unite.type, unite.id, produitId)} retiré(s) — passage en préparation (${codes.join(', ')})`,
        utilisateurId,
      }))
    );
    await tx.historiqueProduit.createMany({ data: lignes });
  }

  await tx.commande.updateMany({ where: { id: { in: colis.map((c) => c.id) } }, data: { stockReserveLe: new Date() } });
  return mouvements;
}

// Stock réel validé d'une unité, lu dans la transaction en cours.
export async function stockReelUnite(db: Db, type: 'produit' | 'variante', id: string): Promise<number> {
  const unite =
    type === 'variante'
      ? await db.produitVariante.findUnique({ where: { id }, select: { quantiteRecue: true } })
      : await db.produit.findUnique({ where: { id }, select: { quantiteRecue: true } });
  return unite?.quantiteRecue ?? 0;
}

// Remet sur l'étagère le stock d'un colis non livré. La garde sur
// stockReintegreLe dans le WHERE rend l'opération sûre face à un double clic
// ou à deux agents simultanés : seul le premier réintègre.
export async function reintegrerStockColis(tx: Prisma.TransactionClient, commandeId: string, utilisateurId: string, motif: string | null) {
  const marque = await tx.commande.updateMany({
    where: { id: commandeId, stockReserveLe: { not: null }, stockReintegreLe: null },
    data: { stockReintegreLe: new Date() },
  });
  if (marque.count === 0) {
    throw new ApiError(409, 'Le stock de ce colis a déjà été réintégré, ou n’a jamais été réservé');
  }

  const [colis] = await chargerContenuStock(tx, [commandeId]);
  const { besoins, anomalies } = regrouperBesoinsStock([colis]);
  if (anomalies.length > 0) {
    throw new ApiError(409, `Stock non identifié — ${anomalies.join(' ; ')}`);
  }

  for (const { unite, quantite, produitId } of besoins.values()) {
    if (unite.type === 'variante') {
      await tx.produitVariante.update({ where: { id: unite.id }, data: { quantiteRecue: { increment: quantite } } });
    } else {
      await tx.produit.update({ where: { id: unite.id }, data: { quantiteRecue: { increment: quantite } } });
    }
    const libelle = await libelleUnite(tx, unite.type, unite.id, produitId);
    await tx.historiqueProduit.create({
      data: {
        produitId,
        texte: `${quantite}, ${libelle} réintégré(s) — retour du colis ${colis.codeSuivi}${motif ? ` — ${motif}` : ''}`,
        utilisateurId,
      },
    });
  }
}

async function libelleUnite(db: Db, type: 'produit' | 'variante', id: string, produitId: string): Promise<string> {
  if (type === 'variante') {
    const v = await db.produitVariante.findUnique({ where: { id }, select: { nom: true, produit: { select: { nom: true } } } });
    return v ? `${v.produit.nom} — ${v.nom}` : id;
  }
  const p = await db.produit.findUnique({ where: { id: produitId }, select: { nom: true } });
  return p?.nom ?? produitId;
}
