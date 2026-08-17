import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';

type Db = Prisma.TransactionClient | typeof prisma;

// RG-01 : les codes/numéros de suivi sont générés par des séquences serveur
// (créées en migration, voir prisma/migrations/20260723123032_power_delivery_core),
// jamais par un horodatage ou un compteur côté client.
async function nextFromSequence(sequenceName: string): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${sequenceName}') as nextval`
  );
  return rows[0].nextval;
}

export async function nextCodeSuivi(): Promise<string> {
  const value = await nextFromSequence('commande_code_seq');
  return `PD-${value.toString().padStart(6, '0')}`;
}

export async function nextBonRetourNumero(): Promise<string> {
  const value = await nextFromSequence('bon_retour_numero_seq');
  return `BR-${value.toString().padStart(6, '0')}`;
}

export async function nextBonPaiementNumero(): Promise<string> {
  const value = await nextFromSequence('bon_paiement_numero_seq');
  return `BP-${value.toString().padStart(4, '0')}`;
}

// Numérotation du bon de livraison marchand : BL-AAAA-MMJJ-NNN, remise à 1
// chaque jour (comptage des BL déjà générés ce jour-là, pas de séquence dédiée).
// Accepte optionnellement un client de transaction : indispensable pour
// générer plusieurs numéros au sein d'une même transaction (ex. import Excel
// multi-marchands, § app/api/commandes/import/route.ts) — le comptage doit
// voir les BL déjà créés dans cette même transaction, ce qu'une requête sur
// le client global `prisma` (connexion séparée) ne verrait pas tant qu'elle
// n'est pas validée.
export async function nextBonLivraisonNumero(db: Db = prisma): Promise<string> {
  const now = new Date();
  const annee = now.getFullYear();
  const moisJour = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefixe = `BL-${annee}-${moisJour}-`;

  const count = await db.bonDeLivraison.count({
    where: { numero: { startsWith: prefixe } },
  });

  return `${prefixe}${String(count + 1).padStart(3, '0')}`;
}

// Numérotation du bon de préparation stock : BPR-AAAA-MMJJ-NNN, même schéma
// que nextBonLivraisonNumero (remise à 1 chaque jour, compteur par préfixe du
// jour plutôt qu'une séquence dédiée) — § Gestion de stock, un bon par
// marchand pouvant être généré plusieurs fois le même jour lors d'une
// sélection multi-marchands (voir POST /api/bons-preparation, qui appelle
// cette fonction en boucle au sein d'une même transaction : d'où le
// paramètre `db` optionnel pour voir les bons déjà créés dans cette
// transaction).
export async function nextBonPreparationNumero(db: Db = prisma): Promise<string> {
  const now = new Date();
  const annee = now.getFullYear();
  const moisJour = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefixe = `BPR-${annee}-${moisJour}-`;

  const count = await db.bonDePreparation.count({
    where: { numero: { startsWith: prefixe } },
  });

  return `${prefixe}${String(count + 1).padStart(3, '0')}`;
}

// Numérotation du bon d'envoi (§ Transit inter-hubs /admin/bon-envoi) :
// BE-AAAA-MMJJ-NNN, même schéma que BL/BPR ci-dessus (compteur journalier par
// préfixe plutôt qu'une séquence dédiée — remplace une précédente implémentation
// qui appelait nextval('bon_envoi_numero_seq'), une séquence jamais créée en
// migration et qui n'avait donc aucun appelant fonctionnel).
export async function nextBonEnvoiNumero(db: Db = prisma): Promise<string> {
  const now = new Date();
  const annee = now.getFullYear();
  const moisJour = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefixe = `BE-${annee}-${moisJour}-`;

  const count = await db.bonEnvoi.count({
    where: { numero: { startsWith: prefixe } },
  });

  return `${prefixe}${String(count + 1).padStart(3, '0')}`;
}

// Numérotation du bon de distribution (§ Distribution locale /admin/bon-distribution) :
// BD-AAAA-MMJJ-NNN, même schéma que BL/BPR/BE ci-dessus (compteur journalier
// par préfixe). Accepte un client de transaction : la création se fait dans
// un $transaction (voir POST /api/bons-distribution) pour que le comptage
// voie le numéro s'il devait en générer plusieurs dans le même appel.
export async function nextBonDistributionNumero(db: Db = prisma): Promise<string> {
  const now = new Date();
  const annee = now.getFullYear();
  const moisJour = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefixe = `BD-${annee}-${moisJour}-`;

  const count = await db.bonDistribution.count({
    where: { numero: { startsWith: prefixe } },
  });

  return `${prefixe}${String(count + 1).padStart(3, '0')}`;
}
