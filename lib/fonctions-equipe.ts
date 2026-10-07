// § Équipe & rôles (/admin/equipe) — les fonctions de l'équipe interne, telles
// que l'écran les présente : nom court et ce que la fonction couvre.
//
// Module PUR (aucun import runtime) : lu par le serveur (journal de l'équipe,
// lib/journal-equipe-admin.ts) ET par le navigateur (onglet Rôles). Les droits
// de chaque fonction ne sont PAS ici : ils restent dans lib/permissions.ts
// (ROLE_PERMISSIONS), seule source de vérité.

export interface FonctionEquipe {
  role: string;
  nom: string;
  description: string;
  // Terrain = espace livreur/ramasseur, gouverné par le rôle et non par le
  // catalogue de permissions du back-office (cf. l'en-tête de lib/permissions.ts).
  terrain: boolean;
}

export const FONCTIONS_EQUIPE: FonctionEquipe[] = [
  { role: 'superviseur', nom: 'Superviseur', description: 'Supervise les colis, les statistiques et le support.', terrain: false },
  { role: 'responsable', nom: 'Responsable', description: 'Finance : factures, paiements des livreurs, comptabilité.', terrain: false },
  { role: 'moderateur', nom: 'Modérateur', description: 'Confirme les colis et traite les réclamations.', terrain: false },
  { role: 'equipe_suivi', nom: 'Équipe de suivi', description: 'Suit et confirme les colis.', terrain: false },
  { role: 'planner', nom: 'Planner', description: 'Planifie les tournées de son hub.', terrain: false },
  { role: 'agent_hub', nom: 'Agent Hub', description: 'Réceptionne les colis au quai de son hub.', terrain: false },
  { role: 'design', nom: 'Design', description: 'Tableau des tâches (Kanban) uniquement.', terrain: false },
  { role: 'gestionnaire_hub', nom: 'Gestionnaire Hub', description: 'Tableau des tâches (Kanban) uniquement.', terrain: false },
  { role: 'livreur', nom: 'Livreur', description: 'Livre les tournées qui lui sont affectées.', terrain: true },
  { role: 'ramasseur', nom: 'Ramasseur', description: 'Effectue les ramassages chez les marchands.', terrain: true },
];

const PAR_ROLE = new Map(FONCTIONS_EQUIPE.map((f) => [f.role, f]));

export function nomFonction(role: string): string {
  if (role === 'admin') return 'Administrateur';
  return PAR_ROLE.get(role)?.nom ?? role;
}

// Compte de l'équipe interne (et non un marchand ni un admin) : seuls ceux-là
// entrent dans le journal de l'équipe.
export function estFonctionEquipe(role: string): boolean {
  return PAR_ROLE.has(role);
}

export function estFonctionTerrain(role: string): boolean {
  return PAR_ROLE.get(role)?.terrain ?? false;
}
