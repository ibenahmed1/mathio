import { normaliserVille } from '@/lib/hub-stock';

// § Sous-traitance Meta Livraison — correspondance entre NOS villes Meta et
// LEURS identifiants de ville (`cityId`).
//
// POURQUOI CE FICHIER EXISTE. Leur `POST /colis/bulk` refuse les noms de ville
// et exige un `cityId`. Or nos 106 villes Meta viennent de `metalivraison.csv`
// — leur propre grille, recopiée telle qu'écrite (§ SOUS_TRAITANCE.md §2.2) —
// et leur API ne les nomme presque jamais pareil : 24 seulement se retrouvent
// par comparaison exacte. Le rapprochement du reste ne se CALCULE pas, il se
// DÉCIDE : la meilleure proposition automatique envoyait `bouhlou` (Taza) à
// Boujdour et `sidi ali` (Meknès) à Sidi Ali Azemmour. Ce fichier garde donc
// une décision humaine, prise une fois, au lieu d'une supposition refaite à
// chaque envoi.
//
// POURQUOI UN FICHIER ET NON UNE COLONNE. Les villes changent rarement, chaque
// correction est relue en revue et tracée par Git, et aucune migration n'est
// nécessaire — comme les transcriptions de `scripts/import-prestataire-*.ts`,
// qui font foi pour le référentiel. La contrepartie est connue : une ville
// renommée depuis `/admin/prestataires` perd sa correspondance. L'échec est
// alors un REFUS d'envoi, jamais un envoi au mauvais endroit.
//
// TROIS GROUPES, et le troisième est une décision métier :
//   · `exact`       — même nom chez eux, casse et accents mis à part ;
//   · `orthographe` — même lieu, autre graphie (« lhajeb » / « ELHajeb »,
//                     « wrtzag » / « Ourtzagh - Taounate ») ;
//   · `rattachee`   — localité que leur API ne connaît pas : douars et
//                     secteurs livrés depuis une ville voisine. Le colis part
//                     avec le `cityId` de la ville de SON AGENCE, et la
//                     localité est ajoutée à l'adresse pour que leur livreur la
//                     trouve (`adresseLivraisonMeta`). Toute localité douteuse
//                     est rangée ici plutôt que rapprochée d'un homonyme lointain.
//
// ⚠️ Le groupe `rattachee` suppose l'accord de Meta : une localité absente de
// leur liste doit leur parvenir sous le `cityId` de la ville d'agence. À
// confirmer avec eux avant la première remise réelle. Les lignes portant une
// `note` « à confirmer » sont celles qu'une réponse de leur part peut déplacer.
//
// Source : `npx tsx scripts/reconnaitre-meta-livraison.ts --export <fichier>`,
// relevé du 21/09/2026 — 535 villes chez eux, 106 chez nous.

export type GroupeCorrespondance = 'exact' | 'orthographe' | 'rattachee';

export interface CorrespondanceVilleMeta {
  // Nom de l'agence (Hub.nom) et de la ville (Ville.nom), tels qu'en base.
  agence: string;
  ville: string;
  cityId: number;
  // Nom de la ville chez eux, pour qu'une relecture n'ait pas à ouvrir leur API.
  nomMeta: string;
  groupe: GroupeCorrespondance;
  note?: string;
}

// Ville de chaque agence chez eux : c'est le `cityId` d'une localité
// `rattachee`. Vérifié par les tests, pour qu'une ligne rattachée ne puisse pas
// pointer ailleurs que sur la ville de son agence.
export const CITY_ID_AGENCES_META: Readonly<Record<string, number>> = {
  'Agence Azrou': 192,
  'Agence Boulmane': 239,
  'Agence Fès': 307,
  'Agence Khemisset': 365,
  'Agence Meknès': 409,
  'Agence Missour': 417,
  'Agence Sefrou': 500,
  'Agence Taounate': 577,
  'Agence Taza': 585,
};

