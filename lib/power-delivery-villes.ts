import { normaliserVille } from '@/lib/hub-stock';

// § Sous-traitance Power Delivery — correspondance entre NOS villes Power et
// LEURS identifiants de ville (`parcel_city` de leur `POST addparcelsnew`).
//
// POURQUOI CE FICHIER EXISTE. Leur API accepte un identifiant de ville OU un
// nom « valide », et recommande l'identifiant. On n'envoie JAMAIS le nom : s'il
// ne figure pas mot pour mot dans leur liste, soit l'appel est refusé, soit —
// pire — leur système le rattache à une autre ville, et le colis part au
// mauvais endroit sans qu'aucune erreur ne remonte. Chaque ville reçoit donc
// son identifiant, décidé une fois et relu en revue.
//
// POURQUOI UN FICHIER ET NON UNE COLONNE. Même choix que pour Meta Livraison :
// les villes changent rarement, chaque correspondance est une décision tracée
// par Git, et aucune migration n'est nécessaire. Contrepartie connue : une
// ville renommée depuis /admin/hubs perd sa correspondance. L'échec est alors
// un REFUS de remise, jamais un envoi au mauvais endroit.
//
// CE QUI A RENDU LE RAPPROCHEMENT SIMPLE. Leur grille (« ville Power.pdf »,
// transcrite dans scripts/import-prestataire-power-delivery.ts) sort de leur
// propre système : 82 lignes sur 90 portent exactement le nom de leur API,
// casse comprise. Leur API compte 382 villes ; les 296 qui ne figurent pas dans
// notre grille sont hors contrat — servies chez nous par d'autres prestataires —
// et n'ont rien à faire ici.
//
// DEUX GROUPES :
//   · `exact`       — même nom chez eux, casse, accents et espaces de bord mis
//                     à part (leur « Sidi bou othmane » porte une espace finale) ;
//   · `orthographe` — même ville, autre graphie : « l jadida » est « El jadida ».
//
// AUCUNE LOCALITÉ RATTACHÉE, contrairement à Meta. Une ville absente de leur
// liste n'est pas envoyée sous le nom d'une voisine : ce rattachement doit venir
// de Power Delivery, et il n'est pas venu. Ces villes sont listées à part
// (VILLES_POWER_SANS_CORRESPONDANCE), restent livrables par Excel, et
// attendent leur réponse.
//
// Deux de NOS lignes peuvent désigner la même ville chez eux, et c'est voulu :
// « l jadida » (la grille) et « El Jadida » (la ville d'implantation de
// l'agence, ajoutée par scripts/ajouter-villes-agences.ts) partent toutes deux
// sous #4247. À l'inverse, deux villes que LEUR base tient en double — « ait
// aourir » #5353 / « Aït ourir » #5658, « tamelelt » #6437 / « Tamallalt »
// #6054 — gardent chacune leur propre identifiant : décider que c'est la même
// ville leur appartient.
//
// Source : `GET https://elog.ma/apiclient/listcities`, relevé du 21/09/2026 —
// 382 villes chez eux, 91 villes Power chez nous (base locale).

export type GroupeCorrespondancePower = 'exact' | 'orthographe';

export interface CorrespondanceVillePower {
  // Nom de l'agence (Hub.nom) et de la ville (Ville.nom), tels qu'en base.
  agence: string;
  ville: string;
  cityId: number;
  // Nom de la ville chez eux, pour qu'une relecture n'ait pas à ouvrir leur API.
  nomPower: string;
  groupe: GroupeCorrespondancePower;
}

export interface VillePowerSansCorrespondance {
  agence: string;
  ville: string;
  motif: string;
}

