import type { Commande } from '@/lib/types';

// Aucun champ ne trace aujourd'hui si un changement de statut vient d'un scan
// (POST /api/commandes/scan) ou d'une action manuelle (PATCH
// /api/commandes/[id]/statut) — cette fonction reste donc toujours "false"
// tant que ce signal n'a pas été ajouté au schéma (ex. HistoriqueStatutCommande.viaScan).
export function estColisScanne(_commande: Commande): boolean {
  return false;
}