export const CORRESPONDANCES_VILLES_META: readonly CorrespondanceVilleMeta[] = [
  { agence: 'Agence Azrou', ville: 'ain louh', cityId: 148, nomMeta: 'Ain Leuh', groupe: 'orthographe' },
  { agence: 'Agence Azrou', ville: 'ait amour ouali', cityId: 192, nomMeta: 'AZROU', groupe: 'rattachee' },
  { agence: 'Agence Azrou', ville: 'ait yahya oualla', cityId: 188, nomMeta: 'Ayt Yahya Oalla', groupe: 'orthographe' },
  { agence: 'Agence Azrou', ville: 'azrou', cityId: 192, nomMeta: 'AZROU', groupe: 'exact' },
  { agence: 'Agence Azrou', ville: 'ifrane', cityId: 334, nomMeta: 'IFRANE', groupe: 'exact' },
  { agence: 'Agence Azrou', ville: 'sidi 3edi', cityId: 510, nomMeta: 'Sidi Addi', groupe: 'orthographe' },
  { agence: 'Agence Boulmane', ville: 'Boulmane', cityId: 239, nomMeta: 'Boulemane', groupe: 'orthographe' },
  { agence: 'Agence Boulmane', ville: 'guigo', cityId: 324, nomMeta: 'Guigou', groupe: 'orthographe' },
  { agence: 'Agence Boulmane', ville: 'timahdit', cityId: 601, nomMeta: 'Timahdite', groupe: 'orthographe' },
  { agence: 'Agence Fès', ville: 'Fès', cityId: 307, nomMeta: 'FES', groupe: 'exact' },
  { agence: 'Agence Fès', ville: 'MOULAY YAACOUB', cityId: 425, nomMeta: 'Moulay Yacoub', groupe: 'orthographe' },
  { agence: 'Agence Fès', ville: 'SIDI HRAZEM', cityId: 525, nomMeta: 'Sidi Harazem', groupe: 'orthographe' },
  { agence: 'Agence Khemisset', ville: 'ain sbiit', cityId: 365, nomMeta: 'KHEMISSET', groupe: 'rattachee' },
  { agence: 'Agence Khemisset', ville: 'jm3at hodran', cityId: 346, nomMeta: 'Jamaa Houderrane', groupe: 'orthographe' },
  { agence: 'Agence Khemisset', ville: 'khemisset', cityId: 365, nomMeta: 'KHEMISSET', groupe: 'exact' },
  { agence: 'Agence Khemisset', ville: 'lma3ziz', cityId: 394, nomMeta: 'Maaziz', groupe: 'orthographe' },
  { agence: 'Agence Khemisset', ville: 'oualmas', cityId: 474, nomMeta: 'Oulmes', groupe: 'orthographe', note: 'Oulmès, et non Ougmas : même score, seule Oulmès est dans la province de Khémisset' },
  { agence: 'Agence Khemisset', ville: 'romani', cityId: 488, nomMeta: 'Rommani', groupe: 'orthographe' },
  { agence: 'Agence Khemisset', ville: 'sidi 3llal lbahraoui kamoni', cityId: 513, nomMeta: 'Sidi Allal El Bahraoui', groupe: 'orthographe', note: 'Kamouni est un douar de Sidi Allal El Bahraoui' },
  { agence: 'Agence Khemisset', ville: 'tedass', cityId: 596, nomMeta: 'Tiddas', groupe: 'orthographe' },
  { agence: 'Agence Khemisset', ville: 'tifelt', cityId: 598, nomMeta: 'TIFLET', groupe: 'orthographe', note: 'Tiflet, et non Midelt (même score)' },
  { agence: 'Agence Meknès', ville: 'AGOURAY', cityId: 129, nomMeta: 'Agourai', groupe: 'orthographe' },
  { agence: 'Agence Meknès', ville: 'ain karma', cityId: 147, nomMeta: 'AIN KARMA', groupe: 'exact' },
  { agence: 'Agence Meknès', ville: 'ait ya3zem', cityId: 162, nomMeta: 'AIT YAAZEM', groupe: 'orthographe' },
  { agence: 'Agence Meknès', ville: 'boufakrane', cityId: 231, nomMeta: 'Boufakrane', groupe: 'exact' },
  { agence: 'Agence Meknès', ville: 'dar oum soultan', cityId: 409, nomMeta: 'MEKNES', groupe: 'rattachee', note: 'peut-être Douar Soultan #271, à confirmer' },
  { agence: 'Agence Meknès', ville: 'dkhissa', cityId: 266, nomMeta: 'DKHISSA', groupe: 'exact' },
  { agence: 'Agence Meknès', ville: 'JERI', cityId: 145, nomMeta: 'Ain jiri - meknes', groupe: 'orthographe', note: 'à confirmer : rapprochement sur « Ain jiri - meknes »' },
  { agence: 'Agence Meknès', ville: 'kantina', cityId: 409, nomMeta: 'MEKNES', groupe: 'rattachee' },
  { agence: 'Agence Meknès', ville: 'lhaj 9adour', cityId: 329, nomMeta: 'Haj Kaddour', groupe: 'orthographe' },
  { agence: 'Agence Meknès', ville: 'lhajeb', cityId: 298, nomMeta: 'ELHajeb', groupe: 'orthographe' },
  { agence: 'Agence Meknès', ville: 'mejjat', cityId: 407, nomMeta: 'MEJJAT - Meknes', groupe: 'orthographe', note: 'MEJJAT - Meknes, et non Mejjat - Marrakech' },
  { agence: 'Agence Meknès', ville: 'meknes', cityId: 409, nomMeta: 'MEKNES', groupe: 'exact' },
  { agence: 'Agence Meknès', ville: 'moulay driss zerhouni', cityId: 424, nomMeta: 'Moulay Idriss Zerhoun', groupe: 'orthographe' },
  { agence: 'Agence Meknès', ville: 'ouad jdida', cityId: 443, nomMeta: 'OUED JDIDA', groupe: 'orthographe' },
  { agence: 'Agence Meknès', ville: 'ragouba', cityId: 409, nomMeta: 'MEKNES', groupe: 'rattachee' },
  { agence: 'Agence Meknès', ville: 'SEBA AYOUN', cityId: 490, nomMeta: 'Sabaâ Aïyoun - MEKNES', groupe: 'orthographe' },
  { agence: 'Agence Meknès', ville: 'sebt jehjouh', cityId: 409, nomMeta: 'MEKNES', groupe: 'rattachee' },
  { agence: 'Agence Meknès', ville: 'sidi ali', cityId: 409, nomMeta: 'MEKNES', groupe: 'rattachee', note: 'la proposition automatique était Sidi Ali Azemmour (El Jadida)' },
  { agence: 'Agence Meknès', ville: 'sidi slimen moul lkifan', cityId: 409, nomMeta: 'MEKNES', groupe: 'rattachee', note: 'à ne pas confondre avec Sidi Slimane (Gharb)' },
  { agence: 'Agence Missour', ville: 'imouzzer marmocha', cityId: 339, nomMeta: 'Imouzzer Marmoucha', groupe: 'orthographe' },
  { agence: 'Agence Missour', ville: 'missour', cityId: 417, nomMeta: 'Missour', groupe: 'exact' },
  { agence: 'Agence Missour', ville: 'outat el haj', cityId: 479, nomMeta: 'Outat El Haj', groupe: 'exact' },
  { agence: 'Agence Missour', ville: 'tandit', cityId: 573, nomMeta: 'Tandit', groupe: 'exact' },
  { agence: 'Agence Sefrou', ville: 'AZZABA', cityId: 193, nomMeta: 'Azzaba - Sefrou', groupe: 'orthographe' },
  { agence: 'Agence Sefrou', ville: 'BHALIL', cityId: 216, nomMeta: 'Bhalil', groupe: 'exact' },
  { agence: 'Agence Sefrou', ville: 'BIR TAMTAM', cityId: 219, nomMeta: 'Bir Tam Tam', groupe: 'orthographe' },
  { agence: 'Agence Sefrou', ville: 'BODRAHM', cityId: 500, nomMeta: 'Sefrou', groupe: 'rattachee' },
  { agence: 'Agence Sefrou', ville: 'EL MENZEL', cityId: 296, nomMeta: 'El Menzel - SEFROU', groupe: 'orthographe' },
  { agence: 'Agence Sefrou', ville: 'RAS TBOUDA', cityId: 484, nomMeta: 'Ras Tabouda', groupe: 'orthographe' },
  { agence: 'Agence Sefrou', ville: 'REBAT LKHIR', cityId: 485, nomMeta: 'Ribate El Kheir', groupe: 'orthographe' },
  { agence: 'Agence Sefrou', ville: 'SEFROU', cityId: 500, nomMeta: 'Sefrou', groupe: 'exact' },
  { agence: 'Agence Sefrou', ville: 'ZAOUIAT BOUGRINE', cityId: 619, nomMeta: 'Zaouiat Bougrine - Sefrou', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'AIN AICHA', cityId: 132, nomMeta: 'Ain Aicha', groupe: 'exact' },
  { agence: 'Agence Taounate', ville: 'ain madyouna', cityId: 149, nomMeta: 'Ain Mediouna - Taounate', groupe: 'orthographe', note: 'Ain Mediouna - Taounate, et non Ain Harrouda (Casablanca)' },
  { agence: 'Agence Taounate', ville: 'bab jbah', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'bni wlid', cityId: 211, nomMeta: 'Beni Oulid', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'bouadil', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee', note: 'la proposition automatique était Bhalil (Sefrou)' },
  { agence: 'Agence Taounate', ville: 'bouhouda', cityId: 233, nomMeta: 'Bouhouda', groupe: 'exact' },
  { agence: 'Agence Taounate', ville: 'dchiyar', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'firma pla', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'fricha', cityId: 314, nomMeta: 'Fricha - Taounate', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'galaz', cityId: 315, nomMeta: 'Galaz - Taounate', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'hajriya', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'hjar ma3dan', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'ikaouen', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee', note: 'la proposition automatique était Issaguen (Al Hoceima)' },
  { agence: 'Agence Taounate', ville: 'imghden', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'kanssara', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee', note: 'Ain Kansara #146 est côté Fès, à confirmer' },
  { agence: 'Agence Taounate', ville: 'kantra asqar', cityId: 354, nomMeta: 'Kantra El Ascar', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'kantra jdida', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'khlalfa', cityId: 369, nomMeta: 'khlalfa', groupe: 'exact' },
  { agence: 'Agence Taounate', ville: 'machkour', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee', note: 'la proposition automatique était Akchour (Chefchaouen)' },
  { agence: 'Agence Taounate', ville: 'marnissa', cityId: 410, nomMeta: 'Mernissa', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'mazraoua', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'mrouj', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'Rafsay', cityId: 316, nomMeta: 'Ghafsai', groupe: 'orthographe', note: 'Ghafsai : غفساي, le « gh » noté « r » en darija' },
  { agence: 'Agence Taounate', ville: 'rmila', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'sahla botahr', cityId: 492, nomMeta: 'Sahel Boutaher - Taounate', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'sidi mkhfi', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'taounat aqchour', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'Taounate', cityId: 577, nomMeta: 'Taounate', groupe: 'exact' },
  { agence: 'Agence Taounate', ville: 'taounate centre', cityId: 577, nomMeta: 'Taounate', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'thar souk', cityId: 595, nomMeta: 'Thar Es-Souk', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'timzgana', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'tissa', cityId: 606, nomMeta: 'Tissa', groupe: 'exact' },
  { agence: 'Agence Taounate', ville: 'wlad azam', cityId: 577, nomMeta: 'Taounate', groupe: 'rattachee' },
  { agence: 'Agence Taounate', ville: 'wlad daouad', cityId: 466, nomMeta: 'Ouled Daoud - Taounate', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'wrtzag', cityId: 478, nomMeta: 'Ourtzagh - Taounate', groupe: 'orthographe' },
  { agence: 'Agence Taounate', ville: 'zrizer', cityId: 625, nomMeta: 'Zrizer', groupe: 'exact' },
  { agence: 'Agence Taza', ville: 'AJDIR TAZA', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee', note: '« Ajdir » chez eux peut désigner Ajdir d’Al Hoceima' },
  { agence: 'Agence Taza', ville: 'AKNOUL', cityId: 170, nomMeta: 'Aknoul', groupe: 'exact' },
  { agence: 'Agence Taza', ville: 'BAB MARZOKA', cityId: 195, nomMeta: 'Bab Marzouka', groupe: 'orthographe' },
  { agence: 'Agence Taza', ville: 'bni ftaah', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee' },
  { agence: 'Agence Taza', ville: 'bouhlou', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee', note: 'la proposition automatique était Boujdour (Sahara)' },
  { agence: 'Agence Taza', ville: 'BOURED', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee' },
  { agence: 'Agence Taza', ville: 'GUERCIF', cityId: 322, nomMeta: 'Guercif', groupe: 'exact' },
  { agence: 'Agence Taza', ville: 'jbarna', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee' },
  { agence: 'Agence Taza', ville: 'marzou9a', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee', note: 'la proposition automatique était Marzouga (Errachidia) ; peut-être Bab Marzouka #195, à confirmer' },
  { agence: 'Agence Taza', ville: 'OUAD AMLIL', cityId: 442, nomMeta: 'Oued Amlil', groupe: 'orthographe' },
  { agence: 'Agence Taza', ville: 'sabt bou9lal', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee' },
  { agence: 'Agence Taza', ville: 'SIDI ALI BOUREKBA', cityId: 585, nomMeta: 'TAZA', groupe: 'rattachee', note: 'la proposition automatique était Sidi Ali Azemmour (El Jadida)' },
  { agence: 'Agence Taza', ville: 'TADDART GUERCI', cityId: 552, nomMeta: 'Taddart - Taza', groupe: 'orthographe', note: 'Taddart - Taza, et non Taddart - Agadir' },
  { agence: 'Agence Taza', ville: 'TAHLA', cityId: 561, nomMeta: 'TAHLA', groupe: 'exact' },
  { agence: 'Agence Taza', ville: 'TAOURIRT', cityId: 578, nomMeta: 'Taourirt', groupe: 'exact' },
  { agence: 'Agence Taza', ville: 'TAZA', cityId: 585, nomMeta: 'TAZA', groupe: 'exact' },
  { agence: 'Agence Taza', ville: 'TIZIOUSLI', cityId: 609, nomMeta: 'Tizi Ouasli', groupe: 'orthographe' },
];

// Résolution à l'envoi. La recherche se fait DANS L'AGENCE de destination du
// Bon d'Envoi, et non sur toutes les villes Meta : c'est l'agence qui reçoit le
// colis, et la même localité peut exister dans deux agences. `Commande.ville`
// étant du texte libre, la comparaison replie casse et accents comme partout
// ailleurs (`normaliserVille`).
//
// `null` veut dire « ne pas envoyer » : l'appelant refuse le colis en citant sa
// ville, il ne tente jamais un envoi sans `cityId` validé.
export function resoudreVilleMeta(agence: string, ville: string): CorrespondanceVilleMeta | null {
  const cible = normaliserVille(ville);
  return (
    CORRESPONDANCES_VILLES_META.find(
      (c) => c.agence === agence && normaliserVille(c.ville) === cible
    ) ?? null
  );
}

// Adresse transmise à Meta. Pour une localité `rattachee`, le `cityId` désigne
// la ville d'agence : sans le nom de la localité dans l'adresse, leur livreur
// chercherait le destinataire en ville. Le nom n'est pas ajouté s'il y figure
// déjà — beaucoup de marchands l'écrivent eux-mêmes.
export function adresseLivraisonMeta(adresse: string, correspondance: CorrespondanceVilleMeta): string {
  const propre = adresse.trim();
  if (correspondance.groupe !== 'rattachee') return propre;
  if (normaliserVille(propre).includes(normaliserVille(correspondance.ville))) return propre;
  return propre ? `${propre}, ${correspondance.ville}` : correspondance.ville;
}
