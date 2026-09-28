import { Prisma } from '@/app/generated/prisma/client';
import type { BoutiqueYoucan } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { normalizePhoneMaroc } from '@/lib/auth';
import { checkBlacklist } from '@/lib/blacklist';
import { chiffrer, dechiffrer, ErreurChiffrement } from '@/lib/chiffrement';
import { nextCodeSuivi } from '@/lib/codes';
import { rapprocherVille } from '@/lib/shopify-villes';
import {
  ErreurYoucan,
  lireCommandeYoucan,
  signatureYoucanValide,
  type CommandeYoucanLue,
} from '@/lib/youcan-commandes';

// § Intégration YouCan (INTEGRATION_YOUCAN.md) — la partie qui parle à YouCan
// et à la base. Calquée sur lib/shopify.ts : le marchand saisit les
// identifiants de SA propre application YouCan (Client ID / Client Secret),
// qui servent aux jetons OAuth ET à vérifier les signatures. Seule différence
// de parcours : YouCan impose une autorisation par redirection pour délivrer
// le jeton. Les décisions sans état vivent dans lib/youcan-commandes.ts.

export { ErreurYoucan };

// Surchargeable pour les tests seulement (faux serveur local), comme
// EST_LIVRAISON_BASE_URL. Vide partout ailleurs.
const BASE_API = (process.env.YOUCAN_API_BASE_URL?.trim() || 'https://api.youcan.shop').replace(/\/+$/, '');
// L'écran d'autorisation vit sur un AUTRE hôte que l'API, et sous /admin :
// `/oauth/authorize` seul n'existe pas (doc « Connect OAuth »).
const URL_AUTORISATION = 'https://seller-area.youcan.shop/admin/oauth/authorize';

/**
 * Autorisations demandées au marchand. Toutes d'un coup : en ajouter une plus
 * tard ferait repasser chaque marchand par l'écran d'autorisation.
 *   - read-orders : lire la commande reçue (et le rattrapage) ;
 *   - edit-orders : réservé au retour d'expédition vers YouCan (pas encore fait) ;
 *   - read-products : importer le catalogue ;
 *   - read/edit/delete-rest-hooks : lister, créer et supprimer nos webhooks ;
 *   - view-store-info : GET /me, qui donne l'identifiant de la boutique.
 */
export const SCOPES_YOUCAN = [
  'read-orders',
  'edit-orders',
  'read-products',
  'read-rest-hooks',
  'edit-rest-hooks',
  'delete-rest-hooks',
  'view-store-info',
];

const DELAI_APPEL_MS = 15_000;
// Marge avant l'expiration du jeton d'accès (≈ 15 jours) : on le renouvelle
// dès qu'il lui reste moins d'un jour.
const MARGE_RENOUVELLEMENT_MS = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Identifiants de l'application YouCan DU MARCHAND
// ---------------------------------------------------------------------------
//
// Comme pour Shopify, chaque marchand crée sa propre application (Partner
// Dashboard YouCan, « Embedded » à False) et en saisit le Client ID et le
// Client Secret. Le secret signe les webhooks et le retour OAuth.

export interface IdentifiantsApplication {
  clientId: string;
  clientSecret: string;
}

/** Valide la FORME de la saisie, sans appel réseau. */
export function validerIdentifiants(brut: { clientId?: unknown; clientSecret?: unknown }): IdentifiantsApplication {
  const lire = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const clientId = lire(brut.clientId);
  const clientSecret = lire(brut.clientSecret);
  if (!/^\S{6,200}$/.test(clientId)) {
    throw new ErreurYoucan('identifiants_invalides', 'Client ID invalide : copiez-le depuis votre application YouCan (cl_…)');
  }
  if (!/^\S{16,500}$/.test(clientSecret)) {
    throw new ErreurYoucan('identifiants_invalides', 'Client Secret invalide : copiez-le depuis votre application YouCan');
  }
  if (clientSecret === clientId) {
    throw new ErreurYoucan('identifiants_invalides', 'Client ID et Client Secret identiques : les deux champs sont-ils inversés ?');
  }
  return { clientId, clientSecret };
}

function identifiantsDe(boutique: BoutiqueYoucan): IdentifiantsApplication {
  if (!boutique.clientId || !boutique.clientSecretChiffre) {
    throw new ErreurYoucan(
      'identifiants_absents',
      'Identifiants de l’application YouCan absents : reconnectez la boutique en les saisissant'
    );
  }
  return { clientId: boutique.clientId, clientSecret: dechiffrer(boutique.clientSecretChiffre) };
}

export const CHEMIN_CALLBACK_YOUCAN = '/api/integrations/youcan/callback';
export const CHEMIN_WEBHOOK_YOUCAN = '/api/v1/webhooks/youcan';

/**
 * URL de retour OAuth. Le marchand doit la déclarer À L'IDENTIQUE dans son
 * application YouCan (l'écran la lui affiche). Par défaut l'hôte marchand
 * effectivement servi ; la variable YOUCAN_REDIRECT_URI la fige (production, tunnel).
 */
export function urlRetourOAuth(origine: string): string {
  return process.env.YOUCAN_REDIRECT_URI?.trim() || `${origine}${CHEMIN_CALLBACK_YOUCAN}`;
}

/** URL publique des webhooks, ou `null` : même contrainte que Shopify (HTTPS, hôte HOST_API). */
export function urlWebhookYoucan(): string | null {
  const base = process.env.YOUCAN_WEBHOOK_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base || !/^https:\/\/[^/\s]+$/.test(base)) return null;
  return `${base}${CHEMIN_WEBHOOK_YOUCAN}`;
}

