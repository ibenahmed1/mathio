import type { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { journaliserMouvements, type NouveauMouvement } from '@/lib/stock-mouvements';

// § Réception en entrepôt (12/10/2026) : le seul chemin par lequel de
// l'annoncé devient du reçu, qu'on réceptionne depuis la fiche produit ou
// depuis un envoi annoncé par une plateforme.
//
// Les unités reçues sont imputées aux lignes d'envoi encore ouvertes de cette
// unité de stock — l'envoi désigné d'abord, puis les plus anciens : un envoi
// dit ainsi toujours ce qui en est arrivé, même quand l'entrepôt a compté la
// marchandise depuis la fiche produit. Ce qui ne correspond à aucun envoi
// (stock déclaré par un marchand depuis son espace) est journalisé sans envoi.

export interface UniteRecue {
  produitId: string;
  varianteId: string | null;
  // Nom affiché dans l'historique du produit (le produit, ou la variante).
  nom: string;
  quantite: number;
  utilisateurId: string;
  // Envoi à servir en priorité (réception depuis l'écran des envois).
  envoiId?: string | null;
}

export async function receptionnerUnite(tx: Prisma.TransactionClient, unite: UniteRecue): Promise<string[]> {
  const { produitId, varianteId, quantite, utilisateurId } = unite;

  // Garde dans le WHERE : deux validations simultanées ne peuvent pas
  // recevoir deux fois le même annoncé.
  const deplacement = { quantiteEnCours: { decrement: quantite }, quantiteRecue: { increment: quantite } };
  const resultat = varianteId
    ? await tx.produitVariante.updateMany({ where: { id: varianteId, quantiteEnCours: { gte: quantite } }, data: deplacement })
    : await tx.produit.updateMany({ where: { id: produitId, quantiteEnCours: { gte: quantite } }, data: deplacement });
  if (resultat.count === 0) {
    throw new ApiError(409, 'Quantité en cours insuffisante (a peut-être déjà été validée entre-temps)');
  }

  await tx.historiqueProduit.create({
    data: { produitId, texte: `${quantite}, ${unite.nom} a été reçu`, utilisateurId },
  });

  const ouvertes = await tx.envoiStockLigne.findMany({
    where: { produitId, varianteId, envoi: { statut: { not: 'recu' } } },
    select: { id: true, envoiId: true, quantiteAnnoncee: true, quantiteRecue: true, envoi: { select: { dateAnnonce: true } } },
  });
  ouvertes.sort((a, b) => {
    const prioA = a.envoiId === unite.envoiId ? 0 : 1;
    const prioB = b.envoiId === unite.envoiId ? 0 : 1;
    return prioA - prioB || a.envoi.dateAnnonce.getTime() - b.envoi.dateAnnonce.getTime();
  });

  let reste = quantite;
  const mouvements: NouveauMouvement[] = [];
  const envoisTouches = new Set<string>();
  for (const ligne of ouvertes) {
    if (reste === 0) break;
    const part = Math.min(reste, ligne.quantiteAnnoncee - ligne.quantiteRecue);
    if (part <= 0) continue;
    await tx.envoiStockLigne.update({ where: { id: ligne.id }, data: { quantiteRecue: { increment: part } } });
    mouvements.push({ type: 'reception', produitId, varianteId, quantite: part, envoiId: ligne.envoiId, utilisateurId });
    envoisTouches.add(ligne.envoiId);
    reste -= part;
  }
  if (reste > 0) mouvements.push({ type: 'reception', produitId, varianteId, quantite: reste, utilisateurId });
  await journaliserMouvements(tx, mouvements);

  for (const envoiId of envoisTouches) await majStatutEnvoi(tx, envoiId);
  return [...envoisTouches];
}

// attendu → recu_partiel → recu, d'après ses lignes. Daté au premier « recu ».
export async function majStatutEnvoi(tx: Prisma.TransactionClient, envoiId: string): Promise<void> {
  const lignes = await tx.envoiStockLigne.findMany({ where: { envoiId }, select: { quantiteAnnoncee: true, quantiteRecue: true } });
  const complet = lignes.every((l) => l.quantiteRecue >= l.quantiteAnnoncee);
  const entame = lignes.some((l) => l.quantiteRecue > 0);
  const statut = complet ? 'recu' : entame ? 'recu_partiel' : 'attendu';
  await tx.envoiStock.updateMany({
    where: { id: envoiId, statut: { not: statut } },
    data: { statut, ...(statut === 'recu' ? { dateReception: new Date() } : {}) },
  });
}

// § Validation groupée (14/10/2026) : ce que l'admin fait à la main sur une
// fiche, en une fois — statut « Reçu », puis tout le déclaré encore en cours
// passe en reçu, variante par variante. Une transaction par produit ; rend le
// nombre d'unités reçues (0 si le produit n'avait rien à valider).
export async function validerReceptionProduit(produitId: string, utilisateurId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const produit = await tx.produit.findUnique({ where: { id: produitId }, include: { variantes: true } });
    if (!produit) throw new ApiError(404, 'Produit introuvable');
    const aRecevoir = produit.variantesActivees
      ? produit.variantes.filter((v) => v.quantiteEnCours > 0).map((v) => ({ varianteId: v.id, nom: v.nom, quantite: v.quantiteEnCours }))
      : produit.quantiteEnCours > 0
        ? [{ varianteId: null, nom: produit.nom, quantite: produit.quantiteEnCours }]
        : [];

    if (produit.statutReception !== 'recu') {
      await tx.produit.update({ where: { id: produitId }, data: { statutReception: 'recu' } });
      await tx.historiqueProduit.create({
        data: { produitId, texte: 'Statut de réception : Pas encore reçu → Reçu (validation groupée)', utilisateurId },
      });
    }
    // La garde de receptionnerUnite (quantiteEnCours >= quantite) refuse si
    // le déclaré a bougé entre la lecture et l'écriture.
    for (const u of aRecevoir) await receptionnerUnite(tx, { produitId, utilisateurId, ...u });
    return aRecevoir.reduce((s, u) => s + u.quantite, 0);
  });
}
