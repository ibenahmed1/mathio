// § Sous-traitance Power Delivery — client de LEUR API (https://elog.ma/apiclient).
//
// Nous sommes ici un CLIENT de leur API, comme n'importe quelle boutique : nous
// leur remettons nos colis, ils nous en renvoient les statuts. C'est le sens
// inverse de /api/v1/livraisons/statut (API_SUIVI_PRESTATAIRES.md), où c'est
// le transporteur qui nous appelle.
//
// TROIS RÈGLES tiennent tout ce fichier :
//
//  1. LE TOKEN NE SORT JAMAIS. Ni dans un message d'erreur, ni dans un journal,
//     ni dans une réponse : une erreur réseau cite la méthode, le chemin et le
//     statut HTTP, jamais les en-têtes.
//
//  2. LEUR DOCUMENTATION N'EST PAS UN CONTRAT. Plusieurs de ses exemples sont
//     faux (format de `listcities`, codes de statut), et la réponse de
//     `addparcelsnew` n'y figure même pas. Les réponses sont donc lues de façon
//     défensive, et la réponse BRUTE est rendue à l'appelant pour qu'il la
//     conserve : c'est elle qu'on montrera le jour où un colis sera contesté.
//
//  3. LE MARCHAND N'EST JAMAIS TRANSMIS. Ni son nom, ni son téléphone, ni ses
//     notes libres. Le leur donner, c'est leur donner notre client
//     (construireColisPower, plus bas, n'a même pas accès au marchand).

// Surchargeable par POWERDELIVERY_BASE_URL, et uniquement pour les TESTS : c'est
// ce qui permet d'exercer toute la chaîne contre un faux serveur local, sans
// créer un seul vrai colis chez eux — chaque appel réel à `addparcelsnew`
// déclenche un ramassage. Lue à chaque appel, pas au chargement du module.
const BASE_URL_PAR_DEFAUT = 'https://elog.ma/apiclient';

function baseUrl(): string {
  return (process.env.POWERDELIVERY_BASE_URL?.trim() || BASE_URL_PAR_DEFAUT).replace(/\/+$/, '');
}
// Un appel qui ne répond pas en 20 s ne répondra pas mieux en 60, et l'appelant
// est souvent un humain qui attend devant un bouton.
const DELAI_MS = 20_000;

// Préfixe de NOS codes chez eux. Leur `parcel_code` doit être unique dans TOUT
// leur système, tous clients confondus : « PD-000123 » seul, où « PD » évoque
// aussi « Power Delivery », risquerait de heurter le code d'un autre client.
// Décision du 21/09/2026.
export const PREFIXE_CODE_POWER = 'MTH-';

export class ErreurPowerDelivery extends Error {
  constructor(
    // null = pas de réponse HTTP du tout (délai dépassé, réseau coupé).
    readonly statutHttp: number | null,
    message: string,
    readonly brut: unknown = null
  ) {
    super(message);
    this.name = 'ErreurPowerDelivery';
  }
}

function lireToken(): string {
  const token = process.env.POWERDELIVERY_TOKEN?.trim() ?? '';
  if (!token) throw new ErreurPowerDelivery(null, 'POWERDELIVERY_TOKEN absent de l’environnement');
  return token;
}