export function urlAutorisation(clientId: string, etat: string, redirection: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirection, response_type: 'code', state: etat });
  for (const scope of SCOPES_YOUCAN) params.append('scope[]', scope);
  return `${URL_AUTORISATION}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Client HTTP
// ---------------------------------------------------------------------------

function detailErreur(corps: unknown): string | null {
  if (typeof corps !== 'object' || corps === null) return null;
  const c = corps as Record<string, unknown>;
  // La doc montre `detail` en général, mais `error` pour une boutique suspendue.
  const detail = typeof c.detail === 'string' ? c.detail : typeof c.error === 'string' ? c.error : null;
  const champs = (c.meta as { fields?: Record<string, string[]> } | undefined)?.fields;
  if (champs && typeof champs === 'object') {
    const messages = Object.values(champs).flat().filter((m) => typeof m === 'string');
    if (messages.length) return `${detail ?? 'Données refusées'} : ${messages.join(' ; ')}`;
  }
  return detail;
}

async function appelerYoucan<T>(
  jeton: string,
  chemin: string,
  options: { methode?: 'GET' | 'POST'; corps?: Record<string, unknown> } = {}
): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(`${BASE_API}${chemin}`, {
      method: options.methode ?? 'GET',
      headers: {
        Authorization: `Bearer ${jeton}`,
        Accept: 'application/json',
        ...(options.corps ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.corps ? JSON.stringify(options.corps) : undefined,
      signal: AbortSignal.timeout(DELAI_APPEL_MS),
      cache: 'no-store',
    });
  } catch {
    throw new ErreurYoucan('injoignable', 'YouCan est injoignable pour le moment : réessayez dans un instant');
  }

  const corps: unknown = await reponse.json().catch(() => null);
  if (reponse.ok) return corps as T;

  const detail = detailErreur(corps);
  // 401 : jeton refusé, application non approuvée ou fonction inactive.
  if (reponse.status === 401) {
    throw new ErreurYoucan('autorisation_refusee', `YouCan refuse l’accès${detail ? ` (${detail})` : ''} : reconnectez la boutique`);
  }
  if (reponse.status === 402) throw new ErreurYoucan('boutique_indisponible', 'Boutique YouCan suspendue ou fermée');
  if (reponse.status === 404) throw new ErreurYoucan('introuvable', detail ?? 'Ressource introuvable chez YouCan');
  if (reponse.status === 429) {
    throw new ErreurYoucan('quota', detail ?? 'YouCan limite temporairement les appels : réessayez dans un instant');
  }
  if (reponse.status === 422) throw new ErreurYoucan('refuse', `YouCan refuse la requête : ${detail ?? 'données invalides'}`);
  throw new ErreurYoucan('erreur_youcan', `YouCan a répondu ${reponse.status}${detail ? ` : ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// Jetons OAuth
// ---------------------------------------------------------------------------

interface JetonsOAuth {
  jetonAcces: string;
  jetonRafraichissement: string;
  expireLe: Date;
}

async function appelerJetons(
  { clientId, clientSecret }: IdentifiantsApplication,
  parametres: Record<string, string>
): Promise<{ reponse: Response; corps: ReponseJetons | null }> {
  let reponse: Response;
  try {
    reponse = await fetch(`${BASE_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parametres }).toString(),
      signal: AbortSignal.timeout(DELAI_APPEL_MS),
      cache: 'no-store',
    });
  } catch {
    throw new ErreurYoucan('injoignable', 'YouCan est injoignable pour le moment : réessayez dans un instant');
  }
  return { reponse, corps: (await reponse.json().catch(() => null)) as ReponseJetons | null };
}

interface ReponseJetons {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  hint?: string;
  message?: string;
}

async function demanderJetons(
  identifiants: IdentifiantsApplication,
  parametres: Record<string, string>
): Promise<JetonsOAuth> {
  const { reponse, corps } = await appelerJetons(identifiants, parametres);
  if (!reponse.ok || !corps?.access_token || !corps.refresh_token) {
    if (reponse.status >= 500) throw new ErreurYoucan('erreur_youcan', `YouCan a répondu ${reponse.status}`);
    // Réponse OAuth standard (vérifiée le 2026-09-26) : `error` (invalid_grant,
    // invalid_client…) et `error_description`, parfois un `hint`.
    const detail = corps?.hint ?? corps?.error_description ?? corps?.message ?? corps?.error;
    throw new ErreurYoucan('autorisation_refusee', `YouCan refuse l’autorisation${detail ? ` (${detail})` : ''}`);
  }
  const secondes = Number(corps.expires_in);
  return {
    jetonAcces: corps.access_token,
    jetonRafraichissement: corps.refresh_token,
    expireLe: new Date(Date.now() + (Number.isFinite(secondes) && secondes > 0 ? secondes : 86_400) * 1000),
  };
}

/**
 * Teste des identifiants SANS boutique ni autorisation : on présente à YouCan
 * un code d'autorisation volontairement faux. Constaté le 2026-09-26 : un
 * couple valide est refusé sur le CODE (`invalid_grant`, 400), un couple faux
 * sur le CLIENT (`invalid_client`, 401). Rien n'est créé chez YouCan.
 */
export async function testerIdentifiantsYoucan(identifiants: IdentifiantsApplication, redirection: string): Promise<void> {
  const { reponse, corps } = await appelerJetons(identifiants, {
    grant_type: 'authorization_code',
    code: 'test-identifiants',
    redirect_uri: redirection,
  });
  // Le code d'erreur OAuth fait foi, pas le statut HTTP.
  if (corps?.error === 'invalid_client' || (reponse.status === 401 && !corps?.error)) {
    throw new ErreurYoucan(
      'identifiants_refuses',
      'YouCan refuse ces identifiants : vérifiez le Client ID et le Client Secret de votre application'
    );
  }
  if (reponse.status >= 500) throw new ErreurYoucan('erreur_youcan', `YouCan a répondu ${reponse.status}`);
  if (corps?.error !== 'invalid_grant' && corps?.error !== 'invalid_request') {
    throw new ErreurYoucan('erreur_youcan', `Réponse inattendue de YouCan (${corps?.error ?? reponse.status})`);
  }
}

