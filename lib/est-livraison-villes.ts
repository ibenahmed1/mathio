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
// ⚠️ ÉTAT AU 23/09/2026 : UNE SEULE CORRESPONDANCE, VÉRIFIÉE CONTRE LEUR API.
//
// Leur API n'expose aucun endpoint qui liste leurs villes. C'est EST Livraison
// qui doit nous transmettre sa liste, et c'est ELLE qui fait foi : ils ne
// livrent que les villes qui y figurent.
//
// « OUJDA » est établie autrement, et c'est le seul moyen dont on dispose : un
// dépôt de test a répondu `city_created: null`, ce qui prouve que la ville
// existait déjà chez eux (INTEGRATION_EST_LIVRAISON.md §3.3). Toute autre ville
// demanderait un dépôt réel par ville pour être vérifiée de la même façon —
// autant de ramassages déclenchés, et une ville fantôme créée à chaque erreur.
// Leur liste reste donc le seul chemin raisonnable pour les 62 autres.
//
// Les 62 villes restantes sont NOTRE transcription de leur grille papier
// (scripts/import-prestataire-est-livraison.ts), avec son orthographe à elle :
// « Oujda (Centre & Quartiers) », « Ras El Ma (Cap de l'Eau) », « Ajdir-Taza ».
// Rien ne dit que leur système les écrit ainsi — et une parenthèse de trop
// suffit à créer une ville fantôme. Elles sont donc rangées en « sans
// correspondance » : `resoudreVilleEst` rend `null` pour chacune, la remise par
// l'API les refuse, et l'export Excel du bon reste leur voie.
//
// À l'arrivée de leur liste, chaque ville reconnue passe de
// VILLES_EST_SANS_CORRESPONDANCE à CORRESPONDANCES_VILLES_EST avec son libellé
// exact. Le test `est-livraison-villes.test.ts` vérifie qu'aucune ville ne
// disparaît en route : les deux listes réunies couvrent toujours la grille.

// EST Livraison n'a qu'une agence (§ SOUS_TRAITANCE.md §2.4) : ses huit blocs
// sont des provinces couvertes, pas des quais. Le champ reste néanmoins présent
// pour que la résolution se fasse DANS l'agence qui reçoit le colis, comme chez
// les autres réseaux — la même localité peut exister chez deux prestataires.
const AGENCE = 'Agence Oujda';

export type GroupeCorrespondanceEst = 'exact' | 'orthographe';

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

const ATTENTE = 'liste des villes EST Livraison non reçue';

export const CORRESPONDANCES_VILLES_EST: readonly CorrespondanceVilleEst[] = [
  // Vérifiée : leur API a rendu `city_created: null`, donc « OUJDA » existait
  // déjà chez eux. Notre ligne porte l'orthographe de leur grille papier, la
  // leur est en capitales et sans la parenthèse — d'où le groupe `orthographe`.
  { agence: AGENCE, ville: 'Oujda (Centre & Quartiers)', nomEst: 'OUJDA', groupe: 'orthographe' },
];