// Leurs messages d'erreur sont lisibles par un humain : on les remonte, faute
// de codes structurés. Un corps HTML de proxy, lui, ne dirait rien d'utile.
function messageDe(brut: unknown): string | null {
  if (brut && typeof brut === 'object') {
    for (const cle of ['message', 'error', 'erreur']) {
      const v = (brut as Record<string, unknown>)[cle];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

// LEURS DEUX ENDPOINTS N'AUTHENTIFIENT PAS PAREIL, et leur documentation
// annonce le token brut pour les deux — c'est faux, vérifié par appel réel le
// 23/09/2026 :
//
//   · les endpoints colis (addparcelsnew, trackparcel…) veulent le token BRUT ;
//     avec « Bearer », ils répondent 401 ;
//   · files/webhook.php veut « Bearer <token> » ; avec le token brut, il
//     répond 401 « Missing or invalid authorization header ».
//
// D'où ce drapeau plutôt qu'un en-tête unique : envoyer la mauvaise forme ne
// donne pas un message clair, mais le même 401 qu'une clé invalide — on
// chercherait un problème de token là où il n'y en a pas.
type FormeAuth = 'brut' | 'bearer';

async function appeler(
  methode: 'GET' | 'POST' | 'PUT' | 'DELETE',
  chemin: string,
  corps?: unknown,
  auth: FormeAuth = 'brut'
): Promise<unknown> {
  const token = lireToken();
  let reponse: Response;
  try {
    reponse = await fetch(`${baseUrl()}${chemin}`, {
      method: methode,
      headers: {
        Authorization: auth === 'bearer' ? `Bearer ${token}` : token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (erreur) {
    const expire = erreur instanceof Error && erreur.name === 'TimeoutError';
    throw new ErreurPowerDelivery(
      null,
      expire ? `${methode} ${chemin} : pas de réponse en ${DELAI_MS / 1000} s` : `${methode} ${chemin} : injoignable`
    );
  }

  const texte = await reponse.text();
  let brut: unknown = null;
  if (texte) {
    try {
      brut = JSON.parse(texte) as unknown;
    } catch {
      brut = texte.slice(0, 500);
    }
  }

  // `success: false` sous un 200 est possible chez eux : l'un OU l'autre suffit
  // à dire que la demande n'a pas abouti.
  const refuse = brut && typeof brut === 'object' && (brut as Record<string, unknown>).success === false;
  if (!reponse.ok || refuse) {
    const detail = messageDe(brut);
    throw new ErreurPowerDelivery(
      reponse.status,
      `${methode} ${chemin} → HTTP ${reponse.status}${detail ? ` — ${detail}` : ''}`,
      brut
    );
  }
  return brut;
}

// --- Construction d'un colis (PURE) -----------------------------------------

// Les seuls champs d'une Commande que Power a le droit de voir. Le type
// l'impose : `construireColisPower` ne reçoit pas le marchand, elle ne peut
// donc pas le transmettre par mégarde.
export interface ColisAConfier {
  codeSuivi: string;
  clientNom: string;
  clientTelephone: string;
  adresse: string;
  // Decimal Prisma, string ou number : converti ici, à la frontière.
  montantCod: { toString(): string } | number | string;
  ouvrir: boolean;
  fragile: boolean;
  aRemplacer: boolean;
  produitDescription: string | null;
  quantite: number;
}

export interface ColisPower {
  parcel_code: string;
  parcel_receiver: string;
  parcel_phone: string;
  parcel_city: number;
  parcel_price: number;
  parcel_address: string;
  parcel_note: string;
  parcel_product_name: string;
  parcel_product_qty: number;
  parcel_open: 0 | 1;
  parcel_payment_mode: 'COD';
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

export function codePower(codeSuivi: string): string {
  return `${PREFIXE_CODE_POWER}${codeSuivi}`;
}

// La note ne porte que des consignes STANDARDISÉES. `Commande.notes` n'y va
// pas : c'est du texte libre saisi par le marchand ou par nous, qui peut citer
// une boutique, un contact, un prix d'achat — rien qu'on sache relire avant
// chaque envoi.
function noteColis(colis: ColisAConfier): string {
  const consignes: string[] = [];
  if (colis.fragile) consignes.push('Colis fragile');
  // Leur API n'a aucun champ d'échange : la consigne est la seule trace que
  // leur livreur aura de l'ancien colis à récupérer.
  if (colis.aRemplacer) consignes.push('ÉCHANGE : récupérer l’ancien colis chez le client');
  return consignes.join(' — ');
}

export function construireColisPower(colis: ColisAConfier, cityId: number): ColisPower {
  const montant = Number(colis.montantCod.toString());
  if (!Number.isFinite(montant) || montant < 0) {
    throw new Error(`Montant COD invalide pour ${colis.codeSuivi}`);
  }
  return {
    parcel_code: codePower(colis.codeSuivi),
    parcel_receiver: colis.clientNom.trim(),
    parcel_phone: colis.clientTelephone.trim(),
    parcel_city: cityId,
    parcel_price: arrondi(montant),
    parcel_address: colis.adresse.trim(),
    parcel_note: noteColis(colis),
    parcel_product_name: colis.produitDescription?.trim() ?? '',
    parcel_product_qty: Math.max(1, Math.trunc(colis.quantite)),
    parcel_open: colis.ouvrir ? 1 : 0,
    parcel_payment_mode: 'COD',
  };
}

// --- Lecture défensive des réponses -----------------------------------------

function objet(valeur: unknown): Record<string, unknown> | null {
  return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null;
}

function chaine(valeur: unknown): string | null {
  if (typeof valeur === 'string' && valeur.trim()) return valeur.trim();
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return String(valeur);
  return null;
}

// Le code de suivi que LEUR système attribue, s'il en attribue un. Leur
// documentation ne montre pas la réponse de `addparcelsnew` ; les endroits
// essayés sont ceux où leurs autres réponses rangent le code (`parcel.code`).
// Null = on n'a rien trouvé, et c'est notre propre code qui servira de clé.
export function codeExterneDeReponse(brut: unknown): string | null {
  const racine = objet(brut);
  if (!racine) return null;
  const parcel = objet(racine.parcel) ?? objet(racine.data);
  return (
    chaine(parcel?.code) ??
    chaine(parcel?.tracking_code) ??
    chaine(racine.code) ??
    chaine(racine.tracking_code) ??
    chaine(racine.parcel_code)
  );
}

export interface SuiviPower {
  // Code de livraison tel que leur API le sert (DELIVERED, POSTPONED…).
  statut: string | null;
  paiement: string | null;
  brut: unknown;
}

export function lireSuivi(brut: unknown): SuiviPower {
  const racine = objet(brut);
  const parcel = objet(racine?.parcel);
  const tracking = objet(racine?.tracking);
  return {
    statut: chaine(parcel?.delivery_status) ?? chaine(tracking?.current_status),
    paiement: chaine(parcel?.payment_status),
    brut,
  };
}

// --- Les appels --------------------------------------------------------------

export interface ResultatCreation {
  codeExterne: string | null;
  brut: unknown;
}

export async function creerColisPower(colis: ColisPower): Promise<ResultatCreation> {
  const brut = await appeler('POST', '/addparcelsnew', colis);
  return { codeExterne: codeExterneDeReponse(brut), brut };
}

// Champs modifiables d'après leur documentation. Le code de suivi et le statut
// ne le sont pas, et ne figurent donc pas ici.
export interface ModificationPower {
  parcel_receiver?: string;
  parcel_phone?: string;
  parcel_city?: number;
  parcel_price?: number;
  parcel_address?: string;
  parcel_open?: 0 | 1;
}

export async function modifierColisPower(code: string, modification: ModificationPower): Promise<unknown> {
  return appeler('PUT', '/updateparcel', { parcel_code: code, ...modification });
}

export async function suivreColisPower(code: string): Promise<SuiviPower> {
  const brut = await appeler('GET', `/trackparcel?parcel_code=${encodeURIComponent(code)}`);
  return lireSuivi(brut);
}

export async function demanderRetourPower(code: string, raison: string | null): Promise<unknown> {
  return appeler('POST', '/request-return', { parcel_code: code, ...(raison && { reason: raison }) });
}

export interface Relivraison {
  raison: string | null;
  nouvelleAdresse: string | null;
  nouveauTelephone: string | null;
}

export async function demanderRelivraisonPower(code: string, relivraison: Relivraison): Promise<unknown> {
  return appeler('POST', '/request-redelivery', {
    parcel_code: code,
    ...(relivraison.raison && { reason: relivraison.raison }),
    ...(relivraison.nouvelleAdresse && { new_address: relivraison.nouvelleAdresse }),
    ...(relivraison.nouveauTelephone && { new_phone: relivraison.nouveauTelephone }),
  });
}

// --- Configuration du webhook -------------------------------------------------
// Un geste unique, fait par scripts/configurer-webhook-power-delivery.ts : pas
// d'écran pour une opération qu'on fait une fois par environnement.
//
// SEULS ENDPOINTS EN « Bearer » (cf. FormeAuth plus haut) : leur PHP de webhook
// n'authentifie pas comme le reste de leur API.

export interface ConfigurationWebhook {
  url: string;
  secret: string;
  events: string[];
  retry_count: number;
  timeout: number;
}

export async function lireWebhookPower(): Promise<unknown> {
  return appeler('GET', '/files/webhook.php', undefined, 'bearer');
}

export async function configurerWebhookPower(configuration: ConfigurationWebhook): Promise<unknown> {
  return appeler('POST', '/files/webhook.php', configuration, 'bearer');
}

export async function supprimerWebhookPower(): Promise<unknown> {
  return appeler('DELETE', '/files/webhook.php', undefined, 'bearer');
}
