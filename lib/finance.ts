import type {
  ActionHistoriqueComptable,
  PorteeCategorieComptable,
  TypeTransaction,
} from '@/app/generated/prisma/enums';
import { libelleTaille, octetsDepuisBase64 } from '@/lib/pieces-jointes';

// Source unique pour l'ordre, les libellés et le formatage des écritures
// comptables (§ /admin/comptabilite) — même convention que lib/statuts.ts.

export const TYPES_TRANSACTION: TypeTransaction[] = ['revenu', 'depense'];

export const LABELS_TYPE_TRANSACTION: Record<TypeTransaction, string> = {
  revenu: 'Recette',
  depense: 'Dépense',
};

export function estTypeTransaction(valeur: unknown): valeur is TypeTransaction {
  return typeof valeur === 'string' && (TYPES_TRANSACTION as string[]).includes(valeur);
}

// ------------------------------------------------------------
// Catégories (§ CategorieComptable)
// ------------------------------------------------------------
//
// Les catégories vivent en base depuis le 21/09/2026 : ce module ne connaît
// plus leur liste, seulement les deux que le CODE référence. Les écritures
// automatiques s'y rattachent par ce code — remise de tournée et règlement de
// facture sous `paiement_client`, paie livreur sous `salaire`. Supprimer l'une
// d'elles ferait échouer la clôture d'une tournée : elles se renomment, elles
// ne se suppriment pas.
export const CODES_CATEGORIE_SYSTEME = ['paiement_client', 'salaire'] as const;
export type CodeCategorieSysteme = (typeof CODES_CATEGORIE_SYSTEME)[number];

export const PORTEES_CATEGORIE: PorteeCategorieComptable[] = ['transaction', 'commande_stock_hub'];

export const LABELS_PORTEE_CATEGORIE: Record<PorteeCategorieComptable, string> = {
  transaction: 'Transactions',
  commande_stock_hub: "Commandes d'inventaire",
};

export function estPorteeCategorie(valeur: unknown): valeur is PorteeCategorieComptable {
  return typeof valeur === 'string' && (PORTEES_CATEGORIE as string[]).includes(valeur);
}

export const LONGUEUR_MAX_NOM_CATEGORIE = 60;
export const LONGUEUR_MAX_TITRE = 120;

// Plafond d'un montant : `Decimal(10, 2)` s'arrête à 99 999 999,99. Au-delà,
// Postgres refuserait l'écriture avec une erreur que l'API ne saurait que
// traduire en 500 — on la refuse avant, avec un message qui dit pourquoi.
export const MONTANT_MAX = 99_999_999.99;

