// Pièces jointes d'une tâche (§ /admin/tasks) — analyse et typage de l'URL.
//
// `PieceJointeTache.url` porte indifféremment deux choses : un lien externe,
// ou un fichier déposé encodé en data URL (« data:<mime>;base64,… »). C'est la
// convention déjà retenue pour les photos de comptes (Utilisateur.photoUrl,
// cf. UserFormModal) : le dépôt n'a pas d'infra de stockage de fichiers, et en
// monter une pour un tableau interne coûterait plus cher que la place prise en
// base. Le plafond ci-dessous est ce qui rend le choix tenable.
//
// Module PUR : aucun import Prisma ni next/*. Il est chargé par les composants
// client (pour refuser un fichier AVANT de l'envoyer, avec le même message que
// le serveur) autant que par les routes. C'est aussi pourquoi l'analyse
// retourne un résultat au lieu de lever une `ApiError` : `lib/api-utils`
// tirerait `next/server` dans le bundle du navigateur.
//
// La lecture en base vit dans `lib/taches-pieces-jointes.ts`.

export type TypePieceJointe = 'image' | 'document' | 'lien';

/** Plafond du contenu DÉCODÉ d'un fichier déposé. Le base64 stocké pèse ~4/3
 *  de plus, et chaque écriture de la ligne le transporte : au-delà, le tableau
 *  interne se met à peser plus lourd que les colis qu'il sert à suivre. */
export const TAILLE_MAX_PIECE_JOINTE = 3 * 1024 * 1024;

/** Types acceptés au dépôt, avec l'extension à donner au téléchargement.
 *
 *  Liste blanche et non liste noire, à dessein : la route de contenu renvoie
 *  les octets avec leur `Content-Type`, or un `text/html` ou un
 *  `image/svg+xml` s'exécuteraient alors dans l'origine du back-office —
 *  c'est-à-dire avec le cookie de session de la victime. Un format n'entre ici
 *  que si le navigateur ne peut pas en tirer de script. */
