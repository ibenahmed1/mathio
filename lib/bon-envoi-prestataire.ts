import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { chargerResolveurTransporteur, cleRoutage, hubCentralId, refusTransporteur } from '@/lib/hub-envoi';
import { nextBonEnvoiNumero } from '@/lib/codes';
import { STATUTS_COMMANDE, STATUTS_TERMINAUX } from '@/lib/statuts';
import type { TransporteurVille } from '@/lib/bon-envoi-groupes';
import type { Prisma } from '@/app/generated/prisma/client';
import type { StatutCommande } from '@/app/generated/prisma/enums';

// § /admin/bon-envoi/creer, mode « Remise à un transporteur » — le pendant
// sous-traité de lib/hub-envoi.ts (transit interne). Les deux modules ne
// partagent volontairement PAS leur règle d'éligibilité :
//
//   - un transit interne est un fait géographique : la ville du colis désigne
//     le quai d'arrivée, l'opérateur ne fait que confirmer ;
//   - une remise sous-traitée est un arbitrage commercial : c'est l'opérateur
//     qui décide à qui confier le colis, et rien dans le référentiel ne doit
//     décider à sa place.
//
// Depuis la mise en production (11/10/2026), la carte « quel transporteur
// dessert quelle ville » est FIGÉE (référentiel validé, § hubs régionaux) : un
// colis ne peut plus entrer dans le bon d'un transporteur qui ne dessert pas
// sa ville. Le transporteur prévu est celui que résout
// `chargerResolveurTransporteur` (lib/hub-envoi.ts) — la même réponse que le
// transit vers un hub, la réception au quai et la fiche colis. Le refus est
// posé côté serveur (revaliderColisPrestataire, verifier-colis) : l'écran ne
// fait que le prévenir.

function arrondi(valeur: number): number {
  return Number(valeur.toFixed(2));
}

// Les statuts proposés par défaut : le colis existe et n'est pas encore parti.
// `nouveau_colis` en fait partie — un colis peut être confié à un transporteur
// avant tout passage par un de nos quais, c'est même le cas courant quand le
// prestataire ramasse lui-même.
export const STATUTS_RECUS_ENVOI: StatutCommande[] = ['nouveau_colis', 'ramasse', 'recu', 'recu_au_hub'];

// Avec « afficher tous les colis expédiables », seuls les statuts TERMINAUX
// restent écartés (§ STATUTS_TERMINAUX, lib/statuts.ts) : un colis livré,
// retourné ou annulé n'a plus rien à faire dans un bon d'envoi, et l'y mettre
// corromprait son historique sans rien apporter au test. C'est la seule
// restriction de statut qui subsiste.
export function statutsEligiblesPrestataire(tousStatuts: boolean): StatutCommande[] {
  if (!tousStatuts) return STATUTS_RECUS_ENVOI;
  return STATUTS_COMMANDE.filter((s) => !STATUTS_TERMINAUX.includes(s));
}

const colisInclude = {
  marchand: { select: { nomBoutique: true } },
  hubActuel: { select: { id: true, nom: true } },
} satisfies Prisma.CommandeInclude;

export type CommandeEligiblePrestataire = Prisma.CommandeGetPayload<{ include: typeof colisInclude }>;

export interface ColisEligiblePrestataire {
  commande: CommandeEligiblePrestataire;
  // Tarif d'ACHAT de la livraison chez le prestataire interrogé. NULL = sa
  // grille ne connaît pas cette ville. Jamais 0 : zéro dirait « gratuit » et
  // gonflerait la marge d'un montant inventé (§ Facture.nbLignesCoutInconnu).
  tarifAchat: number | null;
  // Le transporteur PRÉVU pour ce colis (§ chargerResolveurTransporteur) :
  // un seul élément, ou vide si sa ville n'est desservie par personne. Gardé
  // sous forme de liste pour le regroupement de l'écran (bon-envoi-groupes).
  transporteursVille: TransporteurVille[];
  hubPrevuNom: string | null;
}