// Nom d'une catégorie tel qu'il sera stocké : sans blancs en bordure ni
// espaces répétés — « Frais  de port » et « Frais de port » sont la même
// catégorie, et l'unicité en base ne le verrait pas. Chaîne vide si la
// valeur n'est pas exploitable.
export function normaliserNomCategorie(brut: unknown): string {
  if (typeof brut !== 'string') return '';
  return brut.replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------
// Historique des manipulations (§ HistoriqueComptable)
// ------------------------------------------------------------

export const LABELS_ACTION_HISTORIQUE: Record<ActionHistoriqueComptable, string> = {
  creation: 'Création',
  modification: 'Modification',
  suppression: 'Suppression',
  restauration: 'Restauration',
};

// Libellés des champs tels que l'historique les nomme. Une clé absente
// s'affiche telle quelle : mieux vaut un nom technique qu'une ligne muette.
export const LABELS_CHAMP_HISTORIQUE: Record<string, string> = {
  titre: 'Titre',
  sousTitre: 'Sous-titre',
  montant: 'Montant',
  type: 'Type',
  categorie: 'Catégorie',
  dateEffet: "Date d'effet",
  dateCommande: 'Date de commande',
  description: 'Description',
  modePaiement: 'Mode de paiement',
  statut: 'Statut',
  preuve: 'Justificatif',
  nom: 'Nom',
};

// Le signe (+/-) est toujours dérivé de `type`, jamais saisi : le montant
// stocké en base reste positif (cf. Transaction.montant côté schema.prisma).
export function formatMontantTransaction(montant: number | string, type: TypeTransaction): string {
  const valeur = Math.abs(Number(montant));
  const signe = type === 'revenu' ? '+' : '-';
  return `${signe} ${valeur.toFixed(2)} DH`;
}

export function formatSolde(solde: number): string {
  const signe = solde < 0 ? '-' : '+';
  return `${signe} ${Math.abs(solde).toFixed(2)} DH`;
}

// ------------------------------------------------------------
// Justificatif d'une pièce comptable
// ------------------------------------------------------------
//
// Une seule analyse pour les DEUX cartes de /admin/comptabilite : les écritures
// du journal (§ Transaction.preuveUrl) et les commandes d'inventaire
// (§ CommandeStockHub.preuveUrl). Le reçu photographié est le même objet dans
// les deux cas, et deux listes blanches à tenir séparément auraient fini par
// diverger — d'où le nom « comptable » plutôt que « transaction ».
//
// La photo d'un reçu est stockée en data URL dans la colonne, faute de
// stockage objet dans ce projet (§ prisma/schema.prisma). Ce qui rend le choix
// tenable tient en deux lignes : un plafond de poids, et une liste blanche de
// formats. Les deux vivent ici plutôt que dans la route, pour que le
// formulaire refuse un fichier AVANT de l'encoder et de l'envoyer, avec
// exactement le même message que le serveur.
//
// L'analyse retourne un résultat au lieu de lever une `ApiError` : ce module
// est chargé par le navigateur, et `lib/api-utils` y tirerait `next/server`.

/** Plafond du contenu DÉCODÉ d'un justificatif. Le base64 stocké pèse ~4/3 de
 *  plus, et chaque écriture de la ligne le transporte. Même plafond que les
 *  pièces jointes de tâche, pour une raison identique : au-delà, la sauvegarde
 *  de la base se met à peser plus lourd que ce qu'elle protège. En pratique la
 *  compression côté client (readImageAsCompressedDataUrl) ramène une photo de
 *  téléphone bien en dessous — le plafond ne sert qu'aux formats que le
 *  navigateur n'a pas su décoder, et qui partent donc tels quels. */
export const TAILLE_MAX_PREUVE_COMPTABLE = 3 * 1024 * 1024;

/** Formats acceptés, avec l'extension à donner au téléchargement.
 *
 *  Large à dessein : le comptable photographie le reçu avec le téléphone qu'il
 *  a, et un iPhone produit du HEIC quand un Android produit du JPEG. Tous les
 *  formats bitmap que les navigateurs savent afficher sont donc là, y compris
 *  ceux qu'ils ne savent pas TOUS décoder (HEIC sous Chrome) : l'image arrive
 *  alors non recompressée, et reste lisible par la machine qui l'a produite.
 *
 *  Liste blanche et non liste noire, et le SVG n'y est PAS : la route de
 *  contenu renvoie les octets avec leur `Content-Type` depuis notre origine,
 *  or un `image/svg+xml` y exécuterait son script avec le cookie de session du
 *  comptable. Un format n'entre ici que si le navigateur ne peut pas en tirer
 *  de script. */
export const MIMES_PREUVE_COMPTABLE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
};

/** `image/jpg` n'existe pas au registre, mais des appareils et des
 *  bibliothèques l'émettent : on l'accepte en le ramenant au mime réel plutôt
 *  que de renvoyer le comptable à sa galerie photo. */
const MIMES_PREUVE_ALIAS: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/tif': 'image/tiff',
  'image/vnd.microsoft.icon': 'image/x-icon',
};

/** Ce que le champ `accept` d'un `<input type="file">` doit proposer.
 *  `image/*` et non la liste : le sélecteur du système doit montrer TOUTES les
 *  photos de l'appareil, quitte à ce que la validation en refuse une ensuite
 *  avec un message clair. Énumérer les mimes fait disparaître de la liste des
 *  fichiers que l'OS étiquette autrement, et le comptable croit son reçu
 *  absent. */
export const ACCEPT_PREUVE_COMPTABLE = 'image/*';

export type PreuveComptable = { mime: string; base64: string; poids: number };