export const CORRESPONDANCES_VILLES_POWER: readonly CorrespondanceVillePower[] = [
  { agence: 'Agence Casablanca', ville: 'Ben ahmed', cityId: 4919, nomPower: 'Ben ahmed', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'Berrechid', cityId: 4757, nomPower: 'Berrechid', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'Bouskoura', cityId: 4265, nomPower: 'Bouskoura', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'Casablanca', cityId: 4240, nomPower: 'Casablanca', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'Dar bouazza', cityId: 4271, nomPower: 'Dar bouazza', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'Deroua', cityId: 4721, nomPower: 'Deroua', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'Lahraouyine', cityId: 6218, nomPower: 'Lahraouyine', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'MEDIOUNA', cityId: 4751, nomPower: 'MEDIOUNA', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'NOUACER', cityId: 4727, nomPower: 'NOUACER', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'SETTAT', cityId: 4763, nomPower: 'SETTAT', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'TAMARIS', cityId: 4733, nomPower: 'TAMARIS', groupe: 'exact' },
  { agence: 'Agence Casablanca', ville: 'TIT MELIL', cityId: 4259, nomPower: 'TIT MELIL', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'Azemmour', cityId: 4277, nomPower: 'Azemmour', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'Bir jdid', cityId: 4307, nomPower: 'Bir jdid', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'El Jadida', cityId: 4247, nomPower: 'El jadida', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'Had soualem', cityId: 4295, nomPower: 'Had soualem', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'Khemis des zemamra', cityId: 4319, nomPower: 'Khemis des zemamra', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'l jadida', cityId: 4247, nomPower: 'El jadida', groupe: 'orthographe' },
  { agence: 'Agence El Jadida', ville: 'MOULAY ABDELLAH', cityId: 4325, nomPower: 'MOULAY ABDELLAH', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'SIDI BENNOUR', cityId: 4709, nomPower: 'SIDI BENNOUR', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'Sidi bouzid', cityId: 4283, nomPower: 'Sidi bouzid', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'SIDI RAHAL', cityId: 4739, nomPower: 'SIDI RAHAL', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'SIDI SMAIL', cityId: 4313, nomPower: 'SIDI SMAIL', groupe: 'exact' },
  { agence: 'Agence El Jadida', ville: 'TNIN CHTOUKA - EL JADIDA', cityId: 4289, nomPower: 'TNIN CHTOUKA - EL JADIDA', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'aghmat', cityId: 6479, nomPower: 'aghmat', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'ait aourir', cityId: 5353, nomPower: 'ait aourir', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Aït ourir', cityId: 5658, nomPower: 'Aït ourir', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Amizmiz', cityId: 5672, nomPower: 'Amizmiz', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Ben Guerir', cityId: 4787, nomPower: 'Ben Guerir', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Chichaoua', cityId: 5377, nomPower: 'Chichaoua', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'choueiter', cityId: 6394, nomPower: 'choueiter', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Demnat', cityId: 5089, nomPower: 'Demnat', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Echemmaia', cityId: 4355, nomPower: 'Echemmaia', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'El attaouia', cityId: 5399, nomPower: 'El attaouia', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'El Kelaâ des Sraghna', cityId: 4775, nomPower: 'El Kelaâ des Sraghna', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'el ouidane', cityId: 6657, nomPower: 'el ouidane', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Imintanoute', cityId: 5651, nomPower: 'Imintanoute', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'kettara', cityId: 6535, nomPower: 'kettara', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'lalla takerkoust', cityId: 6500, nomPower: 'lalla takerkoust', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'lamnabeha', cityId: 6528, nomPower: 'lamnabeha', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'loudaya', cityId: 6423, nomPower: 'loudaya', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Marrakech', cityId: 4367, nomPower: 'Marrakech', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Mzouda', cityId: 6549, nomPower: 'Mzouda', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'mzoudia', cityId: 6556, nomPower: 'mzoudia', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Ouaht sidi brahim', cityId: 6664, nomPower: 'Ouaht sidi brahim', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'ouled hassoune', cityId: 6465, nomPower: 'ouled hassoune', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'ouled yahya', cityId: 6409, nomPower: 'ouled yahya', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Ourika', cityId: 6232, nomPower: 'Ourika', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'ras elain erhamna', cityId: 6521, nomPower: 'ras elain erhamna', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'sid mokhtar', cityId: 6507, nomPower: 'sid mokhtar', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Sidi bou othmane', cityId: 6571, nomPower: 'Sidi bou othmane', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'sidi ghiat', cityId: 6472, nomPower: 'sidi ghiat', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Sidi moussa - Marrakech', cityId: 6671, nomPower: 'Sidi moussa - Marrakech', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Sidi zouine', cityId: 6430, nomPower: 'Sidi zouine', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'skhour rehamna', cityId: 6514, nomPower: 'skhour rehamna', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'souihla', cityId: 6416, nomPower: 'souihla', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'tahannaout', cityId: 6486, nomPower: 'tahannaout', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'Tamallalt', cityId: 6054, nomPower: 'Tamallalt', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'TAMANSOURT', cityId: 4781, nomPower: 'TAMANSOURT', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'tamelelt', cityId: 6437, nomPower: 'tamelelt', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'tameslouhte', cityId: 6402, nomPower: 'tameslouhte', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'tassaout', cityId: 6451, nomPower: 'tassaout', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'tassoultante', cityId: 6578, nomPower: 'tassoultante', groupe: 'exact' },
  { agence: 'Agence Marrakech', ville: 'YOUSSOUFIA', cityId: 4337, nomPower: 'YOUSSOUFIA', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Ain aouda', cityId: 5033, nomPower: 'Ain aouda', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Ain atiq', cityId: 5015, nomPower: 'Ain atiq', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Allal tazi', cityId: 6190, nomPower: 'Allal tazi', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Bassatine elmnzah', cityId: 6169, nomPower: 'Bassatine elmnzah', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Benslimane', cityId: 5303, nomPower: 'Benslimane', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Bouknadel', cityId: 4997, nomPower: 'Bouknadel', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Bouznika', cityId: 5039, nomPower: 'Bouznika', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Harhoura', cityId: 5003, nomPower: 'Harhoura', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Kenitra', cityId: 4991, nomPower: 'Kenitra', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Mers el kheir', cityId: 5009, nomPower: 'Mers el kheir', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Rabat', cityId: 4967, nomPower: 'Rabat', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Sale', cityId: 4973, nomPower: 'Sale', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Sale el jadida', cityId: 6092, nomPower: 'Sale el jadida', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Sidi taibi', cityId: 6061, nomPower: 'Sidi taibi', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Skhirate', cityId: 5021, nomPower: 'Skhirate', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Tamssna', cityId: 5107, nomPower: 'Tamssna', groupe: 'exact' },
  { agence: 'Agence Rabat', ville: 'Temara', cityId: 4985, nomPower: 'Temara', groupe: 'exact' },
  { agence: 'Agence Safi', ville: 'Essaouira', cityId: 4343, nomPower: 'Essaouira', groupe: 'exact' },
  { agence: 'Agence Safi', ville: 'Jemaa shaim', cityId: 4361, nomPower: 'Jemaa shaim', groupe: 'exact' },
  { agence: 'Agence Safi', ville: 'SAFI', cityId: 4331, nomPower: 'SAFI', groupe: 'exact' },
  { agence: 'Agence Safi', ville: 'SEBT GZOULA', cityId: 4349, nomPower: 'SEBT GZOULA', groupe: 'exact' },
];

