import { chargerVillesRoutage, villesRetenues, type VilleAvecHub } from '@/lib/hub-envoi';
import { TARIF_LIVRAISON_SHIPEH } from '@/lib/tarif-mathio';

// § GET /api/v1/villes — les villes que nous desservons, avec le tarif de
// livraison Mathio.
//
// CE QUI SORT : le nom, le code (Ville.id) et le tarif de livraison que nous
// appliquons aux marchands de Shipeh, prix unique pour tout le Maroc
// (TARIF_LIVRAISON_SHIPEH, lib/tarif-mathio.ts — décision du 10/10/2026, qui
// remplace celle du 05/10 où sortait le tarif du transporteur). Rien d'autre — ni le transporteur, ni l'agence, ni son prix,
// ni le tarif de retour.
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
  // Tarif de livraison appliqué aux marchands Shipeh, en dirhams.
  tarifLivraison: number;
}

// Partie pure, testable sans base.
export function construireCatalogue(villes: VilleAvecHub[]): VilleCatalogue[] {
  const destinations = villes.filter((v) => !v.hub.nom.startsWith(PREFIXE_HUB_DE_TEST));
  return [...villesRetenues(destinations).values()]
    .map((v): VilleCatalogue => ({ nom: v.nom, code: v.id, tarifLivraison: TARIF_LIVRAISON_SHIPEH }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
}

export async function catalogueVilles(): Promise<VilleCatalogue[]> {
  return construireCatalogue(await chargerVillesRoutage());
}