// Discriminant textuel et non booléen : le dépôt compile avec
// `strictNullChecks` désactivé (tsconfig.json), et dans ce mode TypeScript ne
// restreint pas une union sur un littéral `true` / `false` — même raison que
// `ResultatAnalyse` dans lib/pieces-jointes.ts.
export type ResultatAnalysePreuve =
  | { statut: 'ok'; preuve: PreuveComptable }
  | { statut: 'refus'; message: string };

const DATA_URL_PREUVE = /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*);base64,([a-z0-9+/=\s]*)$/i;

/** Valide ce qui arrive dans une colonne `preuve_url` (`Transaction` comme
 *  `CommandeStockHub`), qu'il vienne du corps d'un POST ou de la base. Ne
 *  connaît qu'une forme : une data URL d'image.
 *  Un lien externe est refusé — une preuve comptable qui vit chez un tiers
 *  peut disparaître entre la saisie et le contrôle fiscal. */
export function analyserPreuveComptable(brut: string): ResultatAnalysePreuve {
  const valeur = brut.trim();
  if (!valeur) return { statut: 'refus', message: 'Aucune image fournie' };

  const m = DATA_URL_PREUVE.exec(valeur);
  if (!m) {
    return {
      statut: 'refus',
      message: 'Justificatif illisible : seule une image encodée en base64 est acceptée',
    };
  }

  const declare = m[1].toLowerCase();
  const mime = MIMES_PREUVE_ALIAS[declare] ?? declare;
  if (!MIMES_PREUVE_COMPTABLE[mime]) {
    return {
      statut: 'refus',
      message: `Format non accepté (${declare}). Le justificatif doit être une image : JPEG, PNG, WebP, AVIF, HEIC, GIF, BMP ou TIFF.`,
    };
  }

  const base64 = m[2].replace(/\s/g, '');
  const poids = octetsDepuisBase64(base64);
  if (poids === 0) return { statut: 'refus', message: 'Image vide' };
  if (poids > TAILLE_MAX_PREUVE_COMPTABLE) {
    return {
      statut: 'refus',
      message: `Image trop lourde (${libelleTaille(poids)}), maximum ${libelleTaille(TAILLE_MAX_PREUVE_COMPTABLE)}`,
    };
  }

  return { statut: 'ok', preuve: { mime, base64, poids } };
}

/** Forme normalisée à écrire en base : ni blancs, ni alias de mime. La
 *  relecture n'a plus rien à rattraper. */
export function dataUrlPreuve(preuve: PreuveComptable): string {
  return `data:${preuve.mime};base64,${preuve.base64}`;
}

/** Nom de fichier proposé au téléchargement d'un justificatif. Ni guillemet ni
 *  saut de ligne : ils permettraient d'injecter un second en-tête dans le
 *  `Content-Disposition` de la route de contenu. */
export function nomFichierPreuve(transactionId: string, mime: string): string {
  const extension = MIMES_PREUVE_COMPTABLE[mime] ?? 'bin';
  const identifiant = transactionId.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'transaction';
  return `justificatif-${identifiant}.${extension}`;
}

// ------------------------------------------------------------
// Analyse des saisies (POST et PATCH)
// ------------------------------------------------------------
//
// Mêmes contraintes que l'analyse du justificatif ci-dessus : ce module est
// chargé par le navigateur, il retourne donc un résultat au lieu de lever une
// `ApiError`. Les routes traduisent un refus en 400.
//
// Dans un corps de PATCH, une clé ABSENTE veut dire « inchangé » ; une clé
// présente est validée comme à la création. C'est ce qui permet de ne
// renvoyer que ce qu'on modifie, sans risquer d'effacer le reste.

export type ResultatAnalyse<T> = { statut: 'ok'; valeur: T } | { statut: 'refus'; message: string };

export function analyserMontant(brut: unknown): ResultatAnalyse<number> {
  const montant = typeof brut === 'string' && brut.trim() ? Number(brut) : typeof brut === 'number' ? brut : NaN;
  // RG § Contrôle des saisies : un montant absolu positif, c'est le type qui
  // décide du sens de l'écriture.
  if (!Number.isFinite(montant) || montant <= 0) {
    return { statut: 'refus', message: 'Le montant doit être strictement positif' };
  }
  if (montant > MONTANT_MAX) {
    return { statut: 'refus', message: `Le montant ne peut pas dépasser ${MONTANT_MAX.toFixed(2)} DH` };
  }
  // Arrondi au centime ICI, et non laissé à la colonne Decimal(10,2) : c'est
  // la valeur arrondie qui doit entrer dans l'historique, sans quoi
  // « 100.004 → 100 » y apparaîtrait comme une modification qui n'a rien changé.
  return { statut: 'ok', valeur: Math.round(montant * 100) / 100 };
}