// Grille d'achat d'un prestataire, indexée par ville normalisée.
//
// Un même nom de ville peut apparaître plusieurs fois chez un prestataire —
// une ligne par agence qui la déclare, à des prix parfois différents. On
// retient alors le tarif le PLUS ÉLEVÉ : se tromper vers le haut fait
// apparaître une marge plus prudente que la réalité, se tromper vers le bas
// la gonfle. Entre deux approximations, garder celle qui ne fait pas croire à
// un gain inexistant.
export async function tarifsAchatParVille(prestataireId: string): Promise<Map<string, number>> {
  const lignes = await prisma.tarifPrestataireVille.findMany({
    where: { prestataireId },
    select: { tarifLivraison: true, ville: { select: { nom: true } } },
  });

  const index = new Map<string, number>();
  for (const ligne of lignes) {
    // Clé de ROUTAGE et non simple normalisation : « Nador » saisi par le
    // marchand doit retrouver « Nador Ville » de la grille EST.
    const cle = cleRoutage(ligne.ville.nom);
    const tarif = arrondi(Number(ligne.tarifLivraison));
    const dejaLa = index.get(cle);
    index.set(cle, dejaLa === undefined ? tarif : Math.max(dejaLa, tarif));
  }
  return index;
}

export type { TransporteurVille };

export interface OptionsColisEligibles {
  // Hub où le colis se trouve PHYSIQUEMENT (Commande.hubActuelId), pas sa
  // destination : « tous les colis reçus à Casa », quelle que soit leur ville
  // de livraison. Absent = aucun filtre de position.
  hubActuelId?: string | null;
  tousStatuts?: boolean;
  // Renseigné = chaque colis porte le tarif d'achat de ce prestataire.
  prestataireId?: string | null;
}

// Un colis déjà rattaché à un bon d'envoi reste exclu, quel que soit le mode :
// deux bons portant le même colis le feraient partir deux fois et rendraient
// `BonEnvoi.nbColis` faux. C'est un invariant de données, pas une commodité.
export async function getColisEligiblesPrestataire(
  options: OptionsColisEligibles = {}
): Promise<ColisEligiblePrestataire[]> {
  const statuts = statutsEligiblesPrestataire(options.tousStatuts === true);

  // Un colis parti en tournée chez un de nos livreurs (bon de distribution
  // encore ouvert) est physiquement dans une camionnette : le confier à un
  // transporteur le ferait exister à deux endroits.
  const conditions: Prisma.CommandeWhereInput[] = [
    { OR: [{ bonDistributionId: null }, { bonDistribution: { statut: 'cloture' } }] },
  ];

  if (options.hubActuelId) {
    const central = await hubCentralId();
    // Un colis jamais scanné (hubActuelId null) est réputé à l'entrepôt
    // central, même convention que lib/hub-envoi.ts — sans quoi les colis de
    // stock seraient invisibles depuis le filtre du hub central.
    conditions.push({
      OR:
        options.hubActuelId === central
          ? [{ hubActuelId: options.hubActuelId }, { hubActuelId: null }]
          : [{ hubActuelId: options.hubActuelId }],
    });
  }

  const where: Prisma.CommandeWhereInput = {
    bonEnvoiId: null,
    statut: { in: statuts },
    AND: conditions,
  };

  const [commandes, tarifs, resoudre] = await Promise.all([
    prisma.commande.findMany({ where, include: colisInclude, orderBy: { dateCreation: 'asc' } }),
    options.prestataireId ? tarifsAchatParVille(options.prestataireId) : Promise.resolve(null),
    chargerResolveurTransporteur(),
  ]);

  return commandes.map((commande) => {
    const prevu = resoudre(commande);
    return {
      commande,
      tarifAchat: tarifs?.get(cleRoutage(commande.ville)) ?? null,
      transporteursVille:
        prevu?.prestataireId && prevu.prestataireNom ? [{ id: prevu.prestataireId, nom: prevu.prestataireNom }] : [],
      hubPrevuNom: prevu?.hubNom ?? null,
    };
  });
}

