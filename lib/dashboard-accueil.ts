import { prisma } from '@/lib/prisma';
import { LABELS_STATUT_COMMANDE } from '@/lib/statuts';
import type { StatutCommande } from '@/app/generated/prisma/enums';
import { coordonneesVille } from '@/lib/coordonnees-villes';
import type {
  ActiviteRecente,
  BasePrestataire,
  ColisRecent,
  DashboardAccueilProps,
  FamilleStatut,
  TonColis,
  VolumeJourAccueil,
  ZoneClient,
} from '@/components/admin/DashboardAccueil';

// Alimente le tableau de bord de l'Accueil (§ components/admin/DashboardAccueil).
//
// Les types de sortie sont ceux des props du composant, importés en `import
// type` : la frontière reste à sens unique — le composant, lui, n'importe
// jamais ce module, donc ni Prisma ni la base ne partent dans le bundle client.

// Statuts qui comptent comme un échec de livraison. Sert à la fois au taux de
// retour du cadran et à la troisième tranche du donut : une seule liste, pour
// que les deux chiffres ne puissent pas diverger.
const STATUTS_RETOUR: StatutCommande[] = [
  'retourne',
  'retourne_au_hub',
  'en_retour_par_amana',
  'annule',
  'annule_par_vendeur',
  'refuse',
];

// Statuts d'un colis encore en amont de la distribution — sert au ton de la
// pilule dans la table des derniers colis.
const STATUTS_AMONT: StatutCommande[] = ['nouveau_colis', 'attente_de_ramassage', 'ramasse', 'recu'];

const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

