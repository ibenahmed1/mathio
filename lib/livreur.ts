import { prisma } from '@/lib/prisma';
import { estColisARecuperer } from '@/lib/bon-distribution';
import { STATUTS_TERMINAUX } from '@/lib/statuts';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommande } from '@/app/generated/prisma/enums';

const commandeListeInclude = {
  marchand: { select: { nomBoutique: true } },
  hubActuel: { select: { ville: true } },
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
const STATUTS_RETOUR: StatutCommande[] = [
  'retourne',
  // § Clôture de tournée : colis rentré au dépôt après une tentative
  // infructueuse — il compte bien comme un retour dans le taux du livreur.
  'retourne_au_hub',
  'refuse',
  'en_retour_par_amana',
  'annule',
  'annule_par_vendeur',
];

export interface FiltresColisLivreur {
  etat?: 'facture';
  statut?: StatutCommande;
  dateDebut?: Date;
  dateFin?: Date;
  reporteAujourdhui?: boolean;
}

// § /livreur/colis : colis assignés au livreur connecté, pas seulement la
// tournée du jour (cf. spec module livreur) — le filtre Date permet de revenir
// au périmètre "tournée d'un jour donné".
//
// § Clôture de tournée : les colis d'une tournée CLÔTURÉE en sont exclus.
// Une fois le circuit déchargé et fermé par le Planner, il disparaît de
// l'application du livreur — colis compris — et son interface se remet à zéro
// pour la tournée suivante. Rien n'est supprimé pour autant : le détail de la
// tournée close et les gains associés restent consultables sur
// /livreur/bons-distribution, qui est justement l'écran d'historique et de
// solde à payer.
export async function getColisLivreur(livreurId: string, filtres: FiltresColisLivreur = {}): Promise<CommandeListeLivreur[]> {
  const where: Prisma.CommandeWhereInput = {
    livreurId,
    // Un colis sans Bon de Distribution n'appartient à aucun circuit : il n'a
    // rien à voir avec une clôture et reste visible.
    OR: [{ bonDistributionId: null }, { bonDistribution: { statut: { not: 'cloture' } } }],
  };

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
// la plage de dates. C'est une STATISTIQUE d'activité sur une période, pas la
// feuille de route : les tournées clôturées y restent comptées, sinon
// l'historique de performance du livreur se viderait à chaque clôture. Elles
// sont simplement isolées dans leur propre compteur — sans quoi
// nouveau + enCours ne totalise plus `total` dès la première clôture, et le
// donut de l'accueil sous-compte silencieusement.
// `hubId` NULL : compte sans rattachement — une société de livraison
// (§ hubRequis, lib/comptes-livreur.ts). La restriction au hub tombe alors au
// lieu de faire échouer l'appel ; elle ne servait qu'à cantonner un livreur
// interne aux tournées de son quai, et une société n'en a aucune de toute
// façon. Le filtre sur `livreurId`, lui, ne bouge pas.
export async function getStatsBonsDistributionLivreur(
  livreurId: string,
  hubId: string | null,
  dateDebut: Date,
  dateFin: Date
) {
  const bons = await prisma.bonDistribution.findMany({
    where: {
      livreurId,
      ...(hubId ? { hubId } : {}),
      dateGeneration: { gte: debutJour(dateDebut), lte: finJour(dateFin) },
    },
    select: { statut: true, nbColis: true },
  });

  const total = bons.length;
  const nouveau = bons.filter((b) => b.statut === 'nouveau').length;
  const enCours = bons.filter((b) => b.statut === 'en_cours').length;
  const cloture = bons.filter((b) => b.statut === 'cloture').length;
  const nbColisTotal = bons.reduce((somme, b) => somme + b.nbColis, 0);

  return { total, nouveau, enCours, cloture, nbColisTotal };
}

// § /livreur/bons-paiement : cash que le livreur a ENCORE EN MAIN — colis
// livrés aujourd'hui dont la tournée n'a pas encore été déchargée. Le CRBT se
// déduit de la somme de leur montantCod (pas de modèle "Caisse" dédié, cf.
// Transaction pour la comptabilité interne qui vit à un tout autre niveau —
// celui-ci est propre au livreur et calculé à la volée).
//
// Les colis d'une tournée clôturée en sont exclus : à la clôture, le livreur a
// remis 100 % de ce cash au Planner (§ POST .../cloturer, qui écrit la
// Transaction d'entrée de caisse). Les laisser ici afficherait comme "en
// caisse" un argent déjà rendu — et ferait double compte si le livreur
// repart en tournée dans la même journée.
export async function getCaisseJour(livreurId: string, jour: Date = new Date()) {
  const commandes = await prisma.commande.findMany({
    where: {
      livreurId,
      statut: 'livre',
      dateLivraison: { gte: debutJour(jour), lte: finJour(jour) },
      OR: [{ bonDistributionId: null }, { bonDistribution: { statut: { not: 'cloture' } } }],
    },
    include: { marchand: { select: { nomBoutique: true } } },
    orderBy: { dateLivraison: 'desc' },
  });
  const total = commandes.reduce((somme, c) => somme + Number(c.montantCod), 0);
  return { commandes, total };
}

// ============================================================
// § /livreur/colis — feuille de route (tournées ouvertes)
// ============================================================

// Une tournée sort de la feuille de route du livreur dès qu'elle est
// clôturée par le Planner (§ /admin/bon-distribution/[id]/cloture) : c'est le
// statut du Bon de Distribution qui fait foi, JAMAIS celui des colis — un
// colis livré reste visible sur la tournée du jour tant qu'elle n'est pas
// déchargée, et rien n'est effacé côté historique (la fiche colis conserve
// tout, cf. HistoriqueStatutCommande).
const commandeTourneeInclude = {
  marchand: { select: { nomBoutique: true } },
  bonDistribution: { select: { id: true, numero: true, dateGeneration: true, hub: { select: { nom: true } } } },
  // § Comptes transporteurs : un colis confié à une société de livraison n'a
  // PAS de tournée — il vient d'un bon d'envoi. C'est ce bon qui situe le
  // colis dans son écran, à la place du numéro de tournée.
  bonEnvoi: { select: { id: true, numero: true, statut: true, dateReception: true } },
  // Ville du hub où le colis se trouve physiquement : c'est elle qui complète
  // le libellé « Retourné au Hub (Casablanca) » (cf. StatutBadge) — le nom du
  // hub de la tournée ne convient pas, ce n'est pas la même donnée.
  hubActuel: { select: { ville: true } },
} satisfies Prisma.CommandeInclude;

export type CommandeTourneeLivreur = Prisma.CommandeGetPayload<{ include: typeof commandeTourneeInclude }>;

export interface TourneeOuverte {
  id: string;
  numero: string;
  dateGeneration: Date;
  hubNom: string;
  nbColis: number;
}

// § Comptes transporteurs : un bon d'envoi PRIS EN CHARGE par la société dont
// ce compte est le compte humain. C'est l'équivalent d'une tournée pour un
// livreur interne — l'unité dans laquelle des colis lui ont été confiés.
export interface BonConfieTransporteur {
  id: string;
  numero: string;
  dateReception: Date | null;
  nbColis: number;
}

export interface FeuilleDeRouteLivreur {
  tournees: TourneeOuverte[];
  // Vide pour un livreur interne, rempli pour une société de livraison. Les
  // deux sources coexistent dans le même écran : ce qui compte pour celui qui
  // regarde, c'est la liste de colis, pas leur provenance administrative.
  bonsConfies: BonConfieTransporteur[];
  colis: CommandeTourneeLivreur[];
  // Récapitulatif de session recalculé à chaque appel — c'est le même
  // décompte que celui présenté au Planner à la clôture (§ getBilanTournee),
  // vu du côté livreur.
  recap: {
    nbColis: number;
    nbLivres: number;
    nbEnCours: number;
    nbARetourner: number;
    // Cash brut collecté : somme des CRBT des colis livrés. Le livreur remet
    // l'intégralité de ce montant au Planner, sans aucune déduction — ses
    // gains sont réglés par un processus comptable distinct.
    cashEncaisse: string;
  };
}

// § Comptes transporteurs — colis confiés par bon d'envoi.
//
// Le bon d'envoi n'a pas de clôture, contrairement à une tournée : rien ne
// dirait donc quand ses colis quittent l'écran, et une société finirait par
// faire défiler des mois de livraisons terminées. La règle retenue est
// l'analogue exact de « tournée non clôturée » : un bon reste à l'écran tant
// qu'il lui reste AU MOINS UN colis non clos. Le dernier colis traité fait
// disparaître le bon entier — jusque-là, la société voit ce qu'elle vient de
// faire, ce qui est précisément à quoi sert la partie « traités » de l'écran.
async function getColisConfiesAuTransporteur(livreurId: string): Promise<CommandeTourneeLivreur[]> {
  const colis = await prisma.commande.findMany({
    where: {
      livreurId,
      // Le bon doit être PRIS EN CHARGE : entre sa composition et sa remise,
      // les colis sont encore chez nous, et les afficher les donnerait pour
      // livrables alors qu'ils n'ont pas quitté le quai.
      bonEnvoi: { statut: 'recu', prestataire: { compteLivreurId: livreurId } },
    },
    include: commandeTourneeInclude,
    orderBy: [{ statut: 'asc' }, { codeSuivi: 'asc' }],
  });

  const bonsEncoreOuverts = new Set(
    colis.filter((c) => !STATUTS_TERMINAUX.includes(c.statut)).map((c) => c.bonEnvoiId)
  );
  return colis.filter((c) => bonsEncoreOuverts.has(c.bonEnvoiId));
}

export async function getFeuilleDeRouteLivreur(livreurId: string): Promise<FeuilleDeRouteLivreur> {
  // Les deux sources sont indépendantes : un compte a des tournées (livreur
  // interne) ou des bons confiés (société de livraison), et rien n'interdit
  // qu'il ait les deux — le jour où une société prendrait aussi une tournée.
  const [tournees, colisConfies] = await Promise.all([
    prisma.bonDistribution.findMany({
      where: { livreurId, statut: { not: 'cloture' } },
      select: { id: true, numero: true, dateGeneration: true, nbColis: true, hub: { select: { nom: true } } },
      orderBy: { dateGeneration: 'desc' },
    }),
    getColisConfiesAuTransporteur(livreurId),
  ]);

  const colisTournee =
    tournees.length > 0
      ? await prisma.commande.findMany({
          where: { bonDistributionId: { in: tournees.map((t) => t.id) } },
          include: commandeTourneeInclude,
          orderBy: [{ statut: 'asc' }, { codeSuivi: 'asc' }],
        })
      : [];

  const colis = [...colisTournee, ...colisConfies];

  // Un bon confié par ligne, dans l'ordre de prise en charge la plus récente —
  // reconstruit depuis les colis plutôt que par une requête de plus : ce sont
  // exactement les bons que la liste ci-dessus laisse voir, et deux requêtes
  // pourraient se contredire au bord (un bon soldé entre les deux).
  const bonsParId = new Map<string, BonConfieTransporteur>();
  for (const c of colisConfies) {
    if (!c.bonEnvoi) continue;
    const existant = bonsParId.get(c.bonEnvoi.id);
    if (existant) {
      existant.nbColis += 1;
    } else {
      bonsParId.set(c.bonEnvoi.id, {
        id: c.bonEnvoi.id,
        numero: c.bonEnvoi.numero,
        dateReception: c.bonEnvoi.dateReception,
        nbColis: 1,
      });
    }
  }
  const bonsConfies = [...bonsParId.values()].sort(
    (a, b) => (b.dateReception?.getTime() ?? 0) - (a.dateReception?.getTime() ?? 0)
  );

  const livres = colis.filter((c) => c.statut === 'livre');
  const enCours = colis.filter((c) => c.statut === 'mise_en_distribution');
  // Même règle que celle appliquée au Planner à la clôture
  // (estColisARecuperer) plutôt qu'une seconde liste de statuts à maintenir :
  // les deux décomptes doivent être le même, sinon le livreur et le dépôt ne
  // se comprennent plus au moment du déchargement. On retire seulement les
  // colis pas encore tentés, qui sont comptés à part (nbEnCours).
  const aRetourner = colis.filter((c) => estColisARecuperer(c.statut) && c.statut !== 'mise_en_distribution');
  const cashEncaisse = livres.reduce((somme, c) => somme + Number(c.montantCod), 0);

  return {
    tournees: tournees.map((t) => ({
      id: t.id,
      numero: t.numero,
      dateGeneration: t.dateGeneration,
      hubNom: t.hub.nom,
      nbColis: t.nbColis,
    })),
    bonsConfies,
    colis,
    recap: {
      nbColis: colis.length,
      nbLivres: livres.length,
      nbEnCours: enCours.length,
      // Tout ce qui n'est ni livré ni encore à tenter doit revenir au dépôt.
      nbARetourner: aRetourner.length,
      cashEncaisse: cashEncaisse.toFixed(2),
    },
  };
}

// ============================================================
// § /livreur (Accueil) — courbe de volume
// ============================================================

// Un jour de la courbe de l'Accueil livreur. `label` est déjà formaté pour
// l'axe (jj/mm) : le composant dessine, il ne met pas en forme des dates.
export interface VolumeJourLivreur {
  label: string;
  // Colis qui lui ont été confiés ce jour-là (dateCreation) et colis qu'il a
  // effectivement livrés (dateLivraison) — deux dates distinctes, donc deux
  // séries : un colis reçu lundi et livré mercredi compte une fois dans
  // chacune, aux deux jours qui lui reviennent.
  recus: number;
  livres: number;
}

// Clé de regroupement en heure LOCALE. `toISOString().slice(0,10)` (ce
// qu'utilise le tableau de bord du back-office) rangerait un colis livré à 23 h
// à Casablanca dans le seau du lendemain en hiver, et de l'avant-veille au
// petit matin en été : les bornes de la plage, elles, sont posées en local
// (debutJour/finJour). Les deux doivent parler du même jour.
function cleJourLocal(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

// § /livreur (Accueil), graphe principal : volume jour par jour sur la plage
// sélectionnée. Les jours SANS mouvement sont produits à zéro plutôt
// qu'omis — une courbe qui saute les jours creux resserre l'axe et fait passer
// une semaine morte pour une activité continue.
export async function getVolumeParJourLivreur(
  livreurId: string,
  dateDebut: Date,
  dateFin: Date
): Promise<VolumeJourLivreur[]> {
  const debut = debutJour(dateDebut);
  const fin = finJour(dateFin);

  const commandes = await prisma.commande.findMany({
    where: {
      livreurId,
      // Un OR et non un ET : les deux séries ne portent pas sur la même date,
      // un colis n'a aucune raison d'entrer dans la plage par les deux bouts.
      OR: [{ dateCreation: { gte: debut, lte: fin } }, { dateLivraison: { gte: debut, lte: fin } }],
    },
    select: { dateCreation: true, dateLivraison: true },
  });

  const seaux = new Map<string, VolumeJourLivreur>();
  for (const curseur = new Date(debut); curseur <= fin; curseur.setDate(curseur.getDate() + 1)) {
    seaux.set(cleJourLocal(curseur), {
      label: `${String(curseur.getDate()).padStart(2, '0')}/${String(curseur.getMonth() + 1).padStart(2, '0')}`,
      recus: 0,
      livres: 0,
    });
  }

  for (const commande of commandes) {
    const seauRecu = seaux.get(cleJourLocal(commande.dateCreation));
    if (seauRecu) seauRecu.recus += 1;
    if (commande.dateLivraison) {
      const seauLivre = seaux.get(cleJourLocal(commande.dateLivraison));
      if (seauLivre) seauLivre.livres += 1;
    }
  }

  return [...seaux.values()];
}
