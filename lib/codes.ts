import { prisma } from '@/lib/prisma';

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

export async function nextBonEnvoiNumero(): Promise<string> {
  const value = await nextFromSequence('bon_envoi_numero_seq');
  return `BE-${value.toString().padStart(6, '0')}`;
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
export async function nextBonLivraisonNumero(): Promise<string> {
  const now = new Date();
  const annee = now.getFullYear();
  const moisJour = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefixe = `BL-${annee}-${moisJour}-`;

  const count = await prisma.bonDeLivraison.count({
    where: { numero: { startsWith: prefixe } },
  });

  return `${prefixe}${String(count + 1).padStart(3, '0')}`;
}
