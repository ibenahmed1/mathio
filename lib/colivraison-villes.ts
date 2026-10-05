import { normaliserVille } from '@/lib/hub-stock';

// § Sous-traitance Colivraison — correspondance entre NOS villes (référentiel
// importé par scripts/import-prestataire-colivraison.ts) et LEURS villes
// (https://colivraison24h.ma/cities.php, relevé du 01/10/2026).
//
// Un FICHIER et non une colonne, comme pour Power Delivery
// (lib/power-delivery-villes.ts) : la table se relit, se teste et se corrige
// par une revue de code, sans migration.
//
// LEUR LISTE EST TRÈS REDONDANTE : 926 villes, souvent la même plusieurs fois
// (« Adouz », « Adouz-bm », « Adouz (béni mellal) », « Adouz-beni mellal »).
// Règle appliquée, une fois pour toutes :
//   · `exact`       — le nom existe chez eux au caractère près (casse et
//                     accents repliés) : c'est celui-là ;
//   · `orthographe` — sinon, la variante qui porte le suffixe de l'agence
//                     (-bm, -khenifra, -khn, -er, -oarz), ou à défaut la seule
//                     graphie proche. Jamais une ville voisine ;
//   · `rattachee`   — localité absente de leur liste, que Colivraison dessert
//                     quand même (décidé par l'exploitation le 03/10/2026) :
//                     elle part sous la ville de son agence, son nom ajouté à
//                     l'adresse (`adresseLivraisonColivraison`), comme chez
//                     Meta et Power. Une décision, jamais une déduction : même
//                     « Boulanouare », probablement leur « Boulanoir » #1425,
//                     part sous Khouribga tant qu'ils ne l'ont pas confirmé.
//
// Ce qu'on leur envoie est le NOM (`city` de addcolis.php) — leur API ne prend
// pas d'identifiant. L'identifiant est gardé dans `RemisePrestataire.cityId`
// pour qu'une relecture retrouve exactement la ligne choisie dans leur liste.

export type GroupeCorrespondanceColivraison = 'exact' | 'orthographe' | 'rattachee';

export interface CorrespondanceVilleColivraison {
  // Nom de l'agence (Hub.nom) et de la ville (Ville.nom), tels qu'en base.
  agence: string;
  ville: string;
  cityId: number;
  // Nom de la ville chez eux, celui qui part dans `city`.
  nomColivraison: string;
  groupe: GroupeCorrespondanceColivraison;
}

export interface VilleColivraisonSansCorrespondance {
  agence: string;
  ville: string;
  motif: string;
}