function donneesJetons(jetons: JetonsOAuth) {
  return {
    jetonAccesChiffre: chiffrer(jetons.jetonAcces),
    jetonRafraichissementChiffre: chiffrer(jetons.jetonRafraichissement),
    jetonExpireLe: jetons.expireLe,
  };
}

// Renouvellements en cours, par boutique : deux webhooks simultanés partagent
// le même au lieu d'en lancer deux (cf. jetonAcces).
const renouvellementsEnCours = new Map<string, Promise<string>>();

/**
 * Jeton d'accès utilisable pour cette boutique, renouvelé s'il approche de
 * l'expiration.
 *
 * Le jeton de rafraîchissement est à usage unique : deux renouvellements
 * simultanés feraient échouer le second. Dans un même processus, ils sont
 * donc fusionnés ; entre processus, celui qui échoue relit la boutique et
 * prend les jetons que l'autre vient d'enregistrer.
 */
export async function jetonAcces(boutique: BoutiqueYoucan): Promise<string> {
  if (boutique.jetonExpireLe.getTime() - Date.now() > MARGE_RENOUVELLEMENT_MS) {
    return dechiffrer(boutique.jetonAccesChiffre);
  }
  const enCours = renouvellementsEnCours.get(boutique.id);
  if (enCours) return enCours;
  const renouvellement = renouveler(boutique).finally(() => renouvellementsEnCours.delete(boutique.id));
  renouvellementsEnCours.set(boutique.id, renouvellement);
  return renouvellement;
}

