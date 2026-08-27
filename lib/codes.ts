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

// Préfixe journalier commun à tous les documents numérotés AAAA-MMJJ-NNN
// (BL, BPR, BE, BD, BR, BP, FA) — factorisé à partir du moment où sept
// fonctions le recalculaient à l'identique.
function prefixeDuJour(code: string): string {
  const now = new Date();
  const annee = now.getFullYear();
  const moisJour = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${code}-${annee}-${moisJour}-`;
}

// Dernier numéro du jour + 1 plutôt que `count() + 1` : un trou dans la série
// (document supprimé en base, nettoyage d'un jeu de test) ferait retomber le
// compteur sur un numéro déjà pris et la création échouerait sur la
// contrainte d'unicité — cf. le commentaire de nextBonDistributionNumero, où
// le cas a été observé en développement.
function suivantApres(dernier: string | null | undefined, prefixe: string): string {
  const suivant = dernier ? Number(dernier.slice(prefixe.length)) + 1 : 1;
  return `${prefixe}${String(suivant).padStart(3, '0')}`;
}

// Numérotation du bon de retour marchand (§ /admin/bon-retour) :
// BR-AAAA-MMJJ-NNN.
//
// Remplace une implémentation qui appelait nextval('bon_retour_numero_seq') :
// cette séquence n'a JAMAIS été créée en migration (seule commande_code_seq
// existe, cf. 20260723160955_scenario1_ramassage) — la fonction aurait donc
// échoué au premier appel réel. Même correction que celle déjà appliquée à
// nextBonEnvoiNumero pour la même raison.
export async function nextBonRetourNumero(db: Db = prisma): Promise<string> {
  const prefixe = prefixeDuJour('BR');
  const dernier = await db.bonRetour.findFirst({
    where: { numero: { startsWith: prefixe } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });
  return suivantApres(dernier?.numero, prefixe);
}

// Numérotation du bon de paiement livreur (§ /admin/bon-paiement) :
// BP-LIV-AAAA-MM-NNN, indexée sur la PÉRIODE DE PAIE et non sur le jour
// d'émission comme les autres documents. Un bon d'août généré en retard le
// 12 septembre doit se numéroter BP-LIV-2026-08-xxx : c'est le mois de paie
// qui identifie le document, et un préfixe journalier rendrait un lot
// régénéré après annulation impossible à rapprocher du lot d'origine.
//
// Le compteur repart donc à 001 à chaque mois de paie, et non chaque jour.
// Accepte un client de transaction : la génération groupée du mois crée
// plusieurs bons dans une seule transaction, et le comptage doit voir ceux
// déjà créés dedans.
export async function nextBonPaiementNumero(db: Db = prisma, periodeDebut: Date = new Date()): Promise<string> {
  const annee = periodeDebut.getFullYear();
  const mois = String(periodeDebut.getMonth() + 1).padStart(2, '0');
  const prefixe = `BP-LIV-${annee}-${mois}-`;
  const dernier = await db.bonPaiement.findFirst({
    where: { numero: { startsWith: prefixe } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });
  return suivantApres(dernier?.numero, prefixe);
}

// Numérotation de la facture marchand (§ /admin/factures) :
// FA-AAAA-MMJJ-NNN. Accepte un client de transaction pour la même raison que
// ci-dessus : une émission multi-marchands crée plusieurs factures d'un coup.
export async function nextFactureNumero(db: Db = prisma): Promise<string> {
  const prefixe = prefixeDuJour('FA');
  const dernier = await db.facture.findFirst({
    where: { numero: { startsWith: prefixe } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });
  return suivantApres(dernier?.numero, prefixe);
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

  // Dernier numéro du jour + 1, et non `count() + 1` comme les fonctions
  // ci-dessus : un trou dans la séquence (une tournée supprimée en base, un
  // nettoyage de jeu de test) ferait retomber le compteur sur un numéro déjà
  // pris et la création échouerait sur la contrainte d'unicité — observé en
  // dev sur ce module. Chercher le maximum reste juste dans les deux cas.
  const dernier = await db.bonDistribution.findFirst({
    where: { numero: { startsWith: prefixe } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  });

  const suivant = dernier ? Number(dernier.numero.slice(prefixe.length)) + 1 : 1;
  return `${prefixe}${String(suivant).padStart(3, '0')}`;
}
