import { normaliserVille } from '@/lib/hub-stock';

// § Intégration Shopify — rapprochement de la ville SAISIE PAR LE CLIENT FINAL
// sur le site du marchand avec une Ville de notre référentiel.
//
// Le problème n'est pas celui des colis saisis dans notre espace. Là, le
// marchand choisit dans NOTRE liste ; ici, c'est un acheteur qui tape ce qu'il
// veut dans un champ libre de Shopify : « Casa », « casablanca », « Marrakesh »,
// « Tangier », « الدار البيضاء », « fes » pour « Fès ». La normalisation de
// lib/hub-stock.ts (casse et accents) n'en rattrape qu'une partie.
//
// Trois étages, du plus sûr au moins sûr, et on s'arrête au premier qui répond :
//   1. la clé normalisée (casse, accents, ponctuation, espaces) ;
//   2. une table d'ALIAS écrite à la main — noms anglais, abréviations
//      courantes, noms arabes des grandes villes ;
//   3. une tolérance aux fautes de frappe, bornée et refusée dès qu'elle est
//      ambiguë.
//
// L'échec n'est JAMAIS bloquant : c'est la règle posée sur Commande.villeId
// (« best-effort, non bloquant »). Le colis est créé avec la ville telle que
// saisie, sans villeId, et sa note le signale au marchand. Un rapprochement
// FAUX serait pire qu'une absence de rapprochement : il enverrait le colis
// vers le mauvais hub sans que personne ne le voie — d'où l'étage 3 prudent.
//
// Module PUR (aucun accès base) : le référentiel est passé en paramètre, chargé
// une fois par l'appelant.

export interface VilleReferentiel {
  id: string;
  nom: string;
}

export type MethodeRapprochement = 'exacte' | 'alias' | 'approchee';

export interface VilleRapprochee {
  id: string;
  nom: string;
  methode: MethodeRapprochement;
}

