import { sanitizePermissions } from '@/lib/permissions';
import { FONCTIONS_EQUIPE, estFonctionTerrain } from '@/lib/fonctions-equipe';

// § Équipe & rôles — règles des rôles de l'équipe interne (RoleBackoffice).
//
// Module PUR : lu par les routes (/api/utilisateurs/roles) ET par l'écran
// (éditeur de rôle), pour que le bouton grisé et le refus du serveur disent la
// même chose.

export interface RoleBackofficeExpose {
  id: string;
  nom: string;
  description: string | null;
  fonction: string;
  // Rôle prédéfini : une par fonction, créé par la plateforme. Modifiable,
  // jamais supprimable (décision du 07/10/2026).
  predefini: boolean;
  permissions: string[];
  nbMembres: number;
}

export const LONGUEUR_MAX_NOM_ROLE = 60;
export const LONGUEUR_MAX_DESCRIPTION_ROLE = 240;

// Fonctions sur lesquelles un rôle PERSONNALISÉ peut reposer : celles du
// back-office. Un rôle terrain n'a pas de permissions à régler (son accès est
// défini par le rôle), en créer une variante n'aurait aucun effet.
export const FONCTIONS_ROLE_PERSONNALISE = FONCTIONS_EQUIPE.filter((f) => !f.terrain).map((f) => f.role);

export type AnalyseRole =
  | { statut: 'ok'; valeur: { nom?: string; description?: string | null; fonction?: string; permissions?: string[] } }
  | { statut: 'refus'; message: string };

// Valide ce qu'envoie l'éditeur. `predefini` restreint les champs : le nom et
// la fonction d'un rôle prédéfini sont ceux de la plateforme. Champ absent =
// inchangé (modification partielle), sauf à la création où nom et fonction
// sont exigés.
export function analyserRole(
  body: unknown,
  contexte: { creation: boolean; predefini: boolean; fonctionActuelle?: string }
): AnalyseRole {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const valeur: { nom?: string; description?: string | null; fonction?: string; permissions?: string[] } = {};

  if (b.nom !== undefined && !contexte.predefini) {
    const nom = typeof b.nom === 'string' ? b.nom.trim() : '';
    if (!nom) return { statut: 'refus', message: 'Le nom du rôle est requis' };
    if (nom.length > LONGUEUR_MAX_NOM_ROLE) return { statut: 'refus', message: `Nom trop long (${LONGUEUR_MAX_NOM_ROLE} caractères au plus)` };
    valeur.nom = nom;
  } else if (contexte.creation) {
    return { statut: 'refus', message: 'Le nom du rôle est requis' };
  }

  if (b.description !== undefined) {
    const description = typeof b.description === 'string' ? b.description.trim() : '';
    if (description.length > LONGUEUR_MAX_DESCRIPTION_ROLE) {
      return { statut: 'refus', message: `Description trop longue (${LONGUEUR_MAX_DESCRIPTION_ROLE} caractères au plus)` };
    }
    valeur.description = description || null;
  }

  if (b.fonction !== undefined && !contexte.predefini) {
    if (typeof b.fonction !== 'string' || !FONCTIONS_ROLE_PERSONNALISE.includes(b.fonction)) {
      return { statut: 'refus', message: 'Fonction de base invalide : choisissez une fonction du back-office' };
    }
    valeur.fonction = b.fonction;
  } else if (contexte.creation) {
    return { statut: 'refus', message: 'La fonction de base est requise' };
  }

  if (b.permissions !== undefined) {
    if (!Array.isArray(b.permissions)) return { statut: 'refus', message: 'permissions doit être un tableau' };
    const fonction = valeur.fonction ?? contexte.fonctionActuelle ?? '';
    if (estFonctionTerrain(fonction)) {
      return { statut: 'refus', message: 'Un rôle terrain n’a pas de permissions du back-office' };
    }
    valeur.permissions = sanitizePermissions(b.permissions);
  }

  return { statut: 'ok', valeur };
}