export const CORRESPONDANCES_VILLES_COLIVRAISON: readonly CorrespondanceVilleColivraison[] = [
  // Agence Béni Mellal
  { agence: 'Agence Béni Mellal', ville: 'Beni Mellal', cityId: 47, nomColivraison: 'Beni mellal', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Riad Salam', cityId: 991, nomColivraison: 'Riad salam', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Ait Tislit', cityId: 381, nomColivraison: 'Ait tislit', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Mghila', cityId: 382, nomColivraison: 'Mghila', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Ain-Elghazi Ali', cityId: 384, nomColivraison: 'Ain elghazi', groupe: 'orthographe' },
  { agence: 'Agence Béni Mellal', ville: 'Tifrit', cityId: 385, nomColivraison: 'Tifrit', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Aourir BM', cityId: 380, nomColivraison: 'Aourir-bm', groupe: 'orthographe' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Moussa', cityId: 1069, nomColivraison: 'Oulad moussa', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Souk Sebt Ouled Nemma', cityId: 916, nomColivraison: 'Souk sebt ouled nemma', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Fkih Ben Salah', cityId: 834, nomColivraison: 'Fkih ben salah', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Kasba Tadla', cityId: 197, nomColivraison: 'Kasba tadla', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Mrah', cityId: 1290, nomColivraison: 'Oulad mrah', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Sidi Aissa Ben Ali', cityId: 735, nomColivraison: 'Sidi aissa ben ali', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Foum Oudi', cityId: 811, nomColivraison: 'Foum oudi', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Mbarek', cityId: 1473, nomColivraison: 'Oulad mbarek', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Timoulilte', cityId: 807, nomColivraison: 'Timoulilte', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Dar Oulad Zidouh', cityId: 739, nomColivraison: 'Dar oulad zidouh', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Laayayta-Oulad Gnaou', cityId: 740, nomColivraison: 'Laayayta-oulad gnaou', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Afourar', cityId: 806, nomColivraison: 'Afourar', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Beni Ayat', cityId: 1000, nomColivraison: 'Beni ayat', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Laajana', cityId: 1650, nomColivraison: 'Laajana', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Sidi Jaber', cityId: 1478, nomColivraison: 'Sidi jaber', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Ali Loued', cityId: 1492, nomColivraison: 'Oulad ali loued', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Had Lbradia', cityId: 1487, nomColivraison: 'Had lbradia', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Zmam', cityId: 745, nomColivraison: 'Oulad zmam', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Ayad Souk Sebt', cityId: 1231, nomColivraison: 'Oulad ayad souk sebt', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'La Zone Industrielle (BM)', cityId: 1319, nomColivraison: 'La zone industrielle-bm', groupe: 'orthographe' },
  { agence: 'Agence Béni Mellal', ville: 'Lakraza Ouled Said', cityId: 1741, nomColivraison: 'Lakraza ouled said-sks', groupe: 'orthographe' },
  { agence: 'Agence Béni Mellal', ville: 'Zaouiat Cheikh', cityId: 655, nomColivraison: 'Zaouiat cheikh', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'El Ksiba', cityId: 109, nomColivraison: 'El ksiba', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Ighrem Laalam', cityId: 656, nomColivraison: 'Ighrem laalam', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Yaich', cityId: 949, nomColivraison: 'Oulad yaich', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Adouz', cityId: 657, nomColivraison: 'Adouz', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Tagzert', cityId: 1017, nomColivraison: 'Tagzert', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Ikhoureba', cityId: 659, nomColivraison: 'Ikhourba', groupe: 'orthographe' },
  { agence: 'Agence Béni Mellal', ville: 'Zouair', cityId: 204, nomColivraison: 'Zouair', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Foum Zaouia', cityId: 848, nomColivraison: 'Foum zaouia', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Tanougha', cityId: 661, nomColivraison: 'Tanougha', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Foum El Anser', cityId: 662, nomColivraison: 'Foum el anser', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Ouled Driss', cityId: 1649, nomColivraison: 'Ouled driss', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Ahl Souss', cityId: 1651, nomColivraison: 'Ahl souss', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Lahlalma', cityId: 1653, nomColivraison: 'Lahlalma', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Ouled Rguiaa', cityId: 1660, nomColivraison: 'Ouled rguiaa', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Harboulia', cityId: 1841, nomColivraison: 'Harboulia', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Drid', cityId: 1842, nomColivraison: 'Oulad drid', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'El Bazzaza', cityId: 198, nomColivraison: 'El bazzaza', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Youssef', cityId: 199, nomColivraison: 'Oulad youssef', groupe: 'exact' },
  { agence: 'Agence Béni Mellal', ville: 'Oulad Said Louad', cityId: 1129, nomColivraison: 'Oulad said louad-bm', groupe: 'orthographe' },
  // Agence Khouribga
  { agence: 'Agence Khouribga', ville: 'Khouribga', cityId: 1424, nomColivraison: 'Khouribga', groupe: 'exact' },
  { agence: 'Agence Khouribga', ville: 'Bejaad', cityId: 274, nomColivraison: 'Bejaad', groupe: 'exact' },
  { agence: 'Agence Khouribga', ville: 'Oued Zem', cityId: 273, nomColivraison: 'Oued zem', groupe: 'exact' },
  { agence: 'Agence Khouribga', ville: 'Ain Kaicher', cityId: 1839, nomColivraison: 'Ain kaicher', groupe: 'exact' },
  { agence: 'Agence Khouribga', ville: 'Bir Mezoui', cityId: 1854, nomColivraison: 'Bir mezoui', groupe: 'exact' },
  { agence: 'Agence Khouribga', ville: 'Boujniba', cityId: 1426, nomColivraison: 'Boujniba', groupe: 'exact' },
  { agence: 'Agence Khouribga', ville: 'Lagfaf', cityId: 1452, nomColivraison: 'Lagfaf', groupe: 'exact' },
  { agence: 'Agence Khouribga', ville: 'Hattane', cityId: 1430, nomColivraison: 'Hattane', groupe: 'exact' },
  // Agence Khénifra
  { agence: 'Agence Khénifra', ville: 'Khenifra', cityId: 205, nomColivraison: 'Khenifra', groupe: 'exact' },
  { agence: 'Agence Khénifra', ville: 'Mrirt', cityId: 207, nomColivraison: 'Mrirt', groupe: 'exact' },
  { agence: 'Agence Khénifra', ville: 'Aguelmouss', cityId: 206, nomColivraison: 'Aguelmouss', groupe: 'exact' },
  { agence: 'Agence Khénifra', ville: 'El Kbab', cityId: 963, nomColivraison: 'El kbab القباب', groupe: 'orthographe' },
  { agence: 'Agence Khénifra', ville: 'Tighasaline', cityId: 1036, nomColivraison: 'Tighasaline', groupe: 'exact' },
  { agence: 'Agence Khénifra', ville: 'El Borj', cityId: 211, nomColivraison: 'El borj-khenifra', groupe: 'orthographe' },
  { agence: 'Agence Khénifra', ville: 'Ait Ishaq', cityId: 840, nomColivraison: 'Ait ishaq', groupe: 'exact' },
  { agence: 'Agence Khénifra', ville: 'Lahri', cityId: 215, nomColivraison: 'Lahri', groupe: 'exact' },
  { agence: 'Agence Khénifra', ville: 'Moulay Bouaza', cityId: 214, nomColivraison: 'Moulay bouazza', groupe: 'orthographe' },
  { agence: 'Agence Khénifra', ville: 'Had Bouhsousen', cityId: 209, nomColivraison: 'Had bouhssoussen', groupe: 'orthographe' },
  { agence: 'Agence Khénifra', ville: 'Kahf Nssoure', cityId: 995, nomColivraison: 'Kahf nsour-khn', groupe: 'orthographe' },
  { agence: 'Agence Khénifra', ville: 'Ouaoumana', cityId: 212, nomColivraison: 'Ouaoumana', groupe: 'exact' },
  { agence: 'Agence Khénifra', ville: 'Aghbalou', cityId: 1039, nomColivraison: 'Aghbalou', groupe: 'exact' },
  // Agence Azilal
  { agence: 'Agence Azilal', ville: 'Azilal', cityId: 41, nomColivraison: 'Azilal', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Ouzoud', cityId: 902, nomColivraison: 'Ouzoud', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Tanant', cityId: 1070, nomColivraison: 'Tanant', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Foum Jamaa', cityId: 1124, nomColivraison: 'Foum jamaa', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Bin El Ouidane', cityId: 1754, nomColivraison: 'Bin el ouidane', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Aghbala', cityId: 2441, nomColivraison: 'Aghbala', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Tizi Nisly', cityId: 2436, nomColivraison: 'Tizi nisly', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Ait Attab', cityId: 553, nomColivraison: 'Ait attab', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Ouaouizeght', cityId: 926, nomColivraison: 'Ouaouizeght', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Oulad Remich', cityId: 1647, nomColivraison: 'Oulad remich', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Boukaroune', cityId: 1646, nomColivraison: 'Boukaroune', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Ouad Laabid', cityId: 1376, nomColivraison: 'Ouad laabid', groupe: 'exact' },
  { agence: 'Agence Azilal', ville: 'Bzou', cityId: 1375, nomColivraison: 'Bzou', groupe: 'exact' },
  // Agence Errachidia
  { agence: 'Agence Errachidia', ville: 'Errachidia', cityId: 118, nomColivraison: 'Errachidia', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Midelt', cityId: 833, nomColivraison: 'Midelt', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Tinejdad', cityId: 830, nomColivraison: 'Tinejdad', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Goulmima', cityId: 929, nomColivraison: 'Goulmima', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Arfoud', cityId: 832, nomColivraison: 'Arfoud', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Er-rich', cityId: 920, nomColivraison: 'Er-rich', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Aoufous', cityId: 1250, nomColivraison: 'Aoufous', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Alnif', cityId: 387, nomColivraison: 'Alnif', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Merzouga', cityId: 843, nomColivraison: 'Merzouga', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Rissani', cityId: 842, nomColivraison: 'Rissani', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Boumia', cityId: 835, nomColivraison: 'Boumia', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Zaida', cityId: 841, nomColivraison: 'Zaida', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Itzer', cityId: 135, nomColivraison: 'Itzer', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'Aghbalou nserdan', cityId: 137, nomColivraison: 'Aghbalou nserdane-er', groupe: 'orthographe' },
  { agence: 'Agence Errachidia', ville: 'Boudnib', cityId: 837, nomColivraison: 'Boudnib', groupe: 'exact' },
  { agence: 'Agence Errachidia', ville: 'El jorf', cityId: 1176, nomColivraison: 'El jorf', groupe: 'exact' },
  // Agence Ouarzazate
  { agence: 'Agence Ouarzazate', ville: 'Ouarzazate', cityId: 253, nomColivraison: 'Ouarzazate', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Tinghir', cityId: 829, nomColivraison: 'Tinghir', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Kelaat magouna', cityId: 836, nomColivraison: 'Kelaat magouna', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Zagora', cityId: 877, nomColivraison: 'Zagora', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Tabounte', cityId: 899, nomColivraison: 'Tabounte', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Tarmigt', cityId: 1301, nomColivraison: 'Tarmigt', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Boumalne Dades', cityId: 1054, nomColivraison: 'Boumalne dadès', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Agdz', cityId: 258, nomColivraison: 'Agdz', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Skoura', cityId: 256, nomColivraison: 'Skoura', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Idelsane', cityId: 270, nomColivraison: 'Idelsane-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Taznakht', cityId: 957, nomColivraison: 'Taznakht', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Agouim', cityId: 261, nomColivraison: 'Agouim-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Tazarine', cityId: 1244, nomColivraison: 'Tazarine', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Nkoub', cityId: 1048, nomColivraison: 'Nkoub', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Tinzouline', cityId: 263, nomColivraison: 'Tinzouline-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Amerzgane', cityId: 1282, nomColivraison: 'Amerzgane', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Ait zineb-oarz', cityId: 621, nomColivraison: 'Ait zineb-oarz', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Timadline', cityId: 620, nomColivraison: 'Timadline-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Ait Ben Haddou', cityId: 265, nomColivraison: 'Ait ben haddou-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Taghbalte-ouarz', cityId: 2357, nomColivraison: 'Taghbalte-ouarz', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Ighrem nougdal', cityId: 1283, nomColivraison: 'Ighrem nougdal', groupe: 'exact' },
  { agence: 'Agence Ouarzazate', ville: 'Tamegroute', cityId: 264, nomColivraison: 'Tamegroute-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Toundoute', cityId: 622, nomColivraison: 'Toundoute-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Tagounite', cityId: 271, nomColivraison: 'Tagounite-oarz', groupe: 'orthographe' },
  { agence: 'Agence Ouarzazate', ville: 'Mhamid ghizlane', cityId: 267, nomColivraison: 'Mhamid ghizlane-oarz', groupe: 'orthographe' },
  // Rattachées à la ville de leur agence (03/10/2026).
  { agence: 'Agence Béni Mellal', ville: 'Ahl Merbaa', cityId: 47, nomColivraison: 'Beni mellal', groupe: 'rattachee' },
  { agence: 'Agence Béni Mellal', ville: 'Faryata', cityId: 47, nomColivraison: 'Beni mellal', groupe: 'rattachee' },
  { agence: 'Agence Khouribga', ville: 'Boulanouare', cityId: 1424, nomColivraison: 'Khouribga', groupe: 'rattachee' },
  { agence: 'Agence Khouribga', ville: 'Tachrafat', cityId: 1424, nomColivraison: 'Khouribga', groupe: 'rattachee' },
];

// Villes de leur grille qu'on ne peut pas leur remettre par l'API : elles
// restent dans le référentiel — routées et tarifées comme les autres — mais
// leur remise passe par l'Excel du bon. Vide depuis le 03/10/2026 : les quatre
// villes mises de côté le 01/10 sont rattachées ci-dessus. La liste reste le
// point d'entrée d'une future ville sans correspondance.
export const VILLES_COLIVRAISON_SANS_CORRESPONDANCE: readonly VilleColivraisonSansCorrespondance[] = [];

// Leur propre graphie, recopiée par un marchand, est reconnue — sauf celle
// d'une ligne rattachée, qui est le nom de la ville d'agence et non celui de
// la localité.
function correspond(c: CorrespondanceVilleColivraison, cible: string): boolean {
  return (
    normaliserVille(c.ville) === cible ||
    (c.groupe !== 'rattachee' && normaliserVille(c.nomColivraison) === cible)
  );
}

// Résolution à la remise, DANS L'AGENCE qui reçoit le colis. `Commande.ville`
// est du texte libre : casse et accents repliés (`normaliserVille`). On accepte
// aussi leur propre graphie, qu'un marchand peut avoir recopiée.
//
// `null` = ne pas remettre par l'API : l'appelant refuse en citant la ville.
export function resoudreVilleColivraison(agence: string, ville: string): CorrespondanceVilleColivraison | null {
  const cible = normaliserVille(ville);
  return (
    CORRESPONDANCES_VILLES_COLIVRAISON.find(
      (c) => c.agence === agence && correspond(c, cible)
    ) ?? null
  );
}

// Même résolution sans agence de départ — bon d'envoi adressé DIRECTEMENT au
// transporteur. Ne répond que si la ville désigne une seule de leurs villes ;
// sinon l'Excel, où un humain tranche.
export function resoudreVilleToutesAgencesColivraison(ville: string): CorrespondanceVilleColivraison | null {
  const cible = normaliserVille(ville);
  const candidats = CORRESPONDANCES_VILLES_COLIVRAISON.filter((c) => correspond(c, cible));
  if (candidats.length === 0) return null;
  return new Set(candidats.map((c) => c.cityId)).size === 1 ? candidats[0] : null;
}

// Adresse transmise à Colivraison. Pour une localité `rattachee`, la ville
// envoyée est celle de l'agence : sans le nom de la localité dans l'adresse,
// leur livreur chercherait le destinataire en ville. Le nom n'est pas ajouté
// s'il y figure déjà. Même règle que Meta et Power.
export function adresseLivraisonColivraison(
  adresse: string,
  correspondance: CorrespondanceVilleColivraison | null
): string {
  const propre = adresse.trim();
  if (correspondance?.groupe !== 'rattachee') return propre;
  if (normaliserVille(propre).includes(normaliserVille(correspondance.ville))) return propre;
  return propre ? `${propre}, ${correspondance.ville}` : correspondance.ville;
}
