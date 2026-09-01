import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import type { Role } from '@/app/generated/prisma/enums';

export const ROLES_BACKOFFICE_TACHES: Role[] = [
  'admin',
  'superviseur',
  'moderateur',
  'equipe_suivi',
  'responsable',
  'design',
  'gestionnaire_hub',
];

// Rôles cantonnés au Kanban (design, gestionnaire_hub) : ne peuvent agir que
// sur les tâches qu'ils ont créées ou qui leur sont attribuées (§ workflow
// exécutants — création, description/pièces jointes, déplacement des cartes
// attribuées) — les autres rôles back-office gardent un accès complet.
export function peutModifierTache(
  session: { sub: string; role: Role },
  tache: { assigneeId: string | null; createurId: string }
) {
  if (!ROLES_KANBAN_UNIQUEMENT.includes(session.role)) return true;
  return tache.assigneeId === session.sub || tache.createurId === session.sub;
}

// ------------------------------------------------------------------
// Cloisonnement par board (§ /admin/tasks)
// ------------------------------------------------------------------
// Chacun ne voit que les tâches des pôles dont il est membre ; l'admin voit
// tout le tableau. Le cloisonnement est appliqué CÔTÉ SERVEUR, dans le `where`
// des requêtes et à l'entrée de chaque route par identifiant : filtrer côté
// client aurait laissé n'importe quel appel direct à l'API lire les tâches des
// autres pôles.
//
// Convention de retour : `null` = aucune restriction (admin), sinon la liste —
// éventuellement vide — des pôles autorisés. Une liste vide est un cas normal
// (compte rattaché à aucun pôle) et doit donner un tableau vide, pas un accès
// total : c'est pourquoi on ne peut pas se contenter d'un tableau et traiter
// « vide » comme « pas de filtre ».
export async function boardsVisibles(session: { sub: string; role: Role }): Promise<string[] | null> {
  if (session.role === 'admin') return null;
  const liens = await prisma.equipeTacheMembre.findMany({
    where: { utilisateurId: session.sub },
    select: { equipeId: true },
  });
  return liens.map((l) => l.equipeId);
}

export function boardAutorise(scope: string[] | null, teamId: string): boolean {
  return scope === null || scope.includes(teamId);
}

// Refus uniforme quand une tâche (ou un pôle) sort du périmètre : 404 plutôt
// que 403, pour ne pas révéler l'existence des tâches des autres pôles.
export function exigerBoardAutorise(scope: string[] | null, teamId: string): void {
  if (!boardAutorise(scope, teamId)) throw new ApiError(404, 'Tâche introuvable');
}

// Rôles NON cloisonnés pour l'assignation (§ /admin/tasks) : l'encadrement
// projet doit pouvoir attribuer une tâche à n'importe qui, y compris dans un
// pôle dont il ne fait pas partie — un chef de projet arbitre des charges
// qu'il ne porte pas lui-même.
//
// À ne pas confondre avec boardsVisibles ci-dessus, qui régit la LECTURE du
// tableau et reste, elle, réservée à l'admin : voir toutes les tâches et
// pouvoir désigner quelqu'un hors de son pôle sont deux droits différents.
export const ROLES_ASSIGNATION_TOUS_POLES: Role[] = ['admin', 'responsable', 'superviseur'];

export function peutAssignerHorsPole(role: Role): boolean {
  return ROLES_ASSIGNATION_TOUS_POLES.includes(role);
}

// Contrepartie serveur du menu « Assigné » : hors encadrement, on ne peut
// désigner qu'un membre du board de la tâche. Sans cette vérification, la
// liste filtrée côté client ne serait qu'un habillage — un POST forgé
// attribuerait la tâche à n'importe qui.
export async function exigerAssigneAutorise(
  session: { role: Role },
  teamId: string,
  assigneeId: string
): Promise<void> {
  if (peutAssignerHorsPole(session.role)) return;
  const lien = await prisma.equipeTacheMembre.findFirst({
    where: { equipeId: teamId, utilisateurId: assigneeId },
    select: { id: true },
  });
  if (!lien) throw new ApiError(403, 'Cette personne ne fait pas partie du board de la tâche');
}

// ------------------------------------------------------------------
// Étiquettes (§ /admin/tasks)
// ------------------------------------------------------------------
// Les codes valides ne sont plus une constante du code mais le contenu de la
// table EtiquetteTache : la validation interroge la base à chaque écriture
// plutôt que de comparer à une liste figée.
export async function validerEtiquettes(valeur: unknown): Promise<string[]> {
  if (!Array.isArray(valeur)) throw new ApiError(400, 'etiquettes doit être un tableau de codes');
  const codes = valeur.filter((c): c is string => typeof c === 'string');
  if (codes.length !== valeur.length) throw new ApiError(400, 'etiquettes doit être un tableau de codes');
  if (codes.length === 0) return [];

  const connues = await prisma.etiquetteTache.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const existantes = new Set(connues.map((e) => e.code));
  const inconnues = codes.filter((c) => !existantes.has(c));
  if (inconnues.length > 0) {
    throw new ApiError(400, `étiquettes inconnues : ${inconnues.join(', ')}`);
  }
  // Dédoublonnage : deux fois le même code sur une tâche afficherait deux
  // chips identiques.
  return Array.from(new Set(codes));
}
