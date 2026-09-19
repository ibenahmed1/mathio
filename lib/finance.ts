import type { TypeTransaction, CategorieTransaction } from '@/app/generated/prisma/enums';
import { libelleTaille, octetsDepuisBase64 } from '@/lib/pieces-jointes';

// Source unique pour l'ordre, les libellés et le formatage des écritures
// comptables (§ /admin/comptabilite) — même convention que lib/statuts.ts.

export const TYPES_TRANSACTION: TypeTransaction[] = ['revenu', 'depense'];

export const LABELS_TYPE_TRANSACTION: Record<TypeTransaction, string> = {
  revenu: 'Recette',
  depense: 'Dépense',
};

export const CATEGORIES_TRANSACTION: CategorieTransaction[] = [
  'paiement_client',
  'frais_livraison',
  'abonnement_outil',
  'salaire',
  'remboursement',
  'autre',
];

export const LABELS_CATEGORIE_TRANSACTION: Record<CategorieTransaction, string> = {
  paiement_client: 'Paiement client',
  frais_livraison: 'Frais de livraison',
  abonnement_outil: 'Abonnement outil',
  salaire: 'Salaire',
  remboursement: 'Remboursement',
  autre: 'Autre',
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
