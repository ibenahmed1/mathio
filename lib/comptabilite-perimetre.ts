import { ApiError, requireUser } from '@/lib/api-utils';
import { sessionHasPermission, type SessionPayload } from '@/lib/auth';
import { resolveMarchandForUser } from '@/lib/marchand-scope';

// § Comptabilité — QUEL LIVRE l'utilisateur connecté tient-il, et QUEL GESTE
// peut-il y faire ?
//
// Les écrans /admin/comptabilite et /marchand/comptabilite appellent les mêmes
// routes (/api/finance/**, /api/commandes-stock-hub/**) : c'est ici, et
// seulement ici, que se décide dans quels livres elles lisent et écrivent.
//
//   back-office (admin, responsable, ou rôle détenant la permission)
//     → marchandId = null : les livres de la plateforme ;
//   marchand (titulaire ou membre d'équipe)
//     → marchandId = SA boutique, résolue côté serveur — jamais depuis un
//       identifiant envoyé par le client.
//
// Le rôle `marchand` tranche, pas la permission : un rôle back-office admis
// par permission reste dans les livres de la plateforme.
//
// Les quatre gestes sont ceux du back-office, chacun avec sa clé de chaque
// côté. Le proxy exige déjà la bonne clé (lib/permission-routes.ts,
// lib/permissions-marchand.ts) ; ce contrôle le double pour un appel qui ne
// passerait pas par lui.
//
// Pas de verrou d'activation (exigerMarchandOperationnel) : cette comptabilité
// est le carnet du marchand, elle ne dépend d'aucune validation de la
// plateforme.

export type GesteComptable = 'lecture' | 'saisie' | 'modification' | 'suppression';

const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

// Côté back-office, lecture et saisie restent gardées par rôle (défaut connu,
// CORRECTIFS_URGENTS.md §2) ; modification et suppression ont leurs clés.
const CLES_BACK_OFFICE: Partial<Record<GesteComptable, string>> = {
  modification: 'comptabilite:edit',
  suppression: 'comptabilite:delete',
};

const CLES_MARCHAND: Record<GesteComptable, string> = {
  lecture: 'comptabilite.voir',
  saisie: 'comptabilite.saisir',
  modification: 'comptabilite.modifier',
  suppression: 'comptabilite.supprimer',
};

export interface PerimetreComptable {
  session: SessionPayload;
  marchandId: string | null;
  /** Ce même utilisateur peut-il faire cet autre geste ? (ex. la corbeille,
   *  lue par un GET mais réservée à qui peut restaurer). */
  peut: (geste: GesteComptable) => boolean;
}

function peutFaire(session: SessionPayload, geste: GesteComptable): boolean {
  if (session.role === 'marchand') return session.permissions.includes(CLES_MARCHAND[geste]);
  const cle = CLES_BACK_OFFICE[geste];
  return cle ? sessionHasPermission(session, cle) : true;
}

export async function perimetreComptable(geste: GesteComptable): Promise<PerimetreComptable> {
  // Modifier et supprimer se jugent à la permission seule, comme le faisait
  // requirePermission : pas de liste de rôles pour ces deux gestes.
  const session = CLES_BACK_OFFICE[geste]
    ? await requireUser()
    : await requireUser([...ROLES_COMPTABILITE, 'marchand']);

  if (!peutFaire(session, geste)) throw new ApiError(403, 'Accès refusé : permission manquante');
  const peut = (g: GesteComptable) => peutFaire(session, g);

  if (session.role !== 'marchand') return { session, marchandId: null, peut };

  const marchand = await resolveMarchandForUser(session.sub);
  if (!marchand) throw new ApiError(403, 'Profil marchand introuvable');
  return { session, marchandId: marchand.id, peut };
}
