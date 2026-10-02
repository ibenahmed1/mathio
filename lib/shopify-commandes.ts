import { createHmac, timingSafeEqual } from 'node:crypto';

// § Intégration Shopify — tout ce qui se décide SANS base de données : la
// forme d'un domaine de boutique, la signature d'un webhook, et la lecture
// d'une commande. Module pur, donc testé en unitaire
// (lib/__tests__/shopify-commandes.test.ts) ; l'écriture en base vit dans
// lib/shopify.ts.
//
// Le corps d'un webhook `orders/create` est au format de l'API REST (snake_case :
// `shipping_address`, `total_outstanding`…), y compris quand l'abonnement a été
// créé par l'API GraphQL. C'est ce format-là qui est lu ici.

export class ErreurShopify extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Domaine de la boutique
// ---------------------------------------------------------------------------

const DOMAINE_MYSHOPIFY = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Ramène la saisie du marchand au domaine `xxx.myshopify.com`, ou `null`.
 *
 * Accepte ce qu'un marchand colle en pratique : le domaine nu, le seul
 * identifiant (« ma-boutique »), une URL avec `https://` et un chemin, ou
 * l'URL de l'administration (`admin.shopify.com/store/ma-boutique`).
 *
 * N'accepte QUE des hôtes `*.myshopify.com`, et c'est une règle de sécurité
 * avant d'être une règle de forme : le serveur appelle ensuite
 * `https://<domaine>/admin/…` en y joignant le jeton. Un domaine libre ferait
 * de ce formulaire un moyen d'envoyer notre requête — et le jeton saisi —
 * n'importe où, y compris vers le réseau interne.
 */
export function normaliserDomaineShopify(saisie: string): string | null {
  let valeur = saisie.trim().toLowerCase();
  if (!valeur) return null;
  valeur = valeur.replace(/^[a-z]+:\/\//, '');

  const admin = /^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(valeur);
  if (admin) return `${admin[1]}.myshopify.com`;

  valeur = valeur.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (!valeur.includes('.')) valeur = `${valeur}.myshopify.com`;
  return DOMAINE_MYSHOPIFY.test(valeur) ? valeur : null;
}

// Jeton d'administration d'une application personnalisée : `shpat_…`
// (d'autres préfixes `shp??_` existent selon le type d'application). Le
// contrôle n'est qu'un garde-fou contre l'inversion des deux champs — le
// véritable test est l'appel à Shopify qui suit.
export function jetonAccesPlausible(jeton: string): boolean {
  return /^shp[a-z]{2}_[A-Za-z0-9]{16,}$/.test(jeton);
}

export function cleSecretePlausible(cle: string): boolean {
  return /^\S{16,}$/.test(cle) && !cle.startsWith('shpat_');
}

// ---------------------------------------------------------------------------
// Signature des webhooks
// ---------------------------------------------------------------------------

/**
 * Vérifie `X-Shopify-Hmac-Sha256` : HMAC-SHA256 du corps BRUT, encodé en
 * base64, avec la clé secrète de l'application.
 *
 * Le corps doit être celui reçu, octet pour octet : un JSON reparsé puis
 * resérialisé ne reproduirait pas la signature. Comparaison en temps constant,
 * sur les octets décodés.
 */
export function signatureShopifyValide(corpsBrut: Buffer | string, entete: string | null, secret: string): boolean {
  if (!secret || !entete) return false;
  const attendue = createHmac('sha256', secret).update(corpsBrut).digest();
  let recue: Buffer;
  try {
    recue = Buffer.from(entete.trim(), 'base64');
  } catch {
    return false;
  }
  return recue.length === attendue.length && timingSafeEqual(recue, attendue);
}

// ---------------------------------------------------------------------------
// Lecture d'une commande
// ---------------------------------------------------------------------------

const MONTANT_MAX = 99_999_999.99; // Commande.montantCod, Decimal(10,2)
const POIDS_MAX = 9_999.99; // Commande.poidsKg, Decimal(6,2)
const LONGUEUR_MAX_DESCRIPTION = 500;

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

type Objet = Record<string, unknown>;

function objet(valeur: unknown): Objet | null {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur) ? (valeur as Objet) : null;
}

function texte(valeur: unknown): string | null {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return String(valeur);
  if (typeof valeur !== 'string') return null;
  const nettoye = valeur.replace(/\s+/g, ' ').trim();
  return nettoye || null;
}

function montant(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const nombre = Number(valeur);
  return Number.isFinite(nombre) ? nombre : null;
}

function nomComplet(source: Objet | null): string | null {
  if (!source) return null;
  return texte(source.name) ?? texte([texte(source.first_name), texte(source.last_name)].filter(Boolean).join(' '));
}

export interface LigneCommandeShopify {
  titre: string;
  quantite: number;
  idVariante: string | null;
  sku: string | null;
}

export interface CommandeShopifyLue {
  idCommande: string;
  numero: string;
  devise: string | null;
  clientNom: string;
  /** Tel que saisi : la normalisation au format marocain est faite par l'appelant. */
  telephoneBrut: string | null;
  ville: string;
  adresse: string;
  codePostal: string | null;
  /** Montant restant à encaisser à la livraison. 0 pour une commande déjà payée. */
  montantCod: number;
  lignes: LigneCommandeShopify[];
  quantite: number;
  produitDescription: string | null;
  poidsKg: number | null;
  noteClient: string | null;
  passerelles: string[];
  /** Champs du destinataire absents de la commande — le colis est créé quand
   *  même, et le marchand doit les compléter. */
  manquants: string[];
}

