// § Équipe & accès — formes renvoyées par /api/marchands/equipe/** (cf.
// serialiserMembre / serialiserRole dans lib/equipe-marchand.ts).

export type StatutMembre = 'actif' | 'invitation' | 'invitation_expiree' | 'suspendu' | 'expire';

export interface MembreEquipe {
  id: string;
  utilisateurId: string;
  nomComplet: string;
  email: string | null;
  poste: string | null;
  roleId: string;
  modeAjout: 'manuel' | 'invitation';
  statut: StatutMembre;
  dateAjout: string;
  derniereConnexion: string | null;
  accesExpireLe: string | null;
  invitationExpireLe: string | null;
  ajoutePar: string | null;
}

export interface RoleEquipe {
  id: string;
  nom: string;
  description: string | null;
  systeme: boolean;
  cle: string | null;
  permissions: string[];
  nbMembres: number;
  dateCreation: string;
}

export interface TitulaireEquipe {
  id: string;
  nomComplet: string;
  email: string | null;
  telephone: string | null;
  derniereConnexion: string | null;
  dateCreation: string;
}

export interface DonneesEquipe {
  boutique: { id: string; nom: string };
  moi: { utilisateurId: string; estTitulaire: boolean; permissions: string[] };
  titulaire: TitulaireEquipe | null;
  membres: MembreEquipe[];
  roles: RoleEquipe[];
}

export interface LigneJournal {
  id: string;
  action: string;
  cible: string | null;
  details: string | null;
  horodatage: string;
  auteur: string;
}