async function renouveler(boutique: BoutiqueYoucan): Promise<string> {
  try {
    const jetons = await demanderJetons(identifiantsDe(boutique), {
      grant_type: 'refresh_token',
      refresh_token: dechiffrer(boutique.jetonRafraichissementChiffre),
    });
    await prisma.boutiqueYoucan.update({ where: { id: boutique.id }, data: donneesJetons(jetons) });
    return jetons.jetonAcces;
  } catch (error) {
    const relue = await prisma.boutiqueYoucan.findUnique({ where: { id: boutique.id } });
    if (relue && relue.jetonExpireLe > boutique.jetonExpireLe) return dechiffrer(relue.jetonAccesChiffre);
    if (error instanceof ErreurYoucan && error.code === 'autorisation_refusee') {
      await prisma.boutiqueYoucan.update({
        where: { id: boutique.id },
        data: { derniereErreur: 'Autorisation YouCan expirée ou révoquée : reconnectez la boutique' },
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Boutique
// ---------------------------------------------------------------------------

interface BoutiqueMe {
  id?: string;
  store_id?: string;
  slug?: string;
  name?: string;
  domain?: string;
  currency?: { code?: string } | null;
}

export interface EtatBoutiqueYoucan {
  /** Client ID de l'application du marchand (non secret) ; jamais le secret. */
  clientId: string | null;
  nom: string | null;
  domaine: string | null;
  devise: string | null;
  connectee: boolean;
  connecteeLe: string;
  deconnecteeLe: string | null;
  webhookActif: boolean;
  derniereSynchroProduitsLe: string | null;
  derniereErreur: string | null;
  nbColis: number;
  nbMarchandises: number;
  receptions: { horodatage: string; issue: string; reference: string | null; message: string | null }[];
}

export async function lireEtatBoutiqueYoucan(marchandId: string): Promise<EtatBoutiqueYoucan | null> {
  const boutique = await prisma.boutiqueYoucan.findUnique({
    where: { marchandId },
    include: {
      _count: { select: { commandes: true, marchandises: true } },
      receptions: { orderBy: { horodatage: 'desc' }, take: 15 },
    },
  });
  if (!boutique) return null;
  return {
    clientId: boutique.clientId,
    nom: boutique.nom,
    domaine: boutique.domaine,
    devise: boutique.devise,
    connectee: !boutique.deconnecteeLe,
    connecteeLe: boutique.connecteeLe.toISOString(),
    deconnecteeLe: boutique.deconnecteeLe?.toISOString() ?? null,
    webhookActif: !boutique.deconnecteeLe && !!boutique.webhookCommandesId,
    derniereSynchroProduitsLe: boutique.derniereSynchroProduitsLe?.toISOString() ?? null,
    derniereErreur: boutique.derniereErreur,
    nbColis: boutique._count.commandes,
    nbMarchandises: boutique._count.marchandises,
    receptions: boutique.receptions.map((r) => ({
      horodatage: r.horodatage.toISOString(),
      issue: r.issue,
      reference: r.reference,
      message: r.message,
    })),
  };
}

function messageErreur(error: unknown): string {
  if (error instanceof ErreurYoucan || error instanceof ErreurChiffrement) return error.message;
  console.error('Intégration YouCan :', error);
  return 'Erreur interne';
}

export async function boutiqueYoucanConnectee(marchandId: string): Promise<BoutiqueYoucan> {
  const boutique = await prisma.boutiqueYoucan.findUnique({ where: { marchandId } });
  if (!boutique || boutique.deconnecteeLe) {
    throw new ErreurYoucan('aucune_boutique', 'Aucune boutique YouCan connectée');
  }
  return boutique;
}

// ---------------------------------------------------------------------------
// Webhooks (REST Hooks)
// ---------------------------------------------------------------------------

// S'abonner deux fois au même (événement, adresse) renvoie l'abonnement
// existant, et le réactive s'il avait été désactivé (doc « Subscribe ») :
// l'appel est donc sûr à rejouer, sans liste préalable.
async function abonner(jeton: string, evenement: string, uri: string): Promise<string> {
  const reponse = await appelerYoucan<{ id?: string }>(jeton, '/resthooks/subscribe', {
    methode: 'POST',
    corps: { event: evenement, target_url: uri },
  });
  if (!reponse?.id) throw new ErreurYoucan('webhook_refuse', `YouCan n’a pas confirmé l’abonnement ${evenement}`);
  return reponse.id;
}

async function desabonner(jeton: string, id: string): Promise<void> {
  await appelerYoucan(jeton, `/resthooks/unsubscribe/${encodeURIComponent(id)}`, { methode: 'POST' });
}

/** (Ré)abonne les webhooks et consigne l'issue sur la boutique. */
export async function activerWebhooksYoucan(boutique: BoutiqueYoucan): Promise<BoutiqueYoucan> {
  const uri = urlWebhookYoucan();
  if (!uri) {
    return prisma.boutiqueYoucan.update({
      where: { id: boutique.id },
      data: {
        webhookCommandesId: null,
        webhookDesinstallId: null,
        webhookUri: null,
        derniereErreur:
          'Webhook non créé : aucune URL publique HTTPS configurée (YOUCAN_WEBHOOK_BASE_URL). ' +
          'Les commandes n’arriveront pas tant qu’elle ne l’est pas.',
      },
    });
  }
  try {
    const jeton = await jetonAcces(boutique);
    const webhookCommandesId = await abonner(jeton, 'order.created', uri);
    // La désinstallation n'est pas indispensable : son échec ne bloque pas les commandes.
    const webhookDesinstallId = await abonner(jeton, 'app.uninstalled', uri).catch((error) => {
      console.warn('YouCan : abonnement app.uninstalled impossible', messageErreur(error));
      return null;
    });
    return prisma.boutiqueYoucan.update({
      where: { id: boutique.id },
      data: { webhookCommandesId, webhookDesinstallId, webhookUri: uri, derniereErreur: null },
    });
  } catch (error) {
    return prisma.boutiqueYoucan.update({
      where: { id: boutique.id },
      data: { webhookCommandesId: null, webhookDesinstallId: null, webhookUri: null, derniereErreur: messageErreur(error) },
    });
  }
}

// ---------------------------------------------------------------------------
// Connexion / déconnexion
// ---------------------------------------------------------------------------

export interface ResultatConnexionYoucan {
  nom: string | null;
  synchro: ResultatSynchroProduits | null;
  erreurSynchro: string | null;
}

/**
 * Termine l'autorisation OAuth : échange le code, identifie la boutique,
 * PUIS enregistre. Rien n'est écrit tant que YouCan n'a pas délivré de jetons.
 * Comme pour Shopify, l'échec des webhooks ou de l'import ne défait pas la
 * connexion : l'écran l'affiche et propose de réessayer.
 */
export async function connecterBoutiqueYoucan(
  marchandId: string,
  identifiants: IdentifiantsApplication,
  code: string,
  redirection: string
): Promise<ResultatConnexionYoucan> {
  const jetons = await demanderJetons(identifiants, { grant_type: 'authorization_code', code, redirect_uri: redirection });
  const me = await appelerYoucan<BoutiqueMe>(jetons.jetonAcces, '/me');
  const storeId = me?.store_id ?? me?.id;
  if (!storeId) throw new ErreurYoucan('erreur_youcan', 'YouCan n’a pas indiqué l’identifiant de la boutique');

  const autre = await prisma.boutiqueYoucan.findUnique({ where: { storeId }, select: { marchandId: true } });
  if (autre && autre.marchandId !== marchandId) {
    throw new ErreurYoucan(
      'boutique_deja_liee',
      'Cette boutique YouCan est déjà connectée à un autre compte marchand. Contactez le support.'
    );
  }
  const actuelle = await prisma.boutiqueYoucan.findUnique({ where: { marchandId } });
  if (actuelle && !actuelle.deconnecteeLe && actuelle.storeId !== storeId) {
    throw new ErreurYoucan(
      'autre_boutique_connectee',
      `La boutique ${actuelle.nom ?? actuelle.domaine ?? 'YouCan actuelle'} est déjà connectée : déconnectez-la d’abord`
    );
  }

  const donnees = {
    storeId,
    slug: me.slug ?? null,
    domaine: me.domain ?? null,
    nom: me.name ?? null,
    devise: me.currency?.code ?? null,
    clientId: identifiants.clientId,
    clientSecretChiffre: chiffrer(identifiants.clientSecret),
    ...donneesJetons(jetons),
    scopes: SCOPES_YOUCAN.join(' '),
    connecteeLe: new Date(),
    deconnecteeLe: null,
    derniereErreur: null,
  };
  let boutique = await prisma.boutiqueYoucan.upsert({
    where: { marchandId },
    create: { marchandId, ...donnees },
    update: donnees,
  });

  boutique = await activerWebhooksYoucan(boutique);

  let synchro: ResultatSynchroProduits | null = null;
  let erreurSynchro: string | null = null;
  try {
    synchro = await synchroniserProduitsYoucan(boutique);
  } catch (error) {
    erreurSynchro = messageErreur(error);
  }
  return { nom: boutique.nom, synchro, erreurSynchro };
}

export async function deconnecterBoutiqueYoucan(marchandId: string): Promise<void> {
  const boutique = await boutiqueYoucanConnectee(marchandId);
  // Best-effort, comme Shopify : une autorisation déjà révoquée ne doit pas
  // empêcher de déconnecter chez nous. Ce qui arriverait encore est refusé
  // (410, qui désactive l'abonnement chez YouCan).
  const ids = [boutique.webhookCommandesId, boutique.webhookDesinstallId].filter((id): id is string => !!id);
  if (ids.length > 0) {
    try {
      const jeton = await jetonAcces(boutique);
      for (const id of ids) await desabonner(jeton, id);
    } catch (error) {
      console.warn('YouCan : suppression des webhooks impossible à la déconnexion', messageErreur(error));
    }
  }
  await prisma.boutiqueYoucan.update({
    where: { id: boutique.id },
    data: {
      deconnecteeLe: new Date(),
      webhookCommandesId: null,
      webhookDesinstallId: null,
      webhookUri: null,
      derniereErreur: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Import des produits → Marchandise
// ---------------------------------------------------------------------------

export interface ResultatSynchroProduits {
  variantes: number;
  creees: number;
  misesAJour: number;
  rattachees: number;
}

interface VarianteYoucan {
  id?: string;
  sku?: string | null;
  price?: number | string | null;
  values?: string[] | null;
}

interface ProduitYoucan {
  id?: string;
  name?: string;
  price?: number | string | null;
  variants?: VarianteYoucan[];
}

interface PageYoucan<T> {
  data?: T[];
  meta?: { pagination?: { current_page?: number; total_pages?: number } };
}

const TAILLE_PAGE = 50;
const PAGES_MAX = 40; // 2 000 produits : garde-fou contre une pagination qui ne finirait pas

function nomMarchandise(produit: ProduitYoucan, variante: VarianteYoucan): string {
  const titre = produit.name?.trim() || 'Produit YouCan';
  const valeurs = (variante.values ?? []).filter((v) => typeof v === 'string' && v.trim() && v !== 'default');
  return valeurs.length > 0 ? `${titre} — ${valeurs.join(' / ')}` : titre;
}

/**
 * Importe le catalogue dans les Marchandises du marchand, une par variante.
 * Mêmes règles que Shopify (lib/shopify.ts, synchroniserProduits) : rejouable,
 * rattachement d'un homonyme saisi à la main, `qteStock` jamais touché, prix
 * dans la devise de la boutique sans conversion.
 */
export async function synchroniserProduitsYoucan(boutique: BoutiqueYoucan): Promise<ResultatSynchroProduits> {
  const jeton = await jetonAcces(boutique);
  const resultat: ResultatSynchroProduits = { variantes: 0, creees: 0, misesAJour: 0, rattachees: 0 };

  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const reponse = await appelerYoucan<PageYoucan<ProduitYoucan>>(
      jeton,
      `/products?include=variants&limit=${TAILLE_PAGE}&page=${page}`
    );
    const produits = reponse?.data ?? [];
    for (const produit of produits) {
      if (!produit.id) continue;
      // Un produit sans déclinaison a une variante unique « default ».
      const variantes = produit.variants?.length ? produit.variants : [];
      for (const variante of variantes) {
        if (!variante.id) continue;
        resultat.variantes += 1;
        resultat[await importerVariante(boutique, produit, variante)] += 1;
      }
    }
    const totalPages = reponse?.meta?.pagination?.total_pages;
    if (produits.length === 0 || (totalPages !== undefined ? page >= totalPages : produits.length < TAILLE_PAGE)) break;
  }

  await prisma.boutiqueYoucan.update({ where: { id: boutique.id }, data: { derniereSynchroProduitsLe: new Date() } });
  return resultat;
}

async function importerVariante(
  boutique: BoutiqueYoucan,
  produit: ProduitYoucan,
  variante: VarianteYoucan
): Promise<'creees' | 'misesAJour' | 'rattachees'> {
  const idVarianteYoucan = variante.id as string;
  const idProduitYoucan = produit.id as string;
  const prix = Math.max(0, Math.round(Number(variante.price ?? produit.price) * 100) / 100 || 0);
  const nom = nomMarchandise(produit, variante);
  const sku = variante.sku?.trim() || null;
  const marchandId = boutique.marchandId;

  const lien = await prisma.marchandiseYoucan.findUnique({
    where: { boutiqueId_idVarianteYoucan: { boutiqueId: boutique.id, idVarianteYoucan } },
    select: { marchandiseId: true },
  });

  if (lien) {
    const homonyme = await prisma.marchandise.findUnique({
      where: { marchandId_nom: { marchandId, nom } },
      select: { id: true },
    });
    await prisma.marchandise.update({
      where: { id: lien.marchandiseId },
      data: { prix, ...(homonyme && homonyme.id !== lien.marchandiseId ? {} : { nom }) },
    });
    await prisma.marchandiseYoucan.update({
      where: { marchandiseId: lien.marchandiseId },
      data: { sku, idProduitYoucan },
    });
    return 'misesAJour';
  }

  const homonyme = await prisma.marchandise.findUnique({
    where: { marchandId_nom: { marchandId, nom } },
    include: { youcan: { select: { id: true } }, shopify: { select: { id: true } } },
  });

  // Une marchandise saisie à la main (ni Shopify ni YouCan) sous le même nom
  // est le même article : rattachée plutôt que doublée.
  if (homonyme && !homonyme.youcan && !homonyme.shopify) {
    await prisma.$transaction([
      prisma.marchandise.update({ where: { id: homonyme.id }, data: { prix } }),
      prisma.marchandiseYoucan.create({
        data: { marchandiseId: homonyme.id, boutiqueId: boutique.id, idProduitYoucan, idVarianteYoucan, sku },
      }),
    ]);
    return 'rattachees';
  }

  const nomFinal = homonyme ? `${nom} [${sku ?? idVarianteYoucan.slice(0, 8)}]` : nom;
  await prisma.marchandise.create({
    data: {
      marchandId,
      nom: nomFinal,
      prix,
      youcan: { create: { boutiqueId: boutique.id, idProduitYoucan, idVarianteYoucan, sku } },
    },
  });
  return 'creees';
}

// ---------------------------------------------------------------------------
// Commande → colis
// ---------------------------------------------------------------------------

export type IssueReception = 'cree' | 'deja_recu' | 'ignore' | 'rejete' | 'erreur';

async function journaliser(entree: {
  boutiqueId: string | null;
  storeId: string | null;
  idLivraison: string | null;
  sujet: string | null;
  issue: IssueReception;
  reference?: string | null;
  message?: string | null;
}): Promise<void> {
  try {
    await prisma.webhookYoucanRecu.create({ data: { ...entree, message: entree.message?.slice(0, 1000) ?? null } });
  } catch (error) {
    console.error('Journal des webhooks YouCan :', error);
  }
}

function construireNotes(
  commande: CommandeYoucanLue,
  villeRetenue: { nom: string; methode: string } | null,
  telephoneNormalise: boolean
): string {
  const notes = [`Commande YouCan ${commande.numero}`];
  if (commande.devise && commande.devise !== 'MAD') notes.push(`Montant en ${commande.devise}, repris sans conversion`);
  if (commande.montantCod === 0) notes.push('Déjà payée en ligne : rien à encaisser');
  if (commande.ville && !villeRetenue) {
    notes.push(`Ville « ${commande.ville} » non reconnue dans notre réseau : à corriger`);
  } else if (villeRetenue && villeRetenue.methode !== 'exacte') {
    notes.push(`Ville saisie par le client : « ${commande.ville} »`);
  }
  if (commande.manquants.length > 0) notes.push(`À compléter : ${commande.manquants.join(', ')}`);
  if (commande.telephoneBrut && !telephoneNormalise) notes.push('Téléphone hors format marocain : à vérifier');
  if (commande.noteClient) notes.push(`Note : ${commande.noteClient}`);
  return notes.join('\n');
}

async function creerColis(
  boutique: BoutiqueYoucan,
  commande: CommandeYoucanLue,
  auteurId: string,
  codeSuiviPartenaire: string
): Promise<string> {
  const villes = await prisma.ville.findMany({ select: { id: true, nom: true } });
  const ville = commande.ville ? rapprocherVille(commande.ville, villes) : null;

  const telephoneNormalise = commande.telephoneBrut ? normalizePhoneMaroc(commande.telephoneBrut) : null;
  const clientTelephone = telephoneNormalise ?? commande.telephoneBrut ?? '';

  // RG-08 : liste noire, comme pour tout colis.
  const aRisque = await checkBlacklist({ telephone: clientTelephone, nom: commande.clientNom, adresse: commande.adresse });

  // Rattachement à la marchandise importée seulement pour une commande à UN
  // article : Commande.marchandiseId n'en désigne qu'un.
  const variante = commande.lignes.length === 1 ? commande.lignes[0].idVariante : null;
  const marchandiseId = variante
    ? ((
        await prisma.marchandiseYoucan.findUnique({
          where: { boutiqueId_idVarianteYoucan: { boutiqueId: boutique.id, idVarianteYoucan: variante } },
          select: { marchandiseId: true },
        })
      )?.marchandiseId ?? null)
    : null;

  const codeSuivi = await nextCodeSuivi();

  return prisma.$transaction(async (tx) => {
    const creee = await tx.commande.create({
      data: {
        codeSuivi,
        codeSuiviPartenaire,
        marchandId: boutique.marchandId,
        clientNom: commande.clientNom,
        clientTelephone,
        // Nom du RÉFÉRENTIEL quand la ville est reconnue (routage vers les hubs).
        ville: ville?.nom ?? commande.ville,
        villeId: ville?.id ?? null,
        adresse: commande.adresse,
        codePostal: commande.codePostal,
        produitDescription: commande.produitDescription,
        marchandiseId,
        quantite: commande.quantite,
        montantCod: commande.montantCod,
        notes: construireNotes(commande, ville, !!telephoneNormalise),
        statut: 'nouveau_colis',
        aRisque,
        source: 'api',
        youcan: {
          create: {
            boutiqueId: boutique.id,
            idCommandeYoucan: commande.idCommande,
            numero: commande.numero,
            devise: commande.devise,
          },
        },
      },
    });
    // RG-10 : état initial historisé, au nom du titulaire du compte marchand.
    await tx.historiqueStatutCommande.create({
      data: {
        commandeId: creee.id,
        ancienStatut: null,
        nouveauStatut: 'nouveau_colis',
        utilisateurId: auteurId,
        note: `Colis créé depuis la commande YouCan ${commande.numero}`,
      },
    });
    return creee.codeSuivi;
  });
}

function estDoublon(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function ingererCommande(
  boutique: BoutiqueYoucan,
  commande: CommandeYoucanLue
): Promise<{ issue: 'cree' | 'deja_recu'; message: string }> {
  const dejaLa = () =>
    prisma.commandeYoucan.findUnique({
      where: { boutiqueId_idCommandeYoucan: { boutiqueId: boutique.id, idCommandeYoucan: commande.idCommande } },
      select: { commande: { select: { codeSuivi: true } } },
    });

  const existante = await dejaLa();
  if (existante) return { issue: 'deja_recu', message: `Déjà reçue : colis ${existante.commande.codeSuivi}` };

  const marchand = await prisma.marchand.findUniqueOrThrow({
    where: { id: boutique.marchandId },
    select: { utilisateurId: true },
  });

  // Référence partenaire : la `ref` YouCan, que le marchand connaît ; repli
  // sur l'UUID si elle est déjà prise par un autre colis de ce marchand.
  for (const reference of [commande.numero, `youcan-${commande.idCommande}`]) {
    try {
      const codeSuivi = await creerColis(boutique, commande, marchand.utilisateurId, reference);
      return { issue: 'cree', message: `Colis ${codeSuivi} créé` };
    } catch (error) {
      if (!estDoublon(error)) throw error;
      const gagnante = await dejaLa();
      if (gagnante) return { issue: 'deja_recu', message: `Déjà reçue : colis ${gagnante.commande.codeSuivi}` };
    }
  }
  throw new ErreurYoucan('reference_occupee', `Référence ${commande.numero} déjà utilisée par un autre colis`);
}

// Sous-ressources nécessaires pour lire le destinataire, les articles et le
// statut de paiement (doc « Get Order », paramètre `include`).
const INCLUDES_COMMANDE = 'customer,variants,payment,shipping';

async function lireCommandeComplete(boutique: BoutiqueYoucan, idCommande: string): Promise<unknown> {
  const jeton = await jetonAcces(boutique);
  const reponse = await appelerYoucan<Record<string, unknown> | null>(
    jeton,
    `/orders/${encodeURIComponent(idCommande)}?include=${INCLUDES_COMMANDE}`
  );
  // La doc montre la commande à la racine ; une enveloppe `data` est tolérée.
  const enveloppe = reponse?.data;
  return typeof enveloppe === 'object' && enveloppe !== null && !Array.isArray(enveloppe) ? enveloppe : reponse;
}

// Erreurs passagères : YouCan relivrera le webhook si on répond 5xx.
const ERREURS_PASSAGERES = new Set(['injoignable', 'quota', 'erreur_youcan']);

// ---------------------------------------------------------------------------
// Rattrapage des commandes récentes
// ---------------------------------------------------------------------------

export const JOURS_RATTRAPAGE = 7;

export interface ResultatRattrapage {
  lues: number;
  creees: number;
  dejaRecues: number;
  ignorees: number;
  rejetees: number;
}

/** Même rôle que rattraperCommandes de Shopify : commandes d'avant la connexion ou webhooks perdus. */
export async function rattraperCommandesYoucan(boutique: BoutiqueYoucan): Promise<ResultatRattrapage> {
  const jeton = await jetonAcces(boutique);
  const depuis = Date.now() - JOURS_RATTRAPAGE * 24 * 3600 * 1000;
  const aTraiter: unknown[] = [];

  // Plus récentes d'abord ; on s'arrête à la première page qui dépasse la fenêtre.
  for (let page = 1; page <= 10; page += 1) {
    const reponse = await appelerYoucan<PageYoucan<{ created_at?: string }>>(
      jeton,
      `/orders?include=${INCLUDES_COMMANDE}&sort_field=created_at&sort_order=desc&limit=${TAILLE_PAGE}&page=${page}`
    );
    const commandes = reponse?.data ?? [];
    let horsFenetre = false;
    for (const c of commandes) {
      const date = c.created_at ? Date.parse(c.created_at) : NaN;
      if (Number.isFinite(date) && date < depuis) {
        horsFenetre = true;
        continue;
      }
      aTraiter.push(c);
    }
    const totalPages = reponse?.meta?.pagination?.total_pages;
    if (horsFenetre || commandes.length === 0 || (totalPages !== undefined && page >= totalPages)) break;
  }

  const resultat: ResultatRattrapage = { lues: 0, creees: 0, dejaRecues: 0, ignorees: 0, rejetees: 0 };
  const trace = { boutiqueId: boutique.id, storeId: boutique.storeId, idLivraison: null, sujet: 'rattrapage' };
  // Plus anciennes d'abord : les codes de suivi suivent l'ordre des commandes.
  for (const corps of aTraiter.reverse()) {
    resultat.lues += 1;
    let reference: string | null = null;
    try {
      const lecture = lireCommandeYoucan(corps);
      if (lecture.type === 'ignoree') {
        resultat.ignorees += 1;
        continue;
      }
      reference = lecture.commande.numero;
      const issue = await ingererCommande(boutique, lecture.commande);
      if (issue.issue === 'deja_recu') {
        resultat.dejaRecues += 1;
        continue;
      }
      resultat.creees += 1;
      const avertissement =
        lecture.commande.manquants.length > 0 ? ` — à compléter : ${lecture.commande.manquants.join(', ')}` : '';
      await journaliser({ ...trace, issue: 'cree', reference, message: `${issue.message} (rattrapage)${avertissement}` });
    } catch (error) {
      resultat.rejetees += 1;
      await journaliser({ ...trace, issue: 'rejete', reference, message: messageErreur(error) });
    }
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// Réception d'un webhook
// ---------------------------------------------------------------------------

export interface ReceptionWebhookYoucan {
  corpsBrut: Buffer;
  signature: string | null;
  sujet: string | null;
  idLivraison: string | null;
}

/**
 * Traite un webhook YouCan de bout en bout et dit quel code HTTP répondre.
 *
 * Effet des codes sur YouCan (doc « REST Hooks ») :
 *   · 2xx : livré ;
 *   · 4xx : pas de nouvelle tentative — 401 pour une signature fausse ;
 *   · 410 : l'abonnement est DÉSACTIVÉ — réponse à une boutique déconnectée
 *           ou inconnue, ce qui nettoie les abonnements orphelins. Une
 *           reconnexion le réactive (s'abonner à nouveau au même couple) ;
 *   · 5xx : jusqu'à 5 nouvelles tentatives sur ≈ 4 h — pour une panne chez
 *           nous ou chez YouCan (relecture de la commande impossible).
 */
export async function recevoirWebhookYoucan(
  reception: ReceptionWebhookYoucan
): Promise<{ statut: number; issue: IssueReception }> {
  const trace = { idLivraison: reception.idLivraison?.slice(0, 200) ?? null, sujet: reception.sujet?.slice(0, 100) ?? null };

  // La boutique se lit dans le corps AVANT la signature : c'est elle qui
  // désigne le secret à utiliser (chaque marchand a sa propre application).
  // Rien d'autre n'est lu ni écrit tant que la signature n'est pas vérifiée.
  let enveloppe: { event_name?: unknown; data?: unknown };
  try {
    enveloppe = JSON.parse(reception.corpsBrut.toString('utf8'));
  } catch {
    await journaliser({ ...trace, boutiqueId: null, storeId: null, issue: 'rejete', message: 'Corps JSON illisible' });
    return { statut: 400, issue: 'rejete' };
  }
  const data = (typeof enveloppe?.data === 'object' && enveloppe.data !== null ? enveloppe.data : {}) as Record<string, unknown>;
  const storeId = typeof data.store_id === 'string' ? data.store_id.slice(0, 100) : null;
  const boutique = storeId ? await prisma.boutiqueYoucan.findUnique({ where: { storeId } }) : null;

  let secret: string | null = null;
  try {
    secret = boutique?.clientSecretChiffre ? dechiffrer(boutique.clientSecretChiffre) : null;
  } catch (error) {
    // Clé de chiffrement changée ou absente : panne CHEZ NOUS, YouCan relivrera.
    await journaliser({ ...trace, boutiqueId: boutique?.id ?? null, storeId, issue: 'erreur', message: messageErreur(error) });
    return { statut: 500, issue: 'erreur' };
  }
  if (!boutique || !secret) {
    // Boutique inconnue (ou sans identifiants) : aucun secret pour vérifier.
    // 410 désactive l'abonnement orphelin chez YouCan.
    await journaliser({ ...trace, boutiqueId: boutique?.id ?? null, storeId, issue: 'rejete', message: 'Boutique inconnue' });
    return { statut: 410, issue: 'rejete' };
  }
  if (!signatureYoucanValide(reception.corpsBrut, reception.signature, secret)) {
    await journaliser({
      ...trace,
      boutiqueId: boutique.id,
      storeId,
      issue: 'rejete',
      message: 'Signature invalide : le Client Secret enregistré ne correspond pas à l’application YouCan',
    });
    return { statut: 401, issue: 'rejete' };
  }

  const sujet = (typeof enveloppe?.event_name === 'string' ? enveloppe.event_name : null) ?? reception.sujet;
  const traceBoutique = { ...trace, sujet, storeId };

  if (sujet === 'app.uninstalled') {
    if (!boutique.deconnecteeLe) {
      await prisma.boutiqueYoucan.update({
        where: { id: boutique.id },
        data: {
          deconnecteeLe: new Date(),
          webhookCommandesId: null,
          webhookDesinstallId: null,
          webhookUri: null,
          derniereErreur: 'Application désinstallée depuis YouCan : reconnectez la boutique pour recevoir les commandes',
        },
      });
    }
    await journaliser({ ...traceBoutique, boutiqueId: boutique.id, issue: 'ignore', message: 'Application désinstallée' });
    return { statut: 200, issue: 'ignore' };
  }

  if (boutique.deconnecteeLe) {
    await journaliser({ ...traceBoutique, boutiqueId: boutique.id, issue: 'rejete', message: 'Boutique déconnectée' });
    return { statut: 410, issue: 'rejete' };
  }
  const traceConnue = { ...traceBoutique, boutiqueId: boutique.id };

  if (sujet !== 'order.created') {
    await journaliser({ ...traceConnue, issue: 'ignore', message: `Événement ${sujet ?? 'inconnu'} non traité` });
    return { statut: 200, issue: 'ignore' };
  }

  let reference: string | null = typeof data.ref === 'string' ? data.ref : null;
  try {
    // La doc ne montre qu'une commande « abrégée » dans le webhook : on relit
    // la commande entière (destinataire, articles, paiement). Faute de mieux
    // (autorisation retirée…), on lit ce que le webhook apporte.
    let corps: unknown = data;
    let avertissementLecture = '';
    if (typeof data.id === 'string') {
      try {
        corps = await lireCommandeComplete(boutique, data.id);
      } catch (error) {
        if (error instanceof ErreurYoucan && ERREURS_PASSAGERES.has(error.code)) throw error;
        avertissementLecture = ` — relecture impossible (${messageErreur(error)}), colis créé d’après le webhook`;
      }
    }

    const lecture = lireCommandeYoucan(corps);
    if (lecture.type === 'ignoree') {
      await journaliser({ ...traceConnue, issue: 'ignore', reference: lecture.numero, message: lecture.motif });
      return { statut: 200, issue: 'ignore' };
    }
    reference = lecture.commande.numero;
    const resultat = await ingererCommande(boutique, lecture.commande);
    const avertissement =
      lecture.commande.manquants.length > 0 ? ` — à compléter : ${lecture.commande.manquants.join(', ')}` : '';
    await journaliser({
      ...traceConnue,
      issue: resultat.issue,
      reference,
      message: resultat.message + avertissement + avertissementLecture,
    });
    return { statut: 200, issue: resultat.issue };
  } catch (error) {
    if (error instanceof ErreurYoucan && !ERREURS_PASSAGERES.has(error.code)) {
      await journaliser({ ...traceConnue, issue: 'rejete', reference, message: error.message });
      return { statut: 200, issue: 'rejete' };
    }
    await journaliser({ ...traceConnue, issue: 'erreur', reference, message: messageErreur(error) });
    return { statut: 500, issue: 'erreur' };
  }
}

// ---------------------------------------------------------------------------
// Traduction pour les routes marchand
// ---------------------------------------------------------------------------

const STATUT_PAR_CODE: Record<string, number> = {
  identifiants_invalides: 400,
  identifiants_refuses: 400,
  identifiants_absents: 400,
  autorisation_refusee: 400,
  boutique_indisponible: 400,
  aucune_boutique: 404,
  boutique_deja_liee: 409,
  autre_boutique_connectee: 409,
  introuvable: 502,
  refuse: 502,
  injoignable: 502,
  quota: 503,
  erreur_youcan: 502,
  webhook_refuse: 502,
};

export function versApiErrorYoucan(error: unknown): unknown {
  if (error instanceof ErreurYoucan) return new ApiError(STATUT_PAR_CODE[error.code] ?? 400, error.message);
  if (error instanceof ErreurChiffrement) {
    console.error('Intégration YouCan, chiffrement :', error.message);
    return new ApiError(500, 'Intégration YouCan mal configurée sur la plateforme : contactez le support');
  }
  return error;
}

/** Message affichable d'une erreur survenue pendant le retour OAuth. */
export function messageErreurConnexion(error: unknown): string {
  return messageErreur(error);
}
