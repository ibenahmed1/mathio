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
