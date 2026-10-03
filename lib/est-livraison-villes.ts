import { normaliserVille } from '@/lib/hub-stock';

// § Sous-traitance EST Livraison — correspondance entre NOS villes EST et le
// libellé EXACT sous lequel leur API les accepte (`city` de leur
// `POST /v1/api/clients/commands/add-rammasage`).
//
// POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST PLUS CRITIQUE QUE SES VOISINS.
// Power Delivery et Meta Livraison identifient leurs villes par un ENTIER : un
// identifiant faux est refusé. EST Livraison, lui, prend un NOM libre et CRÉE
// la ville quand il ne la connaît pas (`city_created` dans leur réponse).
// Un libellé approximatif n'y produit donc aucune erreur : il fabrique une
// ville fantôme chez eux, et le colis part dans une ville que personne ne
// dessert. Il n'y a pas de rattrapage possible par leur API — elle ne sert
// aucune lecture. Ce fichier est le seul garde-fou, et `lireCreation`
// (lib/est-livraison.ts) est sa deuxième ligne de défense.
//
// POURQUOI UN FICHIER ET NON UNE COLONNE. Même choix que pour Power Delivery et
// Meta Livraison : les villes changent rarement, chaque correspondance est une
// décision tracée par Git, et aucune migration n'est nécessaire. Contrepartie
// connue : une ville renommée depuis `/admin/prestataires` perd sa
// correspondance. L'échec est alors un REFUS de remise, jamais un envoi au
// mauvais endroit.
//
// ÉTAT AU 03/10/2026 : LES 63 VILLES DE LA GRILLE SONT REMETTABLES.
//
// Leur API n'expose aucun endpoint qui liste leurs villes. Deux sources :
//
//  · « OUJDA » (groupe `orthographe`) est VÉRIFIÉE : un dépôt de test a répondu
//    `city_created: null`, preuve que la ville existait chez eux
//    (INTEGRATION_EST_LIVRAISON.md §3.4 bis). Leur système l'écrit en capitales
//    et sans la parenthèse de leur grille.
//
//  · Les 62 autres (groupe `grille`) portent le libellé de LEUR grille
//    officielle (« ville EST », transcrite dans
//    scripts/import-prestataire-est-livraison.ts), retenue comme leur
//    orthographe par l'exploitation le 03/10/2026, la grille venant d'eux.
//    Aucune n'a été confrontée à leur API. L'exemple d'Oujda montre que leur
//    système peut écrire autrement que leur grille : si un libellé est faux,
//    leur API crée la ville, `lireCreation` le voit, et la remise s'arrête en
//    « à confirmer » — le colis existe alors chez eux sous une ville fantôme, à
//    régler avec eux par téléphone, et la ligne fautive se corrige ici.
//
// Le test `est-livraison-villes.test.ts` vérifie qu'aucune ville de la grille
// ne disparaît en route.

// EST Livraison n'a qu'une agence (§ SOUS_TRAITANCE.md §2.4) : ses huit blocs
// sont des provinces couvertes, pas des quais. Le champ reste néanmoins présent
// pour que la résolution se fasse DANS l'agence qui reçoit le colis, comme chez
// les autres réseaux — la même localité peut exister chez deux prestataires.
const AGENCE = 'Agence Oujda';

// `grille` : libellé de leur grille officielle, retenu tel quel sans vérification
// contre leur API (décision du 03/10/2026).
export type GroupeCorrespondanceEst = 'exact' | 'orthographe' | 'grille';

export interface CorrespondanceVilleEst {
  // Nom de l'agence (Hub.nom) et de la ville (Ville.nom), tels qu'en base.
  agence: string;
  ville: string;
  // Le libellé EXACT envoyé dans `city`, tel qu'EST Livraison l'écrit.
  nomEst: string;
  groupe: GroupeCorrespondanceEst;
}

export interface VilleEstSansCorrespondance {
  agence: string;
  ville: string;
  motif: string;
}


