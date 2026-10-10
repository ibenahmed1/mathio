import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';
import { ApiError } from '@/lib/api-utils';
import { regrouperBesoinsStock, type ColisBesoin } from '@/lib/stock-quantites';

// § Gestion de stock — le stock vu depuis un colis.
//
// Trois moments, et eux seuls, touchent au stock d'un colis "stock" :
//   1. le rattachement à une unité de stock (création / édition du colis) ;
//   2. la RÉSERVATION au passage en préparation (/api/stock/pret-pour-preparation) ;
//   3. la RÉINTÉGRATION, action admin explicite sur un colis non livré
//      (/api/commandes/[id]/reintegrer-stock).
// Une unité de stock est une variante quand le produit suit ses variantes,
// le produit lui-même sinon (lib/stock-quantites.ts).

type Db = Prisma.TransactionClient | typeof prisma;

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

// Réserve (décrémente) le stock réel des colis donnés, en tout ou rien : un
// seul colis sans unité de stock, ou une seule unité insuffisante, et rien
// n'est décrémenté. À appeler dans la transaction qui fait avancer les colis.
export async function reserverStockColis(tx: Prisma.TransactionClient, colis: ColisBesoin[], utilisateurId: string) {
  const { besoins, anomalies } = regrouperBesoinsStock(colis);
  if (anomalies.length > 0) {
    throw new ApiError(409, `Stock non identifié — ${anomalies.join(' ; ')}`);
  }

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

  const colis = await tx.commande.findUniqueOrThrow({
    where: { id: commandeId },
    select: { codeSuivi: true, quantite: true, produitId: true, varianteId: true, produit: { select: { variantesActivees: true } } },
  });
  if (!colis.produitId || !colis.produit) {
    throw new ApiError(409, 'Ce colis n’est plus rattaché à un produit du stock');
  }

  const parVariante = colis.produit.variantesActivees;
  if (parVariante && !colis.varianteId) {
    throw new ApiError(409, 'Ce colis n’indique pas la variante à réintégrer');
  }
  if (parVariante) {
    await tx.produitVariante.update({ where: { id: colis.varianteId! }, data: { quantiteRecue: { increment: colis.quantite } } });
  } else {
    await tx.produit.update({ where: { id: colis.produitId }, data: { quantiteRecue: { increment: colis.quantite } } });
  }

  const libelle = await libelleUnite(tx, parVariante ? 'variante' : 'produit', parVariante ? colis.varianteId! : colis.produitId, colis.produitId);
  await tx.historiqueProduit.create({
    data: {
      produitId: colis.produitId,
      texte: `${colis.quantite}, ${libelle} réintégré(s) — retour du colis ${colis.codeSuivi}${motif ? ` — ${motif}` : ''}`,
      utilisateurId,
    },
  });
}

async function libelleUnite(db: Db, type: 'produit' | 'variante', id: string, produitId: string): Promise<string> {
  if (type === 'variante') {
    const v = await db.produitVariante.findUnique({ where: { id }, select: { nom: true, produit: { select: { nom: true } } } });
    return v ? `${v.produit.nom} — ${v.nom}` : id;
  }
  const p = await db.produit.findUnique({ where: { id: produitId }, select: { nom: true } });
  return p?.nom ?? produitId;
}
