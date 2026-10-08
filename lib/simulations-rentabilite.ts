import { ApiError, requireUser } from '@/lib/api-utils';
import { sessionHasPermission, type SessionPayload } from '@/lib/auth';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { prisma } from '@/lib/prisma';
import {
  normaliserEntrees,
  normaliserNomSimulation,
  normaliserTaux,
  NOM_SIMULATION_MAX,
  type EntreesSimulation,
  type TauxChange,
} from '@/lib/simulateur-rentabilite';

// § Simulateur de rentabilité — scénarios enregistrés (/api/simulations/**).
//
// Même partage que la comptabilité (lib/comptabilite-perimetre.ts) : les
// écrans /admin/simulateur et /marchand/simulateur appellent les mêmes routes,
// et c'est ICI que se décide dans quel carnet elles lisent et écrivent :
//   back-office (permission `simulateur:use`) → marchandId = null ;
//   marchand (permission `simulateur.utiliser`) → SA boutique, résolue côté
//     serveur, jamais depuis un identifiant envoyé par le client.
//
// Un seul geste : qui ouvre le simulateur peut enregistrer, renommer et
// supprimer les scénarios de son carnet. Ce sont des hypothèses de travail,
// pas des pièces comptables — il n'y a ni historique ni corbeille.

// Plafond par carnet : un garde-fou contre un script qui boucle, pas une
// limite d'usage (un marchand compare quelques produits, pas des centaines).
export const MAX_SIMULATIONS_PAR_CARNET = 200;

export interface PerimetreSimulations {
  session: SessionPayload;
  marchandId: string | null;
}

export async function perimetreSimulations(): Promise<PerimetreSimulations> {
  const session = await requireUser();
  const cle = session.role === 'marchand' ? 'simulateur.utiliser' : 'simulateur:use';
  if (!sessionHasPermission(session, cle)) throw new ApiError(403, 'Accès refusé : permission manquante');

  if (session.role !== 'marchand') return { session, marchandId: null };
  const marchand = await resolveMarchandForUser(session.sub);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return { session, marchandId: marchand.id };
}

export interface SimulationEnregistree {
  id: string;
  nom: string;
  entrees: EntreesSimulation;
  taux: TauxChange;
  auteur: string | null;
  dateCreation: string;
  dateModification: string;
}

const SELECTION = {
  id: true,
  nom: true,
  entrees: true,
  taux: true,
  dateCreation: true,
  dateModification: true,
  auteur: { select: { nomComplet: true } },
} as const;

interface Ligne {
  id: string;
  nom: string;
  entrees: unknown;
  taux: unknown;
  dateCreation: Date;
  dateModification: Date;
  auteur: { nomComplet: string } | null;
}

// La relecture NORMALISE : un scénario enregistré avant l'ajout d'un champ le
// reçoit avec sa valeur par défaut.
function versSortie(l: Ligne): SimulationEnregistree {
  return {
    id: l.id,
    nom: l.nom,
    entrees: normaliserEntrees(l.entrees),
    taux: normaliserTaux(l.taux),
    auteur: l.auteur?.nomComplet ?? null,
    dateCreation: l.dateCreation.toISOString(),
    dateModification: l.dateModification.toISOString(),
  };
}

function nomValide(brut: unknown): string {
  const nom = normaliserNomSimulation(brut);
  if (!nom) throw new ApiError(400, `Nom requis (${NOM_SIMULATION_MAX} caractères au plus)`);
  return nom;
}

export interface CorpsSimulation {
  nom?: unknown;
  entrees?: unknown;
  taux?: unknown;
}

export async function listerSimulations(marchandId: string | null): Promise<SimulationEnregistree[]> {
  const lignes = await prisma.simulationRentabilite.findMany({
    where: { marchandId },
    orderBy: { dateModification: 'desc' },
    select: SELECTION,
  });
  return lignes.map(versSortie);
}

export async function creerSimulation(
  { session, marchandId }: PerimetreSimulations,
  corps: CorpsSimulation,
): Promise<SimulationEnregistree> {
  const nom = nomValide(corps.nom);
  const total = await prisma.simulationRentabilite.count({ where: { marchandId } });
  if (total >= MAX_SIMULATIONS_PAR_CARNET) {
    throw new ApiError(
      409,
      `Limite de ${MAX_SIMULATIONS_PAR_CARNET} simulations atteinte : supprimez-en avant d’en ajouter.`,
    );
  }
  const ligne = await prisma.simulationRentabilite.create({
    data: {
      nom,
      entrees: { ...normaliserEntrees(corps.entrees) },
      taux: { ...normaliserTaux(corps.taux) },
      marchandId,
      auteurId: session.sub,
    },
    select: SELECTION,
  });
  return versSortie(ligne);
}

// Le filtre par carnet est DANS la requête : un identifiant d'un autre carnet
// répond 404, exactement comme un identifiant inexistant — il ne révèle pas
// qu'il existe ailleurs.
async function exigerDansCarnet(id: string, marchandId: string | null) {
  const trouvee = await prisma.simulationRentabilite.findFirst({ where: { id, marchandId }, select: { id: true } });
  if (!trouvee) throw new ApiError(404, 'Simulation introuvable');
}

export async function modifierSimulation(
  { marchandId }: PerimetreSimulations,
  id: string,
  corps: CorpsSimulation,
): Promise<SimulationEnregistree> {
  await exigerDansCarnet(id, marchandId);
  const data: { nom?: string; entrees?: object; taux?: object } = {};
  if (corps.nom !== undefined) data.nom = nomValide(corps.nom);
  if (corps.entrees !== undefined) data.entrees = { ...normaliserEntrees(corps.entrees) };
  if (corps.taux !== undefined) data.taux = { ...normaliserTaux(corps.taux) };
  const ligne = await prisma.simulationRentabilite.update({ where: { id }, data, select: SELECTION });
  return versSortie(ligne);
}

export async function supprimerSimulation({ marchandId }: PerimetreSimulations, id: string): Promise<void> {
  await exigerDansCarnet(id, marchandId);
  await prisma.simulationRentabilite.delete({ where: { id } });
}
