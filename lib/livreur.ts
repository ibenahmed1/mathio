import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommande } from '@/app/generated/prisma/enums';

const commandeListeInclude = {
  marchand: { select: { nomBoutique: true } },
} satisfies Prisma.CommandeInclude;

export type CommandeListeLivreur = Prisma.CommandeGetPayload<{ include: typeof commandeListeInclude }>;

function debutJour(jour: Date): Date {
  const d = new Date(jour);
  d.setHours(0, 0, 0, 0);
  return d;
}

function finJour(jour: Date): Date {
  const d = new Date(jour);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Statuts "retour" comptés dans le taux "Retourné %" du dashboard (§ Bloc 1) —
// mêmes statuts terminaux négatifs que ceux du dashboard marchand (cf.
// app/marchand/page.tsx STATUTS_ALERTE), restreints ici aux seuls retours
// définitifs (pas les relances en cours d'appel, qui ne sont ni "livré" ni
// "retourné" à proprement parler).
const STATUTS_RETOUR: StatutCommande[] = ['retourne', 'refuse', 'en_retour_par_amana', 'annule', 'annule_par_vendeur'];

export interface FiltresColisLivreur {
  etat?: 'facture';
  statut?: StatutCommande;
  dateDebut?: Date;
  dateFin?: Date;
  reporteAujourdhui?: boolean;
}

// § /livreur/colis : liste complète des colis assignés au livreur connecté,
// pas seulement la tournée du jour (cf. spec module livreur) — l'ancien
// périmètre "tournée = colis du Bon de Distribution généré aujourd'hui" reste
// disponible via le filtre Date, mais la page couvre tout l'historique du
// livreur par défaut.
export async function getColisLivreur(livreurId: string, filtres: FiltresColisLivreur = {}): Promise<CommandeListeLivreur[]> {
  const where: Prisma.CommandeWhereInput = { livreurId };

  if (filtres.etat === 'facture') {
    where.etatPaiement = 'facture';
  }
  if (filtres.statut) {
    where.statut = filtres.statut;
  }
  if (filtres.dateDebut || filtres.dateFin) {
    where.dateCreation = {
      ...(filtres.dateDebut && { gte: debutJour(filtres.dateDebut) }),
      ...(filtres.dateFin && { lte: finJour(filtres.dateFin) }),
    };
  }
  if (filtres.reporteAujourdhui) {
    where.statut = 'reporte';
    where.dateNouvelleLivraison = { gte: debutJour(new Date()), lte: finJour(new Date()) };
  }

  return prisma.commande.findMany({
    where,
    include: commandeListeInclude,
    orderBy: { dateCreation: 'desc' },
  });
}

// § /livreur (Accueil), Bloc 1 : taux Livré / Retourné sur les colis du
// livreur créés dans la plage de dates sélectionnée.
export async function getStatsColisLivreur(livreurId: string, dateDebut: Date, dateFin: Date) {
  const commandes = await prisma.commande.findMany({
    where: { livreurId, dateCreation: { gte: debutJour(dateDebut), lte: finJour(dateFin) } },
    select: { statut: true },
  });

  const total = commandes.length;
  const livres = commandes.filter((c) => c.statut === 'livre').length;
  const retournes = commandes.filter((c) => STATUTS_RETOUR.includes(c.statut)).length;

  return {
    total,
    livres,
    retournes,
    tauxLivre: total > 0 ? Math.round((livres / total) * 100) : 0,
    tauxRetourne: total > 0 ? Math.round((retournes / total) * 100) : 0,
  };
}

// § /livreur (Accueil), Bloc 2 : Bons de Distribution du livreur générés dans
// la plage de dates — le statut Prisma ('nouveau' | 'en_cours') n'a pas de
// valeur "clôturé", donc du point de vue du livreur tout bon qui lui est
// assigné est simplement « Enregistré » : le détail nouveau/en_cours ne sert
// qu'à la répartition du donut, pas au compteur global.
export async function getStatsBonsDistributionLivreur(livreurId: string, hubId: string, dateDebut: Date, dateFin: Date) {
  const bons = await prisma.bonDistribution.findMany({
    where: { livreurId, hubId, dateGeneration: { gte: debutJour(dateDebut), lte: finJour(dateFin) } },
    select: { statut: true, nbColis: true },
  });

  const total = bons.length;
  const nouveau = bons.filter((b) => b.statut === 'nouveau').length;
  const enCours = bons.filter((b) => b.statut === 'en_cours').length;
  const nbColisTotal = bons.reduce((somme, b) => somme + b.nbColis, 0);

  return { total, nouveau, enCours, nbColisTotal };
}

// § /livreur/bons-paiement : colis livrés aujourd'hui par ce livreur — le
// CRBT encaissé se déduit de la somme de leur montantCod (pas de modèle
// "Caisse" dédié, cf. Transaction pour la comptabilité interne qui vit à un
// tout autre niveau — celui-ci est propre au livreur et calculé à la volée).
export async function getCaisseJour(livreurId: string, jour: Date = new Date()) {
  const commandes = await prisma.commande.findMany({
    where: {
      livreurId,
      statut: 'livre',
      dateLivraison: { gte: debutJour(jour), lte: finJour(jour) },
    },
    include: { marchand: { select: { nomBoutique: true } } },
    orderBy: { dateLivraison: 'desc' },
  });
  const total = commandes.reduce((somme, c) => somme + Number(c.montantCod), 0);
  return { commandes, total };
}