export const MIMES_PIECE_JOINTE: Record<string, { extension: string; type: Exclude<TypePieceJointe, 'lien'> }> = {
  'image/png': { extension: 'png', type: 'image' },
  'image/jpeg': { extension: 'jpg', type: 'image' },
  'image/gif': { extension: 'gif', type: 'image' },
  'image/webp': { extension: 'webp', type: 'image' },
  'image/avif': { extension: 'avif', type: 'image' },
  'application/pdf': { extension: 'pdf', type: 'document' },
  'text/plain': { extension: 'txt', type: 'document' },
  'text/csv': { extension: 'csv', type: 'document' },
  'application/msword': { extension: 'doc', type: 'document' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: 'docx',
    type: 'document',
  },
  'application/vnd.ms-excel': { extension: 'xls', type: 'document' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', type: 'document' },
  'application/vnd.ms-powerpoint': { extension: 'ppt', type: 'document' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extension: 'pptx',
    type: 'document',
  },
  'application/zip': { extension: 'zip', type: 'document' },
};

/** Ce que le champ `accept` d'un `<input type="file">` doit proposer. */
export const ACCEPT_PIECE_JOINTE = Object.keys(MIMES_PIECE_JOINTE).join(',');

export type PieceAnalysee =
  | { kind: 'fichier'; mime: string; type: Exclude<TypePieceJointe, 'lien'>; base64: string; poids: number }
  | { kind: 'lien'; type: 'lien'; url: string };

// Discriminant textuel et non booléen : le dépôt compile avec
// `strictNullChecks` désactivé (tsconfig.json), et dans ce mode TypeScript ne
// restreint pas une union sur un littéral `true` / `false` — `analyse.message`
// serait resté inaccessible après un `if (!analyse.ok)`.
export type ResultatAnalyse = { statut: 'ok'; piece: PieceAnalysee } | { statut: 'refus'; message: string };

/** Raccourci de lecture : `refus('…')` se lit mieux qu'un objet littéral au
 *  milieu d'une suite de contrôles. */
function refus(message: string): ResultatAnalyse {
  return { statut: 'refus', message };
}

const DATA_URL = /^data:([a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*);base64,([a-z0-9+/=\s]*)$/i;

/** Poids réel des octets derrière une chaîne base64. Quatre caractères valent
 *  trois octets, moins le remplissage final. */
export function octetsDepuisBase64(base64: string): number {
  const utiles = base64.replace(/\s/g, '');
  const remplissage = utiles.endsWith('==') ? 2 : utiles.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((utiles.length * 3) / 4) - remplissage);
}

/** Le mime porté par l'en-tête d'une data URL, sans avoir à lire le corps —
 *  c'est ce qui permet de dresser la liste des pièces sans rapatrier les
 *  fichiers (§ lib/taches-pieces-jointes.ts). `null` si ce n'en est pas une. */
export function mimeDeDataUrl(debut: string): string | null {
  const m = /^data:([^;,]+);base64,/i.exec(debut);
  return m ? m[1].toLowerCase() : null;
}

export function typeDeMime(mime: string | null): TypePieceJointe {
  if (!mime) return 'lien';
  return MIMES_PIECE_JOINTE[mime]?.type ?? 'document';
}

/** Valide et classe ce qui arrive dans le champ `url`, qu'il vienne du corps
 *  d'un POST ou de la base. Les liens sans schéma (« mathio.ma/doc.pdf »,
 *  collé depuis une barre d'adresse) sont complétés en `https://` plutôt que
 *  refusés : c'était la première cause de rejet du formulaire. */
export function analyserPieceJointe(brut: string): ResultatAnalyse {
  const valeur = brut.trim();
  if (!valeur) return refus('Indiquez un lien ou déposez un fichier');

  if (/^data:/i.test(valeur)) {
    const m = DATA_URL.exec(valeur);
    if (!m) return refus('Fichier illisible : seul un encodage base64 est accepté');
    const mime = m[1].toLowerCase();
    const connu = MIMES_PIECE_JOINTE[mime];
    if (!connu) {
      return refus(`Format non accepté (${mime}). Images, PDF, documents bureautiques, texte, CSV et ZIP uniquement.`);
    }
    const base64 = m[2].replace(/\s/g, '');
    const poids = octetsDepuisBase64(base64);
    if (poids === 0) return refus('Fichier vide');
    if (poids > TAILLE_MAX_PIECE_JOINTE) {
      return refus(`Fichier trop lourd (${libelleTaille(poids)}), maximum ${libelleTaille(TAILLE_MAX_PIECE_JOINTE)}`);
    }
    return { statut: 'ok', piece: { kind: 'fichier', mime, type: connu.type, base64, poids } };
  }

  // Tout ce qui porte un schéma autre que http(s) est refusé : un
  // `javascript:` ou un `file:` posé dans un href du back-office n'aurait rien
  // à y faire.
  const avecSchema = /^[a-z][a-z0-9+.-]*:/i.test(valeur) ? valeur : `https://${valeur}`;
  let url: URL;
  try {
    url = new URL(avecSchema);
  } catch {
    return refus('Lien invalide');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return refus('Seuls les liens http(s) sont acceptés');
  }
  return { statut: 'ok', piece: { kind: 'lien', type: 'lien', url: url.toString() } };
}

/** Nom de repli quand l'utilisateur n'en donne pas : l'hôte pour un lien,
 *  « Fichier.ext » pour un dépôt. Mieux vaut ça qu'un rejet du formulaire pour
 *  un champ que personne n'a envie de remplir. */
export function nomParDefaut(piece: PieceAnalysee): string {
  if (piece.kind === 'lien') {
    try {
      return new URL(piece.url).hostname.replace(/^www\./, '');
    } catch {
      return 'Lien';
    }
  }
  return `Fichier.${MIMES_PIECE_JOINTE[piece.mime]?.extension ?? 'bin'}`;
}

/** Poids lisible. Base 1024, une décimale au-delà du kilo-octet. */
export function libelleTaille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(octets < 10 * 1024 ? 1 : 0)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Étiquette courte affichée sur la vignette d'une pièce : l'extension pour un
 *  fichier, l'hôte pour un lien. */
export function libelleFormat(piece: { type: TypePieceJointe; mime: string | null; url: string }): string {
  if (piece.type === 'lien') {
    try {
      return new URL(piece.url).hostname.replace(/^www\./, '');
    } catch {
      return 'lien';
    }
  }
  return (piece.mime && MIMES_PIECE_JOINTE[piece.mime]?.extension) ?? 'fichier';
}

/** Nom de fichier sûr pour un en-tête `Content-Disposition` : ni guillemet ni
 *  saut de ligne, qui permettraient d'y injecter un second en-tête. */
export function nomTelechargeable(nom: string, mime: string | null): string {
  const propre = nom.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 120).trim() || 'piece-jointe';
  const extension = mime ? MIMES_PIECE_JOINTE[mime]?.extension : undefined;
  if (!extension || propre.toLowerCase().endsWith(`.${extension}`)) return propre;
  return `${propre}.${extension}`;
}