/** Clé de comparaison : normaliserVille, puis ponctuation → espace. */
export function cleVille(saisie: string): string {
  return normaliserVille(saisie)
    .replace(/[-'’‘`_.,;:/\\()&"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clé → clé canonique du référentiel. Les deux côtés sont écrits sous forme de
// CLÉ (minuscules, sans accent), c'est ce qui les rend comparables sans
// dépendre de la façon dont le référentiel orthographie la ville.
//
// Liste volontairement courte : les grandes villes, celles qui concentrent les
// commandes et les variantes. Une ville absente d'ici passe encore par les
// étages 1 et 3.
const ALIAS: Record<string, string> = {
  casa: 'casablanca',
  'casa blanca': 'casablanca',
  'dar el beida': 'casablanca',
  'dar el baida': 'casablanca',
  'dar beida': 'casablanca',
  'الدار البيضاء': 'casablanca',
  'الدار البيضا': 'casablanca',
  marrakesh: 'marrakech',
  marrakch: 'marrakech',
  kech: 'marrakech',
  مراكش: 'marrakech',
  tangier: 'tanger',
  tangiers: 'tanger',
  tanja: 'tanger',
  طنجة: 'tanger',
  fez: 'fes',
  فاس: 'fes',
  meknas: 'meknes',
  مكناس: 'meknes',
  tetuan: 'tetouan',
  تطوان: 'tetouan',
  الرباط: 'rabat',
  sala: 'sale',
  سلا: 'sale',
  eljadida: 'el jadida',
  'al jadida': 'el jadida',
  الجديدة: 'el jadida',
  القنيطرة: 'kenitra',
  أكادير: 'agadir',
  اكادير: 'agadir',
  wajda: 'oujda',
  ujda: 'oujda',
  وجدة: 'oujda',
  laayoun: 'laayoune',
  layoune: 'laayoune',
  'el aaiun': 'laayoune',
  العيون: 'laayoune',
  الداخلة: 'dakhla',
  الناظور: 'nador ville',
  nador: 'nador ville',
};

// Suffixes que les acheteurs ajoutent sans que cela désigne une autre ville.
const SUFFIXES_PARASITES = [/ maroc$/, / morocco$/, / ma$/, / المغرب$/];

function nettoyer(cle: string): string {
  let resultat = cle.replace(/^ville de /, '').replace(/^ville /, '');
  for (const suffixe of SUFFIXES_PARASITES) resultat = resultat.replace(suffixe, '');
  return resultat.trim();
}

// Distance d'édition de Levenshtein, bornée : au-delà de `max` on abandonne,
// la valeur exacte n'intéresse plus personne.
export function distanceEdition(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const courante = [i];
    let minLigne = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      courante[j] = Math.min(precedente[j] + 1, courante[j - 1] + 1, precedente[j - 1] + cout);
      if (courante[j] < minLigne) minLigne = courante[j];
    }
    if (minLigne > max) return max + 1;
    precedente = courante;
  }
  return precedente[b.length];
}

// Fautes tolérées selon la longueur : aucune sous cinq lettres (« Sale » et
// « Safi » sont à une lettre l'une de l'autre), une jusqu'à sept, deux au-delà.
function toleranceFautes(longueur: number): number {
  if (longueur < 5) return 0;
  if (longueur < 8) return 1;
  return 2;
}

export function rapprocherVille(saisie: string, villes: VilleReferentiel[]): VilleRapprochee | null {
  const cleSaisie = nettoyer(cleVille(saisie));
  if (!cleSaisie) return null;

  // Chaque ville du référentiel sous deux clés : son nom complet, et son nom
  // sans la précision entre parenthèses, après un tiret ou en « … Ville »
  // (« Oujda (Centre & Quartiers) » → « oujda », « Taza Ville » → « taza »).
  // Le nom complet est toujours préféré.
  const completes = new Map<string, VilleReferentiel>();
  const courtes = new Map<string, VilleReferentiel>();
  for (const ville of villes) {
    const complete = cleVille(ville.nom);
    if (!completes.has(complete)) completes.set(complete, ville);
    const courte = cleVille(ville.nom.replace(/\(.*\)/, '').split(/ - /)[0].replace(/\s+ville\s*$/i, ''));
    if (courte && !courtes.has(courte)) courtes.set(courte, ville);
  }
  const chercher = (cle: string): VilleReferentiel | undefined => completes.get(cle) ?? courtes.get(cle);

  // La saisie telle quelle d'abord : le nettoyage retire « ma » (Maroc) en fin
  // de saisie, et ferait de « Ras El Ma » un « Ras El » introuvable.
  const exacte = chercher(cleVille(saisie)) ?? chercher(cleSaisie);
  if (exacte) return { id: exacte.id, nom: exacte.nom, methode: 'exacte' };

  const cleAlias = ALIAS[cleSaisie];
  if (cleAlias) {
    const alias = chercher(cleAlias);
    if (alias) return { id: alias.id, nom: alias.nom, methode: 'alias' };
  }

  const tolerance = toleranceFautes(cleSaisie.length);
  if (tolerance === 0) return null;

  // Meilleur candidat UNIQUE, sinon rien. Deux villes à égale distance, c'est
  // précisément le cas où deviner enverrait un colis sur deux au mauvais hub.
  let meilleure: VilleReferentiel | null = null;
  let meilleureDistance = tolerance + 1;
  let exAequo = false;
  const candidates = new Map<string, VilleReferentiel>([...courtes, ...completes]);
  for (const [cle, ville] of candidates) {
    const distance = distanceEdition(cleSaisie, cle, tolerance);
    if (distance > tolerance) continue;
    if (distance < meilleureDistance) {
      meilleure = ville;
      meilleureDistance = distance;
      exAequo = false;
    } else if (distance === meilleureDistance && meilleure && cleVille(meilleure.nom) !== cleVille(ville.nom)) {
      exAequo = true;
    }
  }
  if (!meilleure || exAequo) return null;
  return { id: meilleure.id, nom: meilleure.nom, methode: 'approchee' };
}