export interface ColisEligibleDto {
  id: string;
  codeSuivi: string;
  ville: string;
  statut: StatutCommande;
  clientNom: string;
  clientTelephone: string;
  montantCod: number;
  marchandNom: string | null;
  hubActuelNom: string | null;
  tarifAchat: number | null;
  transporteursVille: TransporteurVille[];
  hubPrevuNom: string | null;
}

// Forme envoyée à l'écran. `montantCod` est converti ici, à la frontière de
// `lib/` : un Decimal Prisma sérialisé tel quel arriverait en chaîne côté
// client, et se comparerait alors comme du texte.
export function enDtoColisEligible(colis: ColisEligiblePrestataire): ColisEligibleDto {
  const { commande } = colis;
  return {
    id: commande.id,
    codeSuivi: commande.codeSuivi,
    ville: commande.ville,
    statut: commande.statut,
    clientNom: commande.clientNom,
    clientTelephone: commande.clientTelephone,
    montantCod: arrondi(Number(commande.montantCod)),
    marchandNom: commande.marchand?.nomBoutique ?? null,
    hubActuelNom: commande.hubActuel?.nom ?? null,
    tarifAchat: colis.tarifAchat,
    transporteursVille: colis.transporteursVille,
    hubPrevuNom: colis.hubPrevuNom,
  };
}

// Le regroupement par transporteur vit dans lib/bon-envoi-groupes.ts, module
// PUR : il est appelé depuis le navigateur, et ce fichier-ci importe Prisma.
export { regrouperParTransporteur, GROUPE_AUCUN, GROUPE_PLUSIEURS } from '@/lib/bon-envoi-groupes';

export interface HubSourceColis {
  id: string;
  nom: string;
  estCentral: boolean;
  prestataireNom: string | null;
  nbColisEligibles: number;
}

// § Étape 2 du mode transporteur : « où sont les colis ». Tous les hubs sont
// listés, y compris ceux à zéro — un compteur vide est une information, une
// ligne absente est une énigme.
export async function getHubsSourceColis(tousStatuts: boolean): Promise<HubSourceColis[]> {
  const [hubs, central, colis] = await Promise.all([
    prisma.hub.findMany({
      orderBy: { nom: 'asc' },
      select: { id: true, nom: true, isCentral: true, prestataire: { select: { nom: true } } },
    }),
    hubCentralId(),
    getColisEligiblesPrestataire({ tousStatuts }),
  ]);

  const compteurs = new Map<string, number>();
  for (const { commande } of colis) {
    const cle = commande.hubActuelId ?? central;
    if (!cle) continue;
    compteurs.set(cle, (compteurs.get(cle) ?? 0) + 1);
  }

  return hubs.map((h) => ({
    id: h.id,
    nom: h.nom,
    estCentral: h.isCentral,
    prestataireNom: h.prestataire?.nom ?? null,
    nbColisEligibles: compteurs.get(h.id) ?? 0,
  }));
}

export interface TransporteurDisponible {
  id: string;
  nom: string;
  nbVillesTarifees: number;
  nbAgences: number;
}

// § Étape 1 du mode transporteur. `nbVillesTarifees` n'est pas décoratif :
// c'est lui qui dit si la grille d'achat de ce prestataire a déjà été chargée
// — un transporteur à zéro ville tarifée reste sélectionnable, mais tous ses
// colis remonteront à coût inconnu.
export async function getTransporteursDisponibles(): Promise<TransporteurDisponible[]> {
  const prestataires = await prisma.prestataire.findMany({
    where: { actif: true },
    orderBy: { nom: 'asc' },
    select: { id: true, nom: true, _count: { select: { tarifs: true, agences: true } } },
  });

  return prestataires.map((p) => ({
    id: p.id,
    nom: p.nom,
    nbVillesTarifees: p._count.tarifs,
    nbAgences: p._count.agences,
  }));
}

