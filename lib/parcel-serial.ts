import { createHmac, timingSafeEqual } from "crypto";

/**
 * Numéros de série de colis + QR code anti-falsification.
 *
 * Aucune requête base de données n'est nécessaire pour garantir l'unicité :
 * le "code masqué" est obtenu par un chiffrement préservant le format
 * (réseau de Feistel + cycle-walking) appliqué à l'ID auto-incrémenté du
 * colis. C'est une bijection sur son domaine ⇒ zéro collision possible tant
 * que les ID source sont uniques, et l'opération est déterministe et
 * réversible (decodeParcelSerial retrouve l'ID d'origine).
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALPHABET_SIZE = 36; // [0-9A-Z]
const CODE_LENGTH = 6; // 6 à 8 requis par le cahier des charges
const DOMAIN_SIZE = ALPHABET_SIZE ** CODE_LENGTH; // 36^6 = 2 176 782 336
const CHECKSUM_LENGTH = 2;
const CHECKSUM_MODULUS = ALPHABET_SIZE ** CHECKSUM_LENGTH; // 36^2 = 1296

// Bloc Feistel de 32 bits (2 moitiés de 16 bits) : toujours strictement
// supérieur à DOMAIN_SIZE, condition requise pour le cycle-walking ci-dessous.
const HALF_BITS = 16;
const HALF_MASK = 0xffff;
const FEISTEL_ROUNDS = 6;
const MAX_CYCLE_WALK_ITERATIONS = 1000; // garde-fou défensif, jamais atteint en pratique

let cachedSaltKey: string | undefined;

/** Clé secrète serveur. Sans elle, personne ne peut ni deviner un code
 * masqué ni forger un checksum valide : c'est elle qui porte toute la
 * sécurité (le format en lui-même est public). */
function getSaltKey(): string {
  if (cachedSaltKey) return cachedSaltKey;
  const fromEnv = process.env.PARCEL_SERIAL_SALT_KEY;
  if (fromEnv && fromEnv.length >= 16) {
    cachedSaltKey = fromEnv;
    return cachedSaltKey;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PARCEL_SERIAL_SALT_KEY manquant ou trop court (>= 16 caractères) en production."
    );
  }
  console.warn(
    "[parcel-serial] PARCEL_SERIAL_SALT_KEY absent : clé de développement non sécurisée utilisée."
  );
  cachedSaltKey = "dev-only-insecure-salt-key-0000";
  return cachedSaltKey;
}

// ---------------------------------------------------------------------------
// Base36
// ---------------------------------------------------------------------------

function toBase36(value: number, length: number): string {
  return value.toString(36).toUpperCase().padStart(length, "0");
}

function fromBase36(code: string): number {
  return parseInt(code, 36);
}

// ---------------------------------------------------------------------------
// Réseau de Feistel (chiffrement préservant le format) + cycle-walking
// ---------------------------------------------------------------------------
// Le domaine utile (36^6) n'est pas une puissance de 2 : on chiffre donc sur
// le bloc 32 bits (2^32 > 36^6) puis on ré-applique la permutation tant que
// le résultat tombe hors du domaine ("cycle-walking", Black & Rogaway). La
// permutation étant bijective sur les 2^32 valeurs, la boucle retombe
// toujours dans le domaine, et le nombre moyen d'itérations est proche de
// 2^32 / 36^6 ≈ 2 : le coût reste O(1) en pratique.

function roundFunction(half: number, round: number, salt: string): number {
  const input = Buffer.from([round, (half >> 8) & 0xff, half & 0xff]);
  return createHmac("sha256", salt).update(input).digest().readUInt16BE(0);
}

function feistelPermute(input: number, direction: "encrypt" | "decrypt", salt: string): number {
  let left = (input >>> HALF_BITS) & HALF_MASK;
  let right = input & HALF_MASK;

  if (direction === "encrypt") {
    for (let round = 0; round < FEISTEL_ROUNDS; round++) {
      const nextRight = (left ^ roundFunction(right, round, salt)) & HALF_MASK;
      left = right;
      right = nextRight;
    }
  } else {
    for (let round = FEISTEL_ROUNDS - 1; round >= 0; round--) {
      const nextLeft = (right ^ roundFunction(left, round, salt)) & HALF_MASK;
      right = left;
      left = nextLeft;
    }
  }

  return ((left << HALF_BITS) | right) >>> 0;
}

