import type { Prisma } from '@/app/generated/prisma/client';
import type { TypeMouvementStock } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

// § Journal des mouvements de stock (12/10/2026, cf. MouvementStock).
//
// Chaque entrée ou sortie d'une unité de stock y laisse une ligne, écrite
// DANS LA MÊME TRANSACTION que le compteur qu'elle explique : un compteur
// modifié sans sa ligne de journal serait un écart que personne ne peut
// expliquer — même règle que HistoriqueProduit, qui reste le texte affiché à
// l'écran. Le journal, lui, est structuré : il se compte, se filtre par
// colis, par vendeur, par envoi.
//
// Convention de signe, par type :
//   annonce        quantité annoncée (« en route ») : + annonce, − annulation
//   reception      unités passées de l'annoncé au reçu : toujours +
//   sortie_colis   unités retirées du reçu pour un colis : toujours −
//   retour_colis   unités rendues au reçu par un colis non livré : toujours +
//   retrait        unités retirées du reçu hors colis (casse, perte) : −
//   correction     ajustement manuel, signe libre, motif obligatoire

type Db = Prisma.TransactionClient | typeof prisma;

export interface NouveauMouvement {
  type: TypeMouvementStock;
  produitId: string;
  varianteId?: string | null;
  quantite: number;
  commandeId?: string | null;
  // Pour une sortie ou un retour de colis : le VENDEUR du colis.
  marchandId?: string | null;
  envoiId?: string | null;
  utilisateurId?: string | null;
  motif?: string | null;
}

export async function journaliserMouvements(db: Db, mouvements: NouveauMouvement[]): Promise<void> {
  const utiles = mouvements.filter((m) => m.quantite !== 0);
  if (utiles.length === 0) return;
  await db.mouvementStock.createMany({
    data: utiles.map((m) => ({
      type: m.type,
      produitId: m.produitId,
      varianteId: m.varianteId ?? null,
      quantite: m.quantite,
      commandeId: m.commandeId ?? null,
      marchandId: m.marchandId ?? null,
      envoiId: m.envoiId ?? null,
      utilisateurId: m.utilisateurId ?? null,
      motif: m.motif ?? null,
    })),
  });
}
