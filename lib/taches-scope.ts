import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import type { Prisma } from '@/app/generated/prisma/client';
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

// Refus uniforme quand un pôle sort du périmètre : 404 plutôt que 403, pour ne
// pas révéler l'existence des tâches des autres pôles. S'applique aux
// ÉCRITURES qui visent un pôle (créer dedans, y déplacer une carte) — la
// lecture d'une tâche, elle, passe par exigerTacheAutorisee ci-dessous.
export function exigerBoardAutorise(scope: string[] | null, teamId: string): void {
  if (!boardAutorise(scope, teamId)) throw new ApiError(404, 'Tâche introuvable');
}

// Périmètre de LECTURE d'une tâche : les pôles dont on est membre, PLUS les
// tâches qui nous sont personnellement assignées.
//
// Sans ce second terme, une tâche confiée par l'encadrement à quelqu'un d'un
// autre pôle (§ ROLES_ASSIGNATION_TOUS_POLES) lui restait invisible : ni sur
// son tableau, ni sous « Mes tâches », ni par lien direct — et comme
// l'application n'envoie aucune notification, la personne n'apprenait jamais
// qu'on lui avait confié quelque chose. L'assignation était muette.
export function filtreTachesVisibles(
  session: { sub: string },
  scope: string[] | null
): Prisma.TacheWhereInput {
  if (scope === null) return {};
  return { OR: [{ teamId: { in: scope } }, { assigneeId: session.sub }] };
}

export function tacheAutorisee(
  session: { sub: string },
  scope: string[] | null,
  tache: { teamId: string; assigneeId: string | null }
): boolean {
  return scope === null || scope.includes(tache.teamId) || tache.assigneeId === session.sub;
}

export function exigerTacheAutorisee(
  session: { sub: string },
  scope: string[] | null,
  tache: { teamId: string; assigneeId: string | null }
): void {
  if (!tacheAutorisee(session, scope, tache)) throw new ApiError(404, 'Tâche introuvable');
}

// Pôles ATTEIGNABLES : ceux dont on est membre, plus ceux où l'on porte une
// tâche assignée. Sert à ce que le board d'une tâche confiée de l'extérieur
// existe bien dans la liste (sinon son couloir n'aurait nulle part où
// s'afficher) et à ce que la discussion y reste utilisable — mentionner
// quelqu'un suppose de pouvoir lister les membres du pôle.
//
// Ce n'est PAS un droit de lecture sur les autres tâches du pôle : celles-ci
// restent filtrées par filtreTachesVisibles.
export async function boardsAccessibles(session: { sub: string; role: Role }): Promise<string[] | null> {
  const membre = await boardsVisibles(session);
  if (membre === null) return null;
  const porteuses = await prisma.tache.findMany({
    where: { assigneeId: session.sub },
    select: { teamId: true },
    distinct: ['teamId'],
  });
  return Array.from(new Set([...membre, ...porteuses.map((t) => t.teamId)]));
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