export const VILLES_EST_SANS_CORRESPONDANCE: readonly VilleEstSansCorrespondance[] = [
  { agence: AGENCE, ville: 'Beni Drar (Bnidrar)', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bni Oukil', motif: ATTENTE },
  { agence: AGENCE, ville: 'Berkane', motif: ATTENTE },
  { agence: AGENCE, ville: 'Saidia', motif: ATTENTE },
  { agence: AGENCE, ville: 'Ahfir', motif: ATTENTE },
  { agence: AGENCE, ville: 'Aklim', motif: ATTENTE },
  { agence: AGENCE, ville: 'Madagh', motif: ATTENTE },
  { agence: AGENCE, ville: 'Fezouane', motif: ATTENTE },
  { agence: AGENCE, ville: 'Cafimour', motif: ATTENTE },
  { agence: AGENCE, ville: 'Lamriss', motif: ATTENTE },
  { agence: AGENCE, ville: "Ras El Ma (Cap de l'Eau)", motif: ATTENTE },
  { agence: AGENCE, ville: 'Nador Ville', motif: ATTENTE },
  { agence: AGENCE, ville: 'Selouane', motif: ATTENTE },
  { agence: AGENCE, ville: 'El Aroui', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bni Ansar', motif: ATTENTE },
  { agence: AGENCE, ville: 'Farkhana', motif: ATTENTE },
  { agence: AGENCE, ville: 'Zeghanghane', motif: ATTENTE },
  { agence: AGENCE, ville: 'Zaio', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bouarg', motif: ATTENTE },
  { agence: AGENCE, ville: 'Ihdaden', motif: ATTENTE },
  { agence: AGENCE, ville: 'Kariat Arekmane', motif: ATTENTE },
  { agence: AGENCE, ville: 'Driouch', motif: ATTENTE },
  { agence: AGENCE, ville: 'Midar', motif: ATTENTE },
  { agence: AGENCE, ville: 'Ben Tayeb', motif: ATTENTE },
  { agence: AGENCE, ville: 'Kassita', motif: ATTENTE },
  { agence: AGENCE, ville: 'Tafersit', motif: ATTENTE },
  { agence: AGENCE, ville: 'Azlaf', motif: ATTENTE },
  { agence: AGENCE, ville: 'Dar El Kebdani', motif: ATTENTE },
  { agence: AGENCE, ville: 'Temsamane', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bodinar', motif: ATTENTE },
  { agence: AGENCE, ville: 'Al Hoceima Ville', motif: ATTENTE },
  { agence: AGENCE, ville: 'Imzouren', motif: ATTENTE },
  { agence: AGENCE, ville: 'Beni Bouayach', motif: ATTENTE },
  { agence: AGENCE, ville: 'Targuist', motif: ATTENTE },
  { agence: AGENCE, ville: 'Issaguen', motif: ATTENTE },
  { agence: AGENCE, ville: 'Ajdir', motif: ATTENTE },
  { agence: AGENCE, ville: 'Boukidaren', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bni Hadifa', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bni Boufrah', motif: ATTENTE },
  { agence: AGENCE, ville: 'Taourirt', motif: ATTENTE },
  { agence: AGENCE, ville: 'Layoun Charkia', motif: ATTENTE },
  { agence: AGENCE, ville: 'Guercif Ville', motif: ATTENTE },
  { agence: AGENCE, ville: 'Taddart', motif: ATTENTE },
  { agence: AGENCE, ville: 'Taza Ville', motif: ATTENTE },
  { agence: AGENCE, ville: 'Tahla', motif: ATTENTE },
  { agence: AGENCE, ville: 'Oued Amlil', motif: ATTENTE },
  { agence: AGENCE, ville: 'Aknoul', motif: ATTENTE },
  { agence: AGENCE, ville: 'Tizi Ouzli', motif: ATTENTE },
  { agence: AGENCE, ville: 'Ajdir-Taza', motif: ATTENTE },
  { agence: AGENCE, ville: 'Gueldamane', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bouhlou', motif: ATTENTE },
  { agence: AGENCE, ville: 'Had Oulad Zbair', motif: ATTENTE },
  { agence: AGENCE, ville: 'Had Msila', motif: ATTENTE },
  { agence: AGENCE, ville: 'Jerada', motif: ATTENTE },
  { agence: AGENCE, ville: 'Ain Bni Mathar', motif: ATTENTE },
  { agence: AGENCE, ville: 'Guenfouda', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bouarfa', motif: ATTENTE },
  { agence: AGENCE, ville: 'Tandrara', motif: ATTENTE },
  { agence: AGENCE, ville: 'Figuig', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bni Tajjit', motif: ATTENTE },
  { agence: AGENCE, ville: 'Bouanane', motif: ATTENTE },
  { agence: AGENCE, ville: 'Talsint', motif: ATTENTE },
];

// Résolution à la remise. La recherche se fait DANS L'AGENCE qui reçoit le
// colis, et non sur toutes les villes EST : la même localité peut exister dans
// deux réseaux — la Province de Taza est desservie par EST Livraison ET par
// Meta Livraison (§ SOUS_TRAITANCE.md §2.9). `Commande.ville` étant du texte
// libre, la comparaison replie casse et accents comme partout ailleurs.
//
// `null` veut dire « ne pas remettre par l'API » : l'appelant refuse en citant
// la ville, il n'envoie JAMAIS le nom tel qu'il l'a reçu. C'est la règle qui
// empêche leur API de créer une ville fantôme.
export function resoudreVilleEst(agence: string, ville: string): CorrespondanceVilleEst | null {
  const cible = normaliserVille(ville);
  return (
    CORRESPONDANCES_VILLES_EST.find((c) => c.agence === agence && normaliserVille(c.ville) === cible) ?? null
  );
}