function maskId(parcelId: number): number {
  const salt = getSaltKey();
  let value = feistelPermute(parcelId, "encrypt", salt);
  for (let i = 0; value >= DOMAIN_SIZE; i++) {
    if (i > MAX_CYCLE_WALK_ITERATIONS) {
      throw new Error("Cycle-walking n'a pas convergé (configuration Feistel invalide).");
    }
    value = feistelPermute(value, "encrypt", salt);
  }
  return value;
}

function unmaskId(maskedValue: number): number {
  const salt = getSaltKey();
  let value = feistelPermute(maskedValue, "decrypt", salt);
  for (let i = 0; value >= DOMAIN_SIZE; i++) {
    if (i > MAX_CYCLE_WALK_ITERATIONS) {
      throw new Error("Cycle-walking n'a pas convergé (configuration Feistel invalide).");
    }
    value = feistelPermute(value, "decrypt", salt);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Résolution ville -> code 3 lettres (aide optionnelle)
// ---------------------------------------------------------------------------

const VILLE_CODES: Record<string, string> = {
  "el jadida": "JAD",
  casablanca: "CAS",
  rabat: "RAB",
  marrakech: "MRK",
  fes: "FES",
  "fès": "FES",
  tanger: "TNG",
  agadir: "AGA",
  meknes: "MEK",
  "meknès": "MEK",
  oujda: "OUJ",
  kenitra: "KEN",
  "kénitra": "KEN",
  tetouan: "TET",
  "tétouan": "TET",
  safi: "SAF",
  mohammedia: "MOH",
  khouribga: "KHO",
  "beni mellal": "BME",
  "béni mellal": "BME",
  nador: "NAD",
  settat: "SET",
  sale: "SLA",
  "salé": "SLA",
  temara: "TEM",
  "témara": "TEM",
  laayoune: "LAA",
  "laâyoune": "LAA",
  dakhla: "DAK",
};

/** Déduit un code ville de 3 lettres à partir d'un nom libre (ex: `ville`
 * en base sur Commande). Repli sur les 3 premières lettres si la ville
 * n'est pas dans la table. */
export function resolveVilleCode(ville: string): string {
  const key = ville.trim().toLowerCase();
  if (VILLE_CODES[key]) return VILLE_CODES[key];
  const letters = ville.replace(/[^a-zA-Z]/g, "").toUpperCase();
  if (letters.length < 3) {
    throw new Error(`Impossible de déduire un code ville à partir de "${ville}".`);
  }
  return letters.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Date (JJMMAA)
// ---------------------------------------------------------------------------
// Le cahier des charges nomme ce composant "AAMMJJ" mais son propre exemple
// ("310726" pour le 31/07/2026) est en réalité JJMMAA (jour-mois-année) :
// 31=jour, 07=mois, 26=année. On suit ici l'exemple concret plutôt que
// l'étiquette, car c'est lui qui fixe le format observable du numéro final.

function formatDateJJMMAA(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  return `${dd}${mm}${yy}`;
}

// ---------------------------------------------------------------------------
// Génération / décodage du numéro de série
// ---------------------------------------------------------------------------

const SERIAL_PATTERN = new RegExp(
  `^([A-Z]{3})-([0-9A-Z]{${CODE_LENGTH}})-(\\d{6})$`
);

/**
 * Génère le numéro de série d'un colis : `[CODE_VILLE]-[CODE_MASQUE]-[DATE]`.
 * O(1), aucune vérification en base : l'unicité vient uniquement de
 * l'unicité de `parcelId` (ID auto-incrémenté côté DB).
 */
export function generateParcelSerial(
  cityCode: string,
  parcelId: number,
  date: Date = new Date()
): string {
  if (!/^[A-Z]{3}$/.test(cityCode)) {
    throw new Error(`code_ville invalide : "${cityCode}" (3 lettres majuscules attendues).`);
  }
  if (!Number.isInteger(parcelId) || parcelId < 0) {
    throw new Error(`parcel_id invalide : "${parcelId}" (entier positif attendu).`);
  }
  if (parcelId >= DOMAIN_SIZE) {
    throw new RangeError(
      `parcel_id (${parcelId}) dépasse le domaine encodable (${DOMAIN_SIZE}). Augmenter CODE_LENGTH.`
    );
  }

  const maskedCode = toBase36(maskId(parcelId), CODE_LENGTH);
  return `${cityCode}-${maskedCode}-${formatDateJJMMAA(date)}`;
}

/** Alias respectant la signature demandée dans le cahier des charges. */
export const generate_parcel_serial = generateParcelSerial;

export interface DecodedParcelSerial {
  cityCode: string;
  parcelId: number;
  date: string; // JJMMAA, ex: "310726" pour le 31/07/2026
}

/** Opération inverse de {@link generateParcelSerial} : retrouve l'ID
 * d'origine à partir d'un numéro de série (usage admin/support/litiges). */
export function decodeParcelSerial(serial: string): DecodedParcelSerial {
  const match = SERIAL_PATTERN.exec(serial.trim().toUpperCase());
  if (!match) {
    throw new Error(`Numéro de série mal formé : "${serial}".`);
  }
  const [, cityCode, maskedCode, date] = match;
  return { cityCode, parcelId: unmaskId(fromBase36(maskedCode)), date };
}

// ---------------------------------------------------------------------------
// Checksum HMAC anti-falsification (2 caractères) + payload QR code
// ---------------------------------------------------------------------------

/**
 * Signature tronquée : HMAC-SHA256(SALT_KEY, serial) ramenée à 2 caractères
 * base36 (1296 valeurs). Contrairement à un checksum public (type Luhn
 * mod 36), elle ne peut pas être recalculée sans connaître SALT_KEY : un
 * numéro inventé de toutes pièces ne peut donc pas être accompagné d'un
 * checksum valide.
 */
export function computeChecksum(serial: string): string {
  const digest = createHmac("sha256", getSaltKey()).update(serial).digest();
  return toBase36(digest.readUInt16BE(0) % CHECKSUM_MODULUS, CHECKSUM_LENGTH);
}

/** Construit le contenu texte du QR code : `[NUMERO_DE_SERIE].[CHECKSUM]`. */
export function buildQrPayload(serial: string): string {
  return `${serial}.${computeChecksum(serial)}`;
}

export interface QrValidationResult {
  valid: boolean;
  reason?: string;
  serial?: string;
  cityCode?: string;
  parcelId?: number;
  date?: string;
}

/**
 * Vérifie l'intégrité d'un contenu de QR code scanné. Aucun accès base de
 * données : la validité repose uniquement sur le HMAC (clé secrète serveur)
 * et la décodabilité du numéro de série.
 */
export function validateQrPayload(qrString: string): QrValidationResult {
  const raw = (qrString ?? "").trim().toUpperCase();
  const dotIndex = raw.lastIndexOf(".");
  if (dotIndex === -1) {
    return { valid: false, reason: "Format invalide : checksum manquant." };
  }

  const serial = raw.slice(0, dotIndex);
  const providedChecksum = raw.slice(dotIndex + 1);

  if (!new RegExp(`^[0-9A-Z]{${CHECKSUM_LENGTH}}$`).test(providedChecksum)) {
    return { valid: false, reason: "Checksum invalide (2 caractères alphanumériques attendus)." };
  }
  if (!SERIAL_PATTERN.test(serial)) {
    return { valid: false, reason: "Numéro de série mal formé." };
  }

  const expected = Buffer.from(computeChecksum(serial));
  const provided = Buffer.from(providedChecksum);
  const checksumValid = expected.length === provided.length && timingSafeEqual(expected, provided);

  if (!checksumValid) {
    return { valid: false, serial, reason: "Checksum incorrect : numéro falsifié ou corrompu." };
  }

  try {
    const { cityCode, parcelId, date } = decodeParcelSerial(serial);
    return { valid: true, serial, cityCode, parcelId, date };
  } catch {
    return { valid: false, serial, reason: "Numéro de série valide en apparence mais non décodable." };
  }
}

/** Alias respectant la signature demandée dans le cahier des charges. */
export const validate_qr_payload = validateQrPayload;