// Revalide côté serveur les colis soumis : l'écran a pu vieillir entre son
// chargement et le clic (colis pris dans un autre bon, statut changé). Même
// principe que la création d'un bon de transit interne.
//
// Et surtout : chaque colis doit partir chez CE transporteur. Un seul colis
// d'une autre ville refuse tout l'envoi, avec la liste des fautifs — mieux
// vaut un bon refusé qu'un colis remis au mauvais réseau.
export async function revaliderColisPrestataire(
  colisIds: string[],
  tousStatuts: boolean,
  prestataire: { id: string; nom: string }
): Promise<CommandeEligiblePrestataire[]> {
  const eligibles = await getColisEligiblesPrestataire({ tousStatuts });
  const parId = new Map(eligibles.map((e) => [e.commande.id, e.commande]));

  const retenus = colisIds
    .map((id) => parId.get(id))
    .filter((c): c is CommandeEligiblePrestataire => Boolean(c));

  if (retenus.length !== colisIds.length) {
    throw new ApiError(
      409,
      "Un ou plusieurs colis sélectionnés ne sont plus disponibles : déjà pris dans un autre Bon d'Envoi, partis en tournée, ou passés à un statut terminal entre-temps"
    );
  }

  const resoudre = await chargerResolveurTransporteur();
  const refus = retenus
    .map((c) => refusTransporteur(c, resoudre(c), prestataire))
    .filter((m): m is string => m !== null);
  if (refus.length > 0) {
    const liste = refus.slice(0, 5).join(' · ');
    const reste = refus.length > 5 ? ` · et ${refus.length - 5} autre(s)` : '';
    throw new ApiError(409, `${refus.length} colis ne partent pas chez ${prestataire.nom} : ${liste}${reste}`);
  }
  return retenus;
}

export interface BonEnvoiPrestataireCree {
  id: string;
  numero: string;
  nbColis: number;
}

export async function creerBonEnvoiPrestataire(params: {
  prestataireId: string;
  colisIds: string[];
  auteurId: string;
  tousStatuts: boolean;
}): Promise<BonEnvoiPrestataireCree> {
  const prestataire = await prisma.prestataire.findUnique({
    where: { id: params.prestataireId },
    // `compteLivreurId` : le compte humain du transporteur, s'il en a un
    // (§ Prestataire.compteLivreurId). C'est ce qui décide si les colis de ce
    // bon lui sont affectés — voir l'écriture dans la transaction ci-dessous.
    select: { id: true, nom: true, compteLivreurId: true },
  });
  if (!prestataire) throw new ApiError(400, 'Transporteur introuvable');

  const colis = await revaliderColisPrestataire(params.colisIds, params.tousStatuts, prestataire);

  return prisma.$transaction(async (tx) => {
    const numero = await nextBonEnvoiNumero(tx);

    const bon = await tx.bonEnvoi.create({
      data: { numero, prestataireId: prestataire.id, nbColis: colis.length },
      select: { id: true, numero: true, nbColis: true },
    });

    await tx.commande.updateMany({
      where: { id: { in: colis.map((c) => c.id) } },
      // `livreurId` est posé ICI, à la composition du bon, et non à sa
      // réception : confier un colis à tel transporteur est une décision, et
      // c'est au moment où on la prend que la question « qui livre ce colis »
      // doit avoir une réponse lisible SUR LE COLIS. La réception ne fait
      // ensuite que le rendre visible dans son espace.
      //
      // `null` quand le transporteur n'a pas de compte : la colonne est alors
      // remise à vide plutôt que laissée telle quelle, sinon un colis repris
      // d'un bon annulé garderait l'affectation du précédent.
      data: { bonEnvoiId: bon.id, statut: 'en_transit', livreurId: prestataire.compteLivreurId },
    });

    // hubId = le hub d'où le colis PART, et non une destination : un bon
    // sous-traité n'en a pas. C'est ce qui rend l'historique relisible plus
    // tard (« parti de Casa chez X »).
    await tx.historiqueStatutCommande.createMany({
      data: colis.map((c) => ({
        commandeId: c.id,
        ancienStatut: c.statut,
        nouveauStatut: 'en_transit' as const,
        utilisateurId: params.auteurId,
        hubId: c.hubActuelId,
        note: `Colis confié au transporteur ${prestataire.nom} via le Bon d'Envoi ${numero}`,
      })),
    });

    return bon;
  });
}
