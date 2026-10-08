import { chargerVillesRoutage, villesRetenues, type VilleAvecHub } from '@/lib/hub-envoi';

// § GET /api/v1/villes — les villes que nous desservons, avec le tarif de
// livraison du transporteur qui livre chacune.
//
// CE QUI SORT, décidé par l'exploitation le 05/10/2026 : le nom, le code
// (Ville.id) et le tarif de livraison du transporteur (TarifPrestataireVille).
// Rien d'autre — ni le nom du transporteur, ni l'agence, ni le tarif de retour.
//
// UNE VILLE PAR CLÉ DE ROUTAGE. Le nom et le code renvoyés sont ceux de la
// ville que retient le routage (§ villesRetenues, lib/hub-envoi.ts) : le nom
// est exactement le texte à mettre dans `ville` de POST /v1/colis pour être
// reconnu du premier coup. Deux graphies d'une même ville n'apparaissent donc
// qu'une fois.

// Hubs fabriqués par les scripts d'audit (§ scripts/test-tournee-cloture-audit.ts) :
// leur ville n'est pas une destination réelle.
const PREFIXE_HUB_DE_TEST = 'Hub Audit Tournée';

export interface VilleCatalogue {
  nom: string;
  code: string;
  // Tarif de livraison du transporteur, en dirhams ; null s'il n'est pas connu.
  tarifLivraison: number | null;
}

// Partie pure, testable sans base.
export function construireCatalogue(villes: VilleAvecHub[]): VilleCatalogue[] {
  const destinations = villes.filter((v) => !v.hub.nom.startsWith(PREFIXE_HUB_DE_TEST));
  return [...villesRetenues(destinations).values()]
    .map((v): VilleCatalogue => ({ nom: v.nom, code: v.id, tarifLivraison: v.tarif }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
}

export async function catalogueVilles(): Promise<VilleCatalogue[]> {
  return construireCatalogue(await chargerVillesRoutage());
}