// Villes de notre grille Power qu'on NE PEUT PAS leur remettre par l'API, mises
// de côté sur décision du 21/09/2026. Elles restent dans le référentiel — les
// colis y sont routés et tarifés comme avant — mais leur remise passe par
// l'Excel. Une réponse de Power Delivery les fait passer dans la liste
// ci-dessus ; elles ne se rapprochent JAMAIS d'une voisine par déduction.
export const VILLES_POWER_SANS_CORRESPONDANCE: readonly VillePowerSansCorrespondance[] = [
  { agence: 'Agence Casablanca', ville: 'SIDI HAJAJ', motif: 'absente de leur API sous tout nom' },
  { agence: 'Agence Marrakech', ville: 'ASNI', motif: 'absente de leur API sous tout nom' },
  { agence: 'Agence Marrakech', ville: 'moulay brahim', motif: 'absente de leur API sous tout nom' },
  // Leur grille l'écrit deux fois, leur API lui donne deux identifiants
  // (#6458 et #6542) : en prendre un au hasard, c'est un colis sur deux au
  // mauvais endroit si ce sont deux lieux.
  { agence: 'Agence Marrakech', ville: 'ouargui', motif: 'deux identifiants chez eux (#6458, #6542)' },
  { agence: 'Agence Rabat', ville: 'El arjat', motif: 'absente de leur API sous tout nom' },
  // Vraisemblablement « Tamssna » (#5107), déjà dans la liste ci-dessus sous
  // son propre nom — à confirmer par eux avant de la rattacher.
  { agence: 'Agence Rabat', ville: 'TEMSENA', motif: 'absente de leur API ; seul « Tamssna » existe' },
];

// Résolution à la remise. La recherche se fait DANS L'AGENCE qui reçoit le
// colis, et non sur toutes les villes Power : la même localité peut exister
// dans deux agences. `Commande.ville` étant du texte libre, la comparaison
// replie casse et accents comme partout ailleurs (`normaliserVille`).
//
// `null` veut dire « ne pas remettre par l'API » : l'appelant refuse en citant
// la ville, il ne tente jamais un envoi sans `cityId` validé.
export function resoudreVillePower(agence: string, ville: string): CorrespondanceVillePower | null {
  const cible = normaliserVille(ville);
  return (
    CORRESPONDANCES_VILLES_POWER.find(
      (c) => c.agence === agence && normaliserVille(c.ville) === cible
    ) ?? null
  );
}

// Même résolution, mais sans agence de départ : le cas d'un bon d'envoi adressé
// DIRECTEMENT au transporteur (§ BonEnvoi.prestataireId), qui ne passe par
// aucune de leurs agences et n'a donc rien à donner comme point d'entrée.
//
// Ne répond QUE si une seule agence déclare cette ville. Deux agences qui la
// déclarent lui donnent deux `cityId` différents : en choisir un serait
// décider, à la place de l'exploitation, par quel dépôt le colis transite. Un
// `null` renvoie le colis vers l'export Excel, où un humain tranche — c'est
// une réponse honnête, là où un choix arbitraire serait un colis mal routé.
export function resoudreVilleToutesAgencesPower(ville: string): CorrespondanceVillePower | null {
  const cible = normaliserVille(ville);
  const candidats = CORRESPONDANCES_VILLES_POWER.filter((c) => normaliserVille(c.ville) === cible);
  if (candidats.length === 0) return null;

  const cityIds = new Set(candidats.map((c) => c.cityId));
  return cityIds.size === 1 ? candidats[0] : null;
}
