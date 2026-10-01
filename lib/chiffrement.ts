import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Chiffrement RÉVERSIBLE des secrets que nous devons PRÉSENTER à un tiers — le
// jeton d'administration d'une boutique Shopify, la clé qui sert à vérifier
// ses webhooks. À ne pas confondre avec les secrets que nous DÉLIVRONS (clés
// d'API des plateformes, jetons de réinitialisation) : ceux-là sont hachés,
// parce que nous n'avons jamais besoin de les relire.
//
// AES-256-GCM : chiffrement authentifié. Un octet modifié en base — par erreur
// ou par malveillance — fait échouer le déchiffrement au lieu de produire un
// jeton faux envoyé tel quel à Shopify.
//
// La clé vit dans l'environnement (CLE_CHIFFREMENT_INTEGRATIONS), JAMAIS en
// base : une copie de la base seule ne livre aucun jeton. La perdre rend les
// secrets déjà stockés illisibles — les marchands devront reconnecter leur
// boutique, rien de plus grave.

// Préfixe de version : si l'algorithme ou la clé doivent changer un jour, les
// deux formats coexisteront le temps de la rotation, et chaque valeur dira
// elle-même comment la lire.
const VERSION = 'v1';
const ALGORITHME = 'aes-256-gcm';
const TAILLE_IV = 12; // recommandation NIST pour GCM

export class ErreurChiffrement extends Error {}

/**
 * Lit la clé depuis une valeur d'environnement : 32 octets en base64 (44
 * caractères) ou en hexadécimal (64 caractères). Exportée pour les tests ; le
 * code applicatif passe par `cleDepuisEnvironnement`.
 */
export function lireCle(valeur: string | undefined): Buffer {
  const brute = valeur?.trim() ?? '';
  if (!brute) {
    throw new ErreurChiffrement(
      'CLE_CHIFFREMENT_INTEGRATIONS n’est pas configurée : impossible de stocker ou relire un secret d’intégration'
    );
  }
  const cle = /^[0-9a-f]{64}$/i.test(brute) ? Buffer.from(brute, 'hex') : Buffer.from(brute, 'base64');
  if (cle.length !== 32) {
    throw new ErreurChiffrement('CLE_CHIFFREMENT_INTEGRATIONS doit faire 32 octets (base64 ou hexadécimal)');
  }
  return cle;
}

function cleDepuisEnvironnement(): Buffer {
  return lireCle(process.env.CLE_CHIFFREMENT_INTEGRATIONS);
}

export function chiffrer(clair: string, cle: Buffer = cleDepuisEnvironnement()): string {
  const iv = randomBytes(TAILLE_IV);
  const chiffreur = createCipheriv(ALGORITHME, cle, iv);
  const chiffre = Buffer.concat([chiffreur.update(clair, 'utf8'), chiffreur.final()]);
  const etiquette = chiffreur.getAuthTag();
  return [VERSION, iv.toString('base64url'), etiquette.toString('base64url'), chiffre.toString('base64url')].join('.');
}

export function dechiffrer(valeur: string, cle: Buffer = cleDepuisEnvironnement()): string {
  const [version, iv, etiquette, chiffre] = valeur.split('.');
  if (version !== VERSION || !iv || !etiquette || chiffre === undefined) {
    throw new ErreurChiffrement('Secret chiffré illisible (format inconnu)');
  }
  try {
    const dechiffreur = createDecipheriv(ALGORITHME, cle, Buffer.from(iv, 'base64url'));
    dechiffreur.setAuthTag(Buffer.from(etiquette, 'base64url'));
    return Buffer.concat([dechiffreur.update(Buffer.from(chiffre, 'base64url')), dechiffreur.final()]).toString('utf8');
  } catch {
    // Mauvaise clé ou valeur altérée : GCM ne distingue pas les deux, et le
    // message n'a pas à en dire plus.
    throw new ErreurChiffrement('Secret chiffré illisible (clé différente ou valeur altérée)');
  }
}