function jourCle(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// « il y a 42 min », « 3 h », « 2 j » — calculé au serveur pour que le rendu
// soit stable : un calcul côté client donnerait un texte différent du HTML
// envoyé et déclencherait une erreur d'hydratation.
function depuis(date: Date, maintenant: Date): string {
  const minutes = Math.max(0, Math.round((maintenant.getTime() - date.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `${heures} h`;
  return `${Math.round(heures / 24)} j`;
}

// Le ton dit le MOMENT DU CYCLE, pas une couleur : le composant en tire aussi
// bien le dégradé de la pilule que l'icône du mouvement, et un changement de
// charte graphique ne redescend pas jusqu'ici.
function tonDuStatut(statut: StatutCommande): TonColis {
  if (statut === 'livre') return 'livre';
  if (STATUTS_RETOUR.includes(statut)) return 'retour';
  if (STATUTS_AMONT.includes(statut)) return 'amont';
  return 'encours';
}

// Répartition en pourcentages entiers dont la somme fait exactement 100 : les
// arrondis indépendants laissaient un trou (ou un chevauchement) dans le donut.
function parts(valeurs: number[]): number[] {
  const total = valeurs.reduce((n, v) => n + v, 0);
  if (total === 0) return valeurs.map(() => 0);
  const bruts = valeurs.map((v) => (v / total) * 100);
  const arrondis = bruts.map((b) => Math.floor(b));
  let reste = 100 - arrondis.reduce((n, v) => n + v, 0);
  // Le reliquat va aux plus fortes décimales, dans l'ordre décroissant.
  const ordre = bruts
    .map((b, i) => ({ i, frac: b - Math.floor(b) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of ordre) {
    if (reste <= 0) break;
    arrondis[i] += 1;
    reste -= 1;
  }
  return arrondis;
}

export async function chargerDashboardAccueil(): Promise<DashboardAccueilProps> {
  const maintenant = new Date();
  const debut7j = new Date(maintenant);
  debut7j.setHours(0, 0, 0, 0);
  debut7j.setDate(debut7j.getDate() - 6);

  const [
    totalColis,
    colisEnAttente,
    colisRamasses,
    demandesRamassageEnAttente,
    encaissements,
    parStatut,
    commandes7j,
    derniers,
    historique,
    parVille,
    agences,
  ] = await Promise.all([
    prisma.commande.count(),
    prisma.commande.count({ where: { statut: 'nouveau_colis' } }),
    prisma.commande.count({ where: { statut: 'ramasse' } }),
    prisma.ramassage.count({ where: { statut: 'en_attente' } }),
    // Encaissements COD : la somme du montant réclamé au destinataire sur les
    // colis effectivement livrés. C'est l'argent du marchand, pas notre marge —
    // rien à voir avec `LigneFacture.coutLivraison`, qui reste hors de cet écran.
    prisma.commande.aggregate({ _sum: { montantCod: true }, where: { statut: 'livre' } }),
    prisma.commande.groupBy({ by: ['statut'], _count: { _all: true } }),
    prisma.commande.findMany({
      where: { dateCreation: { gte: debut7j } },
      select: { dateCreation: true, statut: true },
    }),
    prisma.commande.findMany({
      orderBy: { dateCreation: 'desc' },
      take: 5,
      select: { id: true, codeSuivi: true, clientNom: true, ville: true, montantCod: true, statut: true },
    }),
    prisma.historiqueStatutCommande.findMany({
      orderBy: { horodatage: 'desc' },
      take: 6,
      select: {
        id: true,
        nouveauStatut: true,
        note: true,
        horodatage: true,
        utilisateur: { select: { nomComplet: true } },
        commande: { select: { codeSuivi: true } },
      },
    }),
    prisma.commande.groupBy({
      by: ['ville'],
      _count: { _all: true },
      orderBy: { _count: { ville: 'desc' } },
      take: 6,
    }),
    // Agences des prestataires ACTIFS : un prestataire désactivé ne reçoit plus
    // de colis, ses villes n'ont rien à faire sur la carte. Les hubs internes
    // (sans prestataire) en sont exclus par la même condition. Trié par nom de
    // prestataire : c'est l'ordre qui fixe sa couleur sur la carte.
    prisma.hub.findMany({
      where: { prestataire: { actif: true } },
      select: { nom: true, ville: true, prestataire: { select: { nom: true } } },
      orderBy: [{ prestataire: { nom: 'asc' } }, { ville: 'asc' }],
    }),
  ]);

  const compteur = (predicat: (statut: StatutCommande) => boolean) =>
    parStatut.reduce((n, ligne) => (predicat(ligne.statut) ? n + ligne._count._all : n), 0);

  const colisLivres = compteur((statut) => statut === 'livre');
  const colisRetournes = compteur((statut) => STATUTS_RETOUR.includes(statut));
  const colisEnCours = totalColis - colisLivres - colisRetournes;

  const valeursFamilles = [colisEnCours, colisLivres, colisRetournes];
  const partsFamilles = parts(valeursFamilles);
  const familles: FamilleStatut[] = ['En cours', 'Livrés', 'Retours'].map((label, i) => ({
    label,
    valeur: valeursFamilles[i],
    part: partsFamilles[i],
  }));

  // Sept seaux journaliers, créés avant le comptage pour qu'un jour sans aucun
  // colis apparaisse quand même sur la courbe — sinon elle se contracterait.
  const seaux = new Map<string, { nouveaux: number; ramasses: number; livres: number }>();
  const jours: { cle: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(debut7j);
    d.setDate(d.getDate() + i);
    const cle = jourCle(d);
    jours.push({ cle, label: JOURS[d.getDay()] });
    seaux.set(cle, { nouveaux: 0, ramasses: 0, livres: 0 });
  }
  for (const c of commandes7j) {
    const seau = seaux.get(jourCle(c.dateCreation));
    if (!seau) continue;
    // « Nouveaux » compte tout colis créé ce jour-là ; les deux autres séries
    // disent où en sont AUJOURD'HUI les colis créés ce jour-là. C'est le seul
    // découpage que la donnée permette sans index sur `dateLivraison`.
    seau.nouveaux += 1;
    if (c.statut === 'livre') seau.livres += 1;
    else if (c.statut === 'ramasse') seau.ramasses += 1;
  }
  const volume7j: VolumeJourAccueil[] = jours.map(({ cle, label }) => ({
    label,
    ...(seaux.get(cle) ?? { nouveaux: 0, ramasses: 0, livres: 0 }),
  }));

  const colisRecents: ColisRecent[] = derniers.map((c) => ({
    id: c.id,
    codeSuivi: c.codeSuivi,
    client: c.clientNom,
    ville: c.ville,
    montantCod: Number(c.montantCod),
    statut: LABELS_STATUT_COMMANDE[c.statut],
    ton: tonDuStatut(c.statut),
  }));

  const activites: ActiviteRecente[] = historique.map((h) => ({
    id: h.id,
    titre: LABELS_STATUT_COMMANDE[h.nouveauStatut],
    depuis: depuis(h.horodatage, maintenant),
    qui: h.utilisateur.nomComplet,
    action: h.note ?? `a fait passer ${h.commande.codeSuivi} à « ${LABELS_STATUT_COMMANDE[h.nouveauStatut]} »`,
    ton: tonDuStatut(h.nouveauStatut),
  }));

  const zones: ZoneClient[] = parVille.map((v) => ({
    nom: v.ville,
    valeur: v._count._all,
    part: totalColis === 0 ? 0 : Math.round((v._count._all / totalColis) * 100),
  }));

  // Une ville absente du référentiel de coordonnées n'est pas placée au jugé :
  // elle remonte à part, et la carte dit combien d'agences lui manquent.
  const basesPrestataires: BasePrestataire[] = [];
  const basesNonPlacees: string[] = [];
  for (const agence of agences) {
    const position = coordonneesVille(agence.ville);
    if (!position) {
      basesNonPlacees.push(agence.nom);
      continue;
    }
    basesPrestataires.push({
      agence: agence.nom,
      ville: agence.ville,
      prestataire: agence.prestataire?.nom ?? '',
      longitude: position.longitude,
      latitude: position.latitude,
    });
  }

  return {
    totalColis,
    colisLivres,
    tauxRetour: totalColis === 0 ? 0 : (colisRetournes / totalColis) * 100,
    // `montantCod` est un Decimal(10,2) : converti ici, à la frontière de lib/,
    // pour qu'aucun Decimal brut ne remonte jusqu'au composant.
    encaissementsCod: Number(encaissements._sum.montantCod ?? 0),
    colisEnAttente,
    colisRamasses,
    demandesRamassageEnAttente,
    volume7j,
    familles,
    colisRecents,
    activites,
    zones,
    basesPrestataires,
    basesNonPlacees,
  };
}