export type LectureCommandeShopify =
  | { type: 'commande'; commande: CommandeShopifyLue }
  | { type: 'ignoree'; numero: string | null; motif: string };

// Statuts financiers pour lesquels il ne reste rien à encaisser, utilisés
// seulement quand `total_outstanding` est absent du corps.
const STATUTS_SOLDES = new Set(['paid', 'refunded', 'partially_refunded', 'voided']);

/**
 * Montant à encaisser par le livreur.
 *
 * `total_outstanding` d'abord : c'est exactement « ce que le client doit
 * encore », que la commande soit en paiement à la livraison (tout le montant)
 * ou déjà réglée par carte (zéro). Décision du 2026-09-26 : une commande
 * prépayée devient un colis à COD 0, elle n'est pas écartée.
 */
function montantAEncaisser(corps: Objet): number {
  const restant = montant(corps.total_outstanding);
  if (restant !== null) return Math.max(0, restant);
  const statut = texte(corps.financial_status);
  if (statut && STATUTS_SOLDES.has(statut)) return 0;
  return Math.max(0, montant(corps.current_total_price) ?? montant(corps.total_price) ?? 0);
}

export function lireCommandeShopify(corpsBrut: unknown): LectureCommandeShopify {
  const corps = objet(corpsBrut);
  if (!corps) throw new ErreurShopify('corps_invalide', 'Le corps du webhook n’est pas un objet JSON');

  const idCommande = texte(corps.id);
  if (!idCommande || !/^\d+$/.test(idCommande)) {
    throw new ErreurShopify('corps_invalide', 'Identifiant de commande absent ou illisible');
  }
  const numero = texte(corps.name) ?? (texte(corps.order_number) ? `#${texte(corps.order_number)}` : `#${idCommande}`);

  if (texte(corps.cancelled_at)) {
    return { type: 'ignoree', numero, motif: 'Commande déjà annulée à sa création' };
  }

  const lignesBrutes = Array.isArray(corps.line_items) ? corps.line_items.map(objet).filter((l): l is Objet => !!l) : [];
  // Une carte cadeau ou un service n'ont rien à livrer. `requires_shipping`
  // absent est lu comme « à expédier » : mieux vaut un colis de trop, que le
  // marchand annule, qu'une commande perdue.
  const aExpedier = lignesBrutes.filter((l) => l.requires_shipping !== false);
  if (aExpedier.length === 0) {
    return { type: 'ignoree', numero, motif: 'Aucun article à expédier (cartes cadeaux, services…)' };
  }

  const lignes: LigneCommandeShopify[] = aExpedier.map((l) => {
    const quantite = Number(l.quantity);
    const titreProduit = texte(l.title) ?? texte(l.name) ?? 'Article';
    const variante = texte(l.variant_title);
    return {
      titre: variante && variante !== 'Default Title' ? `${titreProduit} (${variante})` : titreProduit,
      quantite: Number.isInteger(quantite) && quantite > 0 ? quantite : 1,
      idVariante: texte(l.variant_id),
      sku: texte(l.sku),
    };
  });

  const livraison = objet(corps.shipping_address);
  const facturation = objet(corps.billing_address);
  const client = objet(corps.customer);
  const adresseClient = objet(client?.default_address);
  // L'adresse de LIVRAISON fait foi ; les autres ne sont que des replis, pour
  // une commande dont le formulaire de livraison a été désactivé.
  const adresseSource = livraison ?? facturation ?? adresseClient;

  const clientNom = nomComplet(livraison) ?? nomComplet(facturation) ?? nomComplet(client);
  const telephoneBrut =
    texte(livraison?.phone) ??
    texte(corps.phone) ??
    texte(client?.phone) ??
    texte(facturation?.phone) ??
    texte(adresseClient?.phone);
  const ville = texte(adresseSource?.city);
  const adresse = [texte(adresseSource?.address1), texte(adresseSource?.address2)].filter(Boolean).join(', ') || null;

  const manquants: string[] = [];
  if (!clientNom) manquants.push('nom');
  if (!telephoneBrut) manquants.push('téléphone');
  if (!ville) manquants.push('ville');
  if (!adresse) manquants.push('adresse');

  const description = lignes.map((l) => `${l.quantite} × ${l.titre}`).join(', ');
  const grammes = montant(corps.total_weight);
  const poidsKg = grammes && grammes > 0 ? Math.min(arrondi(grammes / 1000), POIDS_MAX) : null;

  return {
    type: 'commande',
    commande: {
      idCommande,
      numero,
      devise: texte(corps.currency),
      clientNom: clientNom ?? 'Client Shopify',
      telephoneBrut,
      ville: ville ?? '',
      adresse: adresse ?? '',
      codePostal: texte(adresseSource?.zip),
      montantCod: Math.min(arrondi(montantAEncaisser(corps)), MONTANT_MAX),
      lignes,
      quantite: lignes.reduce((total, l) => total + l.quantite, 0),
      produitDescription:
        description.length > LONGUEUR_MAX_DESCRIPTION
          ? `${description.slice(0, LONGUEUR_MAX_DESCRIPTION - 1)}…`
          : description || null,
      poidsKg: poidsKg && poidsKg > 0 ? poidsKg : null,
      noteClient: texte(corps.note),
      passerelles: Array.isArray(corps.payment_gateway_names)
        ? corps.payment_gateway_names.map(texte).filter((p): p is string => !!p)
        : [],
      manquants,
    },
  };
}
