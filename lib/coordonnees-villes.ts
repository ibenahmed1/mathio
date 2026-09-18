import { normaliserVille } from '@/lib/hub-stock';

// Coordonnées des villes posées sur la carte de l'Accueil (§ lib/dashboard-accueil.ts :
// villes de base des agences de prestataires). La base ne stocke qu'un NOM de
// ville (Hub.ville) ; c'est ici qu'il devient un point.
//
// SOURCE : OpenStreetMap, via Nominatim, relevé le 11/09/2026 — premier
// résultat d'une recherche restreinte au Maroc, soit le centroïde de l'entité
// administrative de la ville (pachalik). Quatre décimales (~10 m au sol) :
// bien plus fin que ce qu'une carte de 300 px peut montrer.
//
// Une ville absente de cette table n'est PAS placée au jugé : coordonneesVille
// renvoie null, et l'Accueil signale l'agence comme « non placée ». Pour une
// nouvelle agence, relever sa ville de la même façon et l'ajouter ici — le test
// vérifie qu'elle tombe bien sur le territoire.

type CoordonneesVille = { longitude: number; latitude: number };

type EntreeReferentiel = CoordonneesVille & {
  ville: string;
  // Autres ORTHOGRAPHES rencontrées dans les sources. Accents et casse n'ont
  // rien à faire ici : normaliserVille les replie déjà (« Fes » = « Fès »).
  alias?: string[];
};

export const REFERENTIEL_COORDONNEES_VILLES: EntreeReferentiel[] = [
  { ville: 'Agadir', latitude: 30.4205, longitude: -9.5839 },
  { ville: 'Azrou', latitude: 33.4417, longitude: -5.2231 },
  // « Boulemane » pour OpenStreetMap, « Boulmane » dans le tableur Meta et en base.
  { ville: 'Boulemane', latitude: 33.3638, longitude: -4.7296, alias: ['Boulmane'] },
  { ville: 'El Jadida', latitude: 33.2433, longitude: -8.4988 },
  { ville: 'Fès', latitude: 34.0347, longitude: -5.0162 },
  { ville: 'Guelmim', latitude: 28.9864, longitude: -10.0574 },
  { ville: 'Khémisset', latitude: 33.8303, longitude: -6.0726 },
  { ville: 'Marrakech', latitude: 31.6258, longitude: -7.9892 },
  { ville: 'Meknès', latitude: 33.8984, longitude: -5.5322 },
  { ville: 'Missour', latitude: 33.0471, longitude: -3.9926 },
  { ville: 'Oujda', latitude: 34.6779, longitude: -1.9293 },
  { ville: 'Rabat', latitude: 34.0218, longitude: -6.8409 },
  { ville: 'Safi', latitude: 32.2994, longitude: -9.2395 },
  { ville: 'Sefrou', latitude: 33.8249, longitude: -4.8333 },
  { ville: 'Tanger', latitude: 35.7696, longitude: -5.8034 },
  { ville: 'Taounate', latitude: 34.5385, longitude: -4.636 },
  { ville: 'Taza', latitude: 34.2302, longitude: -4.0101 },
];

const INDEX = new Map<string, CoordonneesVille>();
for (const entree of REFERENTIEL_COORDONNEES_VILLES) {
  const position = { longitude: entree.longitude, latitude: entree.latitude };
  for (const nom of [entree.ville, ...(entree.alias ?? [])]) {
    INDEX.set(normaliserVille(nom), position);
  }
}

// Copie, et non l'objet de l'index : un appelant qui la modifierait déplacerait
// sinon la ville pour tous les suivants.
export function coordonneesVille(ville: string): CoordonneesVille | null {
  const position = INDEX.get(normaliserVille(ville));
  return position ? { ...position } : null;
}
