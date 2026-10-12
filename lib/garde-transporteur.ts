import { ApiError, requirePermission } from '@/lib/api-utils';
import { ROLES_HUB_UNIQUEMENT, roleMatches, type SessionPayload } from '@/lib/auth';

// § Pilotage transporteur (remise d'un bon d'envoi, relivraison, retour,
// modification, actualisation chez Power / Colivraison / Meta / EST).
// `bon_envoi:manage` est aussi la clé de l'agent de quai (agent_hub), qui
// consulte et réceptionne les bons de SON hub : seule, elle lui ouvrait ces
// gestes sur n'importe quel bon ou colis du réseau, avec un effet externe
// facturé et irréversible chez le transporteur. Ces gestes lui sont fermés,
// comme `marquer-recu` lui ferme déjà les bons sous-traités.
export async function requirePilotageTransporteur(): Promise<SessionPayload> {
  const session = await requirePermission('bon_envoi:manage');
  if (session.role !== 'admin' && roleMatches(session, ROLES_HUB_UNIQUEMENT)) {
    throw new ApiError(403, "L'agent de hub ne pilote pas les remises transporteur");
  }
  return session;
}