export const CORRESPONDANCES_VILLES_EST: readonly CorrespondanceVilleEst[] = [
  // Vérifiée : leur API a rendu `city_created: null`, donc « OUJDA » existait
  // déjà chez eux. Notre ligne porte l'orthographe de leur grille papier, la
  // leur est en capitales et sans la parenthèse — d'où le groupe `orthographe`.
  { agence: AGENCE, ville: 'Oujda (Centre & Quartiers)', nomEst: 'OUJDA', groupe: 'orthographe' },

  // Libellés de LEUR grille officielle, transmise par EST Livraison et retenue
  // comme leur orthographe par l'exploitation le 03/10/2026. Non vérifiés contre
  // leur API : un libellé qu'ils n'ont pas créerait une ville chez eux, et
  // `lireCreation` arrête alors la remise en « à confirmer » (cf. en-tête).
  { agence: AGENCE, ville: 'Beni Drar (Bnidrar)', nomEst: 'Beni Drar (Bnidrar)', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bni Oukil', nomEst: 'Bni Oukil', groupe: 'grille' },
  { agence: AGENCE, ville: 'Berkane', nomEst: 'Berkane', groupe: 'grille' },
  { agence: AGENCE, ville: 'Saidia', nomEst: 'Saidia', groupe: 'grille' },
  { agence: AGENCE, ville: 'Ahfir', nomEst: 'Ahfir', groupe: 'grille' },
  { agence: AGENCE, ville: 'Aklim', nomEst: 'Aklim', groupe: 'grille' },
  { agence: AGENCE, ville: 'Madagh', nomEst: 'Madagh', groupe: 'grille' },
  { agence: AGENCE, ville: 'Fezouane', nomEst: 'Fezouane', groupe: 'grille' },
  { agence: AGENCE, ville: 'Cafimour', nomEst: 'Cafimour', groupe: 'grille' },
  { agence: AGENCE, ville: 'Lamriss', nomEst: 'Lamriss', groupe: 'grille' },
  { agence: AGENCE, ville: "Ras El Ma (Cap de l'Eau)", nomEst: "Ras El Ma (Cap de l'Eau)", groupe: 'grille' },
  { agence: AGENCE, ville: 'Nador Ville', nomEst: 'Nador Ville', groupe: 'grille' },
  { agence: AGENCE, ville: 'Selouane', nomEst: 'Selouane', groupe: 'grille' },
  { agence: AGENCE, ville: 'El Aroui', nomEst: 'El Aroui', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bni Ansar', nomEst: 'Bni Ansar', groupe: 'grille' },
  { agence: AGENCE, ville: 'Farkhana', nomEst: 'Farkhana', groupe: 'grille' },
  { agence: AGENCE, ville: 'Zeghanghane', nomEst: 'Zeghanghane', groupe: 'grille' },
  { agence: AGENCE, ville: 'Zaio', nomEst: 'Zaio', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bouarg', nomEst: 'Bouarg', groupe: 'grille' },
  { agence: AGENCE, ville: 'Ihdaden', nomEst: 'Ihdaden', groupe: 'grille' },
  { agence: AGENCE, ville: 'Kariat Arekmane', nomEst: 'Kariat Arekmane', groupe: 'grille' },
  { agence: AGENCE, ville: 'Driouch', nomEst: 'Driouch', groupe: 'grille' },
  { agence: AGENCE, ville: 'Midar', nomEst: 'Midar', groupe: 'grille' },
  { agence: AGENCE, ville: 'Ben Tayeb', nomEst: 'Ben Tayeb', groupe: 'grille' },
  { agence: AGENCE, ville: 'Kassita', nomEst: 'Kassita', groupe: 'grille' },
  { agence: AGENCE, ville: 'Tafersit', nomEst: 'Tafersit', groupe: 'grille' },
  { agence: AGENCE, ville: 'Azlaf', nomEst: 'Azlaf', groupe: 'grille' },
  { agence: AGENCE, ville: 'Dar El Kebdani', nomEst: 'Dar El Kebdani', groupe: 'grille' },
  { agence: AGENCE, ville: 'Temsamane', nomEst: 'Temsamane', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bodinar', nomEst: 'Bodinar', groupe: 'grille' },
  { agence: AGENCE, ville: 'Al Hoceima Ville', nomEst: 'Al Hoceima Ville', groupe: 'grille' },
  { agence: AGENCE, ville: 'Imzouren', nomEst: 'Imzouren', groupe: 'grille' },
  { agence: AGENCE, ville: 'Beni Bouayach', nomEst: 'Beni Bouayach', groupe: 'grille' },
  { agence: AGENCE, ville: 'Targuist', nomEst: 'Targuist', groupe: 'grille' },
  { agence: AGENCE, ville: 'Issaguen', nomEst: 'Issaguen', groupe: 'grille' },
  { agence: AGENCE, ville: 'Ajdir', nomEst: 'Ajdir', groupe: 'grille' },
  { agence: AGENCE, ville: 'Boukidaren', nomEst: 'Boukidaren', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bni Hadifa', nomEst: 'Bni Hadifa', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bni Boufrah', nomEst: 'Bni Boufrah', groupe: 'grille' },
  { agence: AGENCE, ville: 'Taourirt', nomEst: 'Taourirt', groupe: 'grille' },
  { agence: AGENCE, ville: 'Layoun Charkia', nomEst: 'Layoun Charkia', groupe: 'grille' },
  { agence: AGENCE, ville: 'Guercif Ville', nomEst: 'Guercif Ville', groupe: 'grille' },
  { agence: AGENCE, ville: 'Taddart', nomEst: 'Taddart', groupe: 'grille' },
  { agence: AGENCE, ville: 'Taza Ville', nomEst: 'Taza Ville', groupe: 'grille' },
  { agence: AGENCE, ville: 'Tahla', nomEst: 'Tahla', groupe: 'grille' },
  { agence: AGENCE, ville: 'Oued Amlil', nomEst: 'Oued Amlil', groupe: 'grille' },
  { agence: AGENCE, ville: 'Aknoul', nomEst: 'Aknoul', groupe: 'grille' },
  { agence: AGENCE, ville: 'Tizi Ouzli', nomEst: 'Tizi Ouzli', groupe: 'grille' },
  { agence: AGENCE, ville: 'Ajdir-Taza', nomEst: 'Ajdir-Taza', groupe: 'grille' },
  { agence: AGENCE, ville: 'Gueldamane', nomEst: 'Gueldamane', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bouhlou', nomEst: 'Bouhlou', groupe: 'grille' },
  { agence: AGENCE, ville: 'Had Oulad Zbair', nomEst: 'Had Oulad Zbair', groupe: 'grille' },
  { agence: AGENCE, ville: 'Had Msila', nomEst: 'Had Msila', groupe: 'grille' },
  { agence: AGENCE, ville: 'Jerada', nomEst: 'Jerada', groupe: 'grille' },
  { agence: AGENCE, ville: 'Ain Bni Mathar', nomEst: 'Ain Bni Mathar', groupe: 'grille' },
  { agence: AGENCE, ville: 'Guenfouda', nomEst: 'Guenfouda', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bouarfa', nomEst: 'Bouarfa', groupe: 'grille' },
  { agence: AGENCE, ville: 'Tandrara', nomEst: 'Tandrara', groupe: 'grille' },
  { agence: AGENCE, ville: 'Figuig', nomEst: 'Figuig', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bni Tajjit', nomEst: 'Bni Tajjit', groupe: 'grille' },
  { agence: AGENCE, ville: 'Bouanane', nomEst: 'Bouanane', groupe: 'grille' },
  { agence: AGENCE, ville: 'Talsint', nomEst: 'Talsint', groupe: 'grille' },
];

export const VILLES_EST_SANS_CORRESPONDANCE: readonly VilleEstSansCorrespondance[] = [];

// Résolution à la remise. La recherche se fait DANS L'AGENCE qui reçoit le
// colis, et non sur toutes les villes EST : la même localité peut exister dans
// deux réseaux — la Province de Taza est desservie par EST Livraison ET par
// Meta Livraison (§ SOUS_TRAITANCE.md §2.9). `Commande.ville` étant du texte
// libre, la comparaison replie casse et accents comme partout ailleurs.
//
// `null` veut dire « ne pas remettre par l'API » : l'appelant refuse en citant
// la ville, il n'envoie JAMAIS le nom tel qu'il l'a reçu. C'est la règle qui
// empêche leur API de créer une ville fantôme.
//
// Leur propre libellé est reconnu aussi (« Oujda » → `OUJDA`), comme chez
// Colivraison : c'est le nom même qui partirait, il ne peut rien créer.
function correspond(c: CorrespondanceVilleEst, cible: string): boolean {
  return normaliserVille(c.ville) === cible || normaliserVille(c.nomEst) === cible;
}

export function resoudreVilleEst(agence: string, ville: string): CorrespondanceVilleEst | null {
  const cible = normaliserVille(ville);
  return CORRESPONDANCES_VILLES_EST.find((c) => c.agence === agence && correspond(c, cible)) ?? null;
}

// Même résolution sans agence de départ — bon d'envoi adressé DIRECTEMENT au
// transporteur. Ne répond que si la ville désigne un seul de leurs libellés ;
// sinon l'Excel, où un humain tranche.
export function resoudreVilleToutesAgencesEst(ville: string): CorrespondanceVilleEst | null {
  const cible = normaliserVille(ville);
  const candidats = CORRESPONDANCES_VILLES_EST.filter((c) => correspond(c, cible));
  if (candidats.length === 0) return null;
  return new Set(candidats.map((c) => c.nomEst)).size === 1 ? candidats[0] : null;
}