export function analyserDate(brut: unknown, libelle: string): ResultatAnalyse<Date> {
  const date = typeof brut === 'string' && brut.trim() ? new Date(brut) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { statut: 'refus', message: `${libelle} invalide` };
  }
  return { statut: 'ok', valeur: date };
}

export function analyserTitre(brut: unknown): ResultatAnalyse<string> {
  const titre = typeof brut === 'string' ? brut.replace(/\s+/g, ' ').trim() : '';
  if (!titre) return { statut: 'refus', message: 'Le titre est requis' };
  if (titre.length > LONGUEUR_MAX_TITRE) {
    return { statut: 'refus', message: `Le titre ne peut pas dépasser ${LONGUEUR_MAX_TITRE} caractères` };
  }
  return { statut: 'ok', valeur: titre };
}

// Texte facultatif : chaîne vide ou `null` = effacé (`null`, jamais '' en base).
export function texteFacultatif(brut: unknown): string | null {
  return typeof brut === 'string' && brut.trim() ? brut.trim() : null;
}

// Justificatif dans un PATCH : `null` ou chaîne vide = retiré, une data URL =
// remplacé (validée comme à la création). L'absence de la clé est traitée par
// l'appelant — elle veut dire « on n'y touche pas ».
export function analyserPreuveModifiee(brut: unknown): ResultatAnalyse<string | null> {
  if (brut === null || (typeof brut === 'string' && !brut.trim())) return { statut: 'ok', valeur: null };
  if (typeof brut !== 'string') return { statut: 'refus', message: 'Justificatif invalide' };
  const analyse = analyserPreuveComptable(brut);
  if (analyse.statut === 'refus') return analyse;
  return { statut: 'ok', valeur: dataUrlPreuve(analyse.preuve) };
}

// Ce qu'un PATCH /api/finance/[id] peut changer. Toute clé absente = inchangée.
export interface ModificationTransaction {
  titre?: string;
  montant?: number;
  type?: TypeTransaction;
  categorieId?: string;
  dateEffet?: Date;
  description?: string | null;
  preuveUrl?: string | null;
}

function corpsObjet(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function analyserModificationTransaction(body: unknown): ResultatAnalyse<ModificationTransaction> {
  const corps = corpsObjet(body);
  if (!corps) return { statut: 'refus', message: 'Corps de requête invalide' };

  const champs: ModificationTransaction = {};

  if ('titre' in corps) {
    const r = analyserTitre(corps.titre);
    if (r.statut === 'refus') return r;
    champs.titre = r.valeur;
  }
  if ('montant' in corps) {
    const r = analyserMontant(corps.montant);
    if (r.statut === 'refus') return r;
    champs.montant = r.valeur;
  }
  if ('type' in corps) {
    if (!estTypeTransaction(corps.type)) return { statut: 'refus', message: 'Type de transaction invalide' };
    champs.type = corps.type;
  }
  if ('categorieId' in corps) {
    if (typeof corps.categorieId !== 'string' || !corps.categorieId.trim()) {
      return { statut: 'refus', message: 'Catégorie invalide' };
    }
    champs.categorieId = corps.categorieId.trim();
  }
  if ('dateEffet' in corps) {
    const r = analyserDate(corps.dateEffet, "Date d'effet");
    if (r.statut === 'refus') return r;
    champs.dateEffet = r.valeur;
  }
  if ('description' in corps) champs.description = texteFacultatif(corps.description);
  if ('preuveUrl' in corps) {
    const r = analyserPreuveModifiee(corps.preuveUrl);
    if (r.statut === 'refus') return r;
    champs.preuveUrl = r.valeur;
  }

  if (Object.keys(champs).length === 0) return { statut: 'refus', message: 'Aucun champ à modifier' };
  return { statut: 'ok', valeur: champs };
}
