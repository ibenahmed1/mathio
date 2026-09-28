import { Prisma } from '@/app/generated/prisma/client';
import type { BoutiqueShopify } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/api-utils';
import { normalizePhoneMaroc } from '@/lib/auth';
import { checkBlacklist } from '@/lib/blacklist';
import { chiffrer, dechiffrer, ErreurChiffrement } from '@/lib/chiffrement';
import { nextCodeSuivi } from '@/lib/codes';
import {
  ErreurShopify,
  cleSecretePlausible,
  jetonAccesPlausible,
  lireCommandeShopify,
  normaliserDomaineShopify,
  signatureShopifyValide,
  type CommandeShopifyLue,
} from '@/lib/shopify-commandes';
import { rapprocherVille } from '@/lib/shopify-villes';

// § Intégration Shopify (INTEGRATION_SHOPIFY.md) — la partie qui parle à
// Shopify et à la base. Les décisions sans état (domaine, signature, lecture
// d'une commande, ville) vivent dans lib/shopify-commandes.ts et
// lib/shopify-villes.ts, testées en unitaire.

export { ErreurShopify };

// Version de l'Admin API, figée : c'est celle de l'application côté Shopify
// (réglage « Version du webhook » de l'app du marchand), et le corps des
// webhooks en dépend. Vérifié le 2026-09-26 : Shopify la sert
// (`x-shopify-api-version: 2026-07`) et y attend `uri` — l'ancien
// `callbackUrl` a disparu de WebhookSubscriptionInput.
export const VERSION_API_SHOPIFY = '2026-07';

// Sans ces deux accès, l'intégration ne peut pas faire son travail : lire les
// commandes (webhook ORDERS_CREATE compris) et importer le catalogue.
const ACCES_REQUIS = ['read_orders', 'read_products'];

// Shopify attend une réponse à ses webhooks en quelques secondes ; nos propres
// appels vers lui ne doivent pas bloquer plus longtemps un écran marchand.
const DELAI_APPEL_MS = 15_000;

// ---------------------------------------------------------------------------
// Client GraphQL
// ---------------------------------------------------------------------------

interface ReponseGraphQL<T> {
  data?: T;
  errors?: { message: string }[] | string;
}

async function appelerShopify<T>(
  domaine: string,
  jeton: string,
  requete: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(`https://${domaine}/admin/api/${VERSION_API_SHOPIFY}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': jeton },
      body: JSON.stringify({ query: requete, variables }),
      signal: AbortSignal.timeout(DELAI_APPEL_MS),
      cache: 'no-store',
    });
  } catch {
    throw new ErreurShopify('injoignable', `Boutique injoignable (${domaine}) : vérifiez le domaine`);
  }

  // Les messages nomment ce que le marchand doit corriger, dans ses termes à lui.
  if (reponse.status === 401) {
    throw new ErreurShopify('jeton_invalide', 'Jeton d’accès refusé par Shopify (shpat_…) : vérifiez-le ou régénérez-le');
  }
  if (reponse.status === 403) {
    throw new ErreurShopify('acces_refuse', 'Shopify refuse l’accès : l’application n’a pas les autorisations nécessaires');
  }
  if (reponse.status === 404) {
    throw new ErreurShopify('boutique_introuvable', `Aucune boutique Shopify à l’adresse ${domaine}`);
  }
  if (reponse.status === 402 || reponse.status === 423) {
    throw new ErreurShopify('boutique_indisponible', 'Boutique Shopify suspendue ou verrouillée');
  }
  if (reponse.status === 429) {
    throw new ErreurShopify('quota', 'Shopify limite temporairement les appels : réessayez dans un instant');
  }
  if (!reponse.ok) {
    throw new ErreurShopify('erreur_shopify', `Shopify a répondu ${reponse.status}`);
  }

  const corps = (await reponse.json()) as ReponseGraphQL<T>;
  if (corps.errors) {
    const message = typeof corps.errors === 'string' ? corps.errors : corps.errors.map((e) => e.message).join(' ; ');
    // Un champ refusé faute d'accès remonte ici, et non en 403.
    if (/access denied|access scope/i.test(message)) {
      throw new ErreurShopify('acces_refuse', `Autorisation manquante sur l’application Shopify : ${message}`);
    }
    throw new ErreurShopify('erreur_shopify', `Shopify : ${message}`);
  }
  if (!corps.data) throw new ErreurShopify('erreur_shopify', 'Réponse Shopify vide');
  return corps.data;
}

// ---------------------------------------------------------------------------
// Test des identifiants
// ---------------------------------------------------------------------------

export interface SaisieIdentifiants {
  domaine: string;
  jeton: string;
  cleSecrete: string;
}

export interface InfosBoutique {
  domaine: string;
  nom: string;
  devise: string;
  acces: string[];
}

/** Valide la FORME de la saisie, sans appel réseau. */
export function validerSaisie(brut: { domaine?: unknown; jeton?: unknown; cleSecrete?: unknown }): SaisieIdentifiants {
  const lire = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const domaine = normaliserDomaineShopify(lire(brut.domaine));
  if (!domaine) {
    throw new ErreurShopify('domaine_invalide', 'Domaine invalide : attendu « ma-boutique.myshopify.com »');
  }
  const jeton = lire(brut.jeton);
  if (!jetonAccesPlausible(jeton)) {
    throw new ErreurShopify('jeton_invalide', 'Jeton d’accès invalide : il commence par « shpat_ »');
  }
  const cleSecrete = lire(brut.cleSecrete);
  if (!cleSecretePlausible(cleSecrete)) {
    throw new ErreurShopify('cle_invalide', 'Clé secrète invalide : c’est la « clé secrète de l’API » (shpss_…)');
  }
  return { domaine, jeton, cleSecrete };
}

/**
 * Interroge la boutique avec le jeton saisi. Prouve que le domaine et le jeton
 * sont bons, et que l'application a les accès requis.
 *
 * La clé secrète, elle, NE PEUT PAS être vérifiée ici : Shopify ne l'emploie
 * que pour signer ses webhooks, aucun appel de l'API ne permet de la tester.
 * Elle l'est à la réception du premier webhook — une clé fausse y produit un
 * rejet « signature invalide », visible dans le journal de l'écran Intégrations.
 */
export async function testerConnexionShopify(saisie: { domaine: string; jeton: string }): Promise<InfosBoutique> {
  const data = await appelerShopify<{
    shop: { name: string; myshopifyDomain: string; currencyCode: string };
    currentAppInstallation: { accessScopes: { handle: string }[] };
  }>(
    saisie.domaine,
    saisie.jeton,
    `{ shop { name myshopifyDomain currencyCode } currentAppInstallation { accessScopes { handle } } }`
  );

  const acces = data.currentAppInstallation.accessScopes.map((s) => s.handle);
  // write_orders implique read_orders, write_products implique read_products.
  const manquants = ACCES_REQUIS.filter((a) => !acces.includes(a) && !acces.includes(a.replace('read_', 'write_')));
  if (manquants.length > 0) {
    throw new ErreurShopify(
      'acces_manquants',
      `Autorisations manquantes sur l’application Shopify : ${manquants.join(', ')}`
    );
  }

  return {
    domaine: data.shop.myshopifyDomain.toLowerCase(),
    nom: data.shop.name,
    devise: data.shop.currencyCode,
    acces,
  };
}

// ---------------------------------------------------------------------------
// Webhook ORDERS_CREATE
// ---------------------------------------------------------------------------

export const CHEMIN_WEBHOOK_SHOPIFY = '/api/v1/webhooks/shopify';

/**
 * URL publique que Shopify appellera, ou `null` si elle n'est pas configurée.
 *
 * Shopify n'appelle qu'une URL HTTPS joignable depuis Internet. Elle vit donc
 * dans une variable dédiée (SHOPIFY_WEBHOOK_BASE_URL) plutôt que d'être
 * déduite de HOST_API : en développement, HOST_API vaut 127.0.0.1:3000,
 * injoignable, et c'est un tunnel (ngrok…) qui fournit l'adresse publique —
 * dont l'hôte doit ALORS être celui de HOST_API, puisque le proxy ne sert
 * `/api/v1/**` que sur cet hôte-là.
 */
export function urlWebhookShopify(): string | null {
  const base = process.env.SHOPIFY_WEBHOOK_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base || !/^https:\/\/[^/\s]+$/.test(base)) return null;
  return `${base}${CHEMIN_WEBHOOK_SHOPIFY}`;
}

async function abonnerWebhookCommandes(domaine: string, jeton: string, uri: string): Promise<string> {
  // Réutiliser un abonnement identique plutôt que d'en créer un second : une
  // reconnexion ne doit pas doubler les webhooks (Shopify refuserait de toute
  // façon le doublon exact, avec un message moins clair).
  const existants = await appelerShopify<{
    webhookSubscriptions: { nodes: { id: string; uri: string }[] };
  }>(
    domaine,
    jeton,
    `query($topics: [WebhookSubscriptionTopic!]) { webhookSubscriptions(first: 50, topics: $topics) { nodes { id uri } } }`,
    { topics: ['ORDERS_CREATE'] }
  );
  const deja = existants.webhookSubscriptions.nodes.find((w) => w.uri === uri);
  if (deja) return deja.id;

  const data = await appelerShopify<{
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(
    domaine,
    jeton,
    `mutation($sujet: WebhookSubscriptionTopic!, $abonnement: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $sujet, webhookSubscription: $abonnement) {
        webhookSubscription { id }
        userErrors { message }
      }
    }`,
    { sujet: 'ORDERS_CREATE', abonnement: { uri, format: 'JSON' } }
  );
  const resultat = data.webhookSubscriptionCreate;
  if (resultat.userErrors.length > 0 || !resultat.webhookSubscription) {
    throw new ErreurShopify(
      'webhook_refuse',
      `Shopify refuse le webhook : ${resultat.userErrors.map((e) => e.message).join(' ; ') || 'raison inconnue'}`
    );
  }
  return resultat.webhookSubscription.id;
}

async function supprimerWebhook(domaine: string, jeton: string, id: string): Promise<void> {
  await appelerShopify(
    domaine,
    jeton,
    `mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } } }`,
    { id }
  );
}

// ---------------------------------------------------------------------------
// Boutique du marchand
// ---------------------------------------------------------------------------

/** Ce qu'un écran marchand peut voir d'une boutique : jamais les secrets. */
export interface EtatBoutiqueShopify {
  domaine: string;
  nom: string | null;
  devise: string | null;
  connectee: boolean;
  connecteeLe: string;
  deconnecteeLe: string | null;
  webhookActif: boolean;
  urlWebhook: string | null;
  derniereSynchroProduitsLe: string | null;
  derniereErreur: string | null;
  nbColis: number;
  nbMarchandises: number;
  receptions: {
    horodatage: string;
    issue: string;
    reference: string | null;
    message: string | null;
  }[];
}

export async function lireEtatBoutique(marchandId: string): Promise<EtatBoutiqueShopify | null> {
  const boutique = await prisma.boutiqueShopify.findUnique({
    where: { marchandId },
    include: {
      _count: { select: { commandes: true, marchandises: true } },
      receptions: { orderBy: { horodatage: 'desc' }, take: 15 },
    },
  });
  if (!boutique) return null;
  return {
    domaine: boutique.domaine,
    nom: boutique.nom,
    devise: boutique.devise,
    connectee: !boutique.deconnecteeLe,
    connecteeLe: boutique.connecteeLe.toISOString(),
    deconnecteeLe: boutique.deconnecteeLe?.toISOString() ?? null,
    webhookActif: !boutique.deconnecteeLe && !!boutique.webhookId,
    urlWebhook: boutique.webhookUri,
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

function jetonDe(boutique: BoutiqueShopify): string {
  return dechiffrer(boutique.jetonAccesChiffre);
}

function messageErreur(error: unknown): string {
  if (error instanceof ErreurShopify || error instanceof ErreurChiffrement) return error.message;
  console.error('Intégration Shopify :', error);
  return 'Erreur interne';
}

/** (Ré)abonne le webhook de commandes et consigne l'issue sur la boutique. */
export async function activerWebhookBoutique(boutique: BoutiqueShopify): Promise<BoutiqueShopify> {
  const uri = urlWebhookShopify();
  if (!uri) {
    return prisma.boutiqueShopify.update({
      where: { id: boutique.id },
      data: {
        webhookId: null,
        webhookUri: null,
        derniereErreur:
          'Webhook non créé : aucune URL publique HTTPS configurée (SHOPIFY_WEBHOOK_BASE_URL). ' +
          'Les commandes n’arriveront pas tant qu’elle ne l’est pas.',
      },
    });
  }
  try {
    const webhookId = await abonnerWebhookCommandes(boutique.domaine, jetonDe(boutique), uri);
    return prisma.boutiqueShopify.update({
      where: { id: boutique.id },
      data: { webhookId, webhookUri: uri, derniereErreur: null },
    });
  } catch (error) {
    return prisma.boutiqueShopify.update({
      where: { id: boutique.id },
      data: { webhookId: null, webhookUri: null, derniereErreur: messageErreur(error) },
    });
  }
}

export interface ResultatConnexion {
  infos: InfosBoutique;
  synchro: ResultatSynchroProduits | null;
  erreurSynchro: string | null;
}

/**
 * Connecte (ou reconnecte) la boutique d'un marchand. N'enregistre RIEN tant
 * que Shopify n'a pas accepté les identifiants : un jeton faux ne doit jamais
 * atterrir en base, même chiffré.
 *
 * L'abonnement au webhook et l'import des produits suivent, et leur échec ne
 * défait PAS la connexion : ils se relancent depuis l'écran, et l'erreur y est
 * affichée. Défaire la connexion obligerait le marchand à ressaisir ses
 * identifiants pour un problème qui n'est pas le leur (URL publique absente,
 * quota Shopify…).
 */
export async function connecterBoutique(marchandId: string, saisie: SaisieIdentifiants): Promise<ResultatConnexion> {
  const infos = await testerConnexionShopify(saisie);

  // Une boutique n'appartient qu'à un marchand : c'est par son domaine que ses
  // webhooks sont routés (cf. BoutiqueShopify).
  const autre = await prisma.boutiqueShopify.findUnique({ where: { domaine: infos.domaine }, select: { marchandId: true } });
  if (autre && autre.marchandId !== marchandId) {
    throw new ErreurShopify(
      'boutique_deja_liee',
      'Cette boutique Shopify est déjà connectée à un autre compte marchand. Contactez le support.'
    );
  }

  const actuelle = await prisma.boutiqueShopify.findUnique({ where: { marchandId } });
  // Changer de boutique sans déconnecter la précédente laisserait son webhook
  // actif chez Shopify, pointé vers nous, sans plus rien pour le vérifier.
  if (actuelle && !actuelle.deconnecteeLe && actuelle.domaine !== infos.domaine) {
    throw new ErreurShopify(
      'autre_boutique_connectee',
      `La boutique ${actuelle.domaine} est déjà connectée : déconnectez-la d’abord`
    );
  }

  const donnees = {
    domaine: infos.domaine,
    nom: infos.nom,
    devise: infos.devise,
    jetonAccesChiffre: chiffrer(saisie.jeton),
    cleSecreteChiffree: chiffrer(saisie.cleSecrete),
    connecteeLe: new Date(),
    deconnecteeLe: null,
    derniereErreur: null,
  };
  let boutique = await prisma.boutiqueShopify.upsert({
    where: { marchandId },
    create: { marchandId, ...donnees },
    update: donnees,
  });

  boutique = await activerWebhookBoutique(boutique);

  let synchro: ResultatSynchroProduits | null = null;
  let erreurSynchro: string | null = null;
  try {
    synchro = await synchroniserProduits(boutique);
  } catch (error) {
    erreurSynchro = messageErreur(error);
  }
  return { infos, synchro, erreurSynchro };
}

export async function deconnecterBoutique(marchandId: string): Promise<void> {
  const boutique = await prisma.boutiqueShopify.findUnique({ where: { marchandId } });
  if (!boutique || boutique.deconnecteeLe) {
    throw new ErreurShopify('aucune_boutique', 'Aucune boutique Shopify connectée');
  }
  // Suppression chez Shopify en best-effort : un jeton déjà révoqué par le
  // marchand ne doit pas l'empêcher de déconnecter chez nous. Les webhooks qui
  // arriveraient encore sont de toute façon refusés (boutique déconnectée).
  if (boutique.webhookId) {
    try {
      await supprimerWebhook(boutique.domaine, jetonDe(boutique), boutique.webhookId);
    } catch (error) {
      console.warn('Shopify : suppression du webhook impossible à la déconnexion', messageErreur(error));
    }
  }
  await prisma.boutiqueShopify.update({
    where: { id: boutique.id },
    data: { deconnecteeLe: new Date(), webhookId: null, webhookUri: null, derniereErreur: null },
  });
}

export async function boutiqueConnectee(marchandId: string): Promise<BoutiqueShopify> {
  const boutique = await prisma.boutiqueShopify.findUnique({ where: { marchandId } });
  if (!boutique || boutique.deconnecteeLe) {
    throw new ErreurShopify('aucune_boutique', 'Aucune boutique Shopify connectée');
  }
  return boutique;
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

interface VarianteShopify {
  id: string;
  title: string;
  sku: string | null;
  price: string;
}

interface ProduitShopify {
  id: string;
  title: string;
  status: string;
  variants: { nodes: VarianteShopify[] };
}

// Les identifiants GraphQL (gid://shopify/ProductVariant/123) sont ramenés à
// leur partie numérique : c'est sous cette forme que les webhooks REST de
// commande désignent la variante (`line_items[].variant_id`).
function idNumerique(gid: string): string {
  return gid.slice(gid.lastIndexOf('/') + 1);
}

function nomMarchandise(produit: ProduitShopify, variante: VarianteShopify): string {
  const titre = produit.title.trim() || 'Produit Shopify';
  return variante.title && variante.title !== 'Default Title' ? `${titre} — ${variante.title.trim()}` : titre;
}

// Page de 50 produits × 100 variantes : le coût GraphQL de la requête reste
// sous le plafond d'une requête unique (1 000 points).
const REQUETE_PRODUITS = `query($apres: String) {
  products(first: 50, after: $apres, query: "status:active OR status:draft") {
    pageInfo { hasNextPage endCursor }
    nodes { id title status variants(first: 100) { nodes { id title sku price } } }
  }
}`;

/**
 * Importe le catalogue de la boutique dans les Marchandises du marchand
 * (décision du 2026-09-26 : le catalogue simple qui alimente le formulaire
 * colis, pas l'inventaire entrepôt).
 *
 * Une marchandise par variante. Rejouable à volonté : une variante déjà liée
 * voit son prix et son nom mis à jour, jamais dupliquée. Une marchandise
 * saisie à la main sous le MÊME nom est rattachée plutôt que doublée — c'est
 * le même article, et deux lignes homonymes dans le formulaire colis ne se
 * distingueraient pas. `qteStock` n'est jamais touché : ce n'est pas le stock
 * Shopify, et l'application n'a d'ailleurs pas l'accès `read_inventory`.
 *
 * Le prix est repris dans la devise de la boutique, sans conversion (même
 * décision que pour le COD).
 */
export async function synchroniserProduits(boutique: BoutiqueShopify): Promise<ResultatSynchroProduits> {
  const jeton = jetonDe(boutique);
  const resultat: ResultatSynchroProduits = { variantes: 0, creees: 0, misesAJour: 0, rattachees: 0 };

  let apres: string | null = null;
  do {
    const page: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProduitShopify[] } } =
      await appelerShopify(boutique.domaine, jeton, REQUETE_PRODUITS, { apres });

    for (const produit of page.products.nodes) {
      for (const variante of produit.variants.nodes) {
        resultat.variantes += 1;
        const issue = await importerVariante(boutique, produit, variante);
        resultat[issue] += 1;
      }
    }
    apres = page.products.pageInfo.hasNextPage ? page.products.pageInfo.endCursor : null;
  } while (apres);

  await prisma.boutiqueShopify.update({
    where: { id: boutique.id },
    data: { derniereSynchroProduitsLe: new Date() },
  });
  return resultat;
}

async function importerVariante(
  boutique: BoutiqueShopify,
  produit: ProduitShopify,
  variante: VarianteShopify
): Promise<'creees' | 'misesAJour' | 'rattachees'> {
  const idVarianteShopify = idNumerique(variante.id);
  const idProduitShopify = idNumerique(produit.id);
  const prix = Math.max(0, Math.round(Number(variante.price) * 100) / 100 || 0);
  const nom = nomMarchandise(produit, variante);
  const sku = variante.sku?.trim() || null;
  const marchandId = boutique.marchandId;

  const lien = await prisma.marchandiseShopify.findUnique({
    where: { boutiqueId_idVarianteShopify: { boutiqueId: boutique.id, idVarianteShopify } },
    select: { marchandiseId: true },
  });

  if (lien) {
    // Le nom ne suit Shopify que s'il reste libre chez ce marchand.
    const homonyme = await prisma.marchandise.findUnique({
      where: { marchandId_nom: { marchandId, nom } },
      select: { id: true },
    });
    await prisma.marchandise.update({
      where: { id: lien.marchandiseId },
      data: { prix, ...(homonyme && homonyme.id !== lien.marchandiseId ? {} : { nom }) },
    });
    await prisma.marchandiseShopify.update({
      where: { marchandiseId: lien.marchandiseId },
      data: { sku, idProduitShopify },
    });
    return 'misesAJour';
  }

  const homonyme = await prisma.marchandise.findUnique({
    where: { marchandId_nom: { marchandId, nom } },
    include: { shopify: { select: { id: true } } },
  });

  if (homonyme && !homonyme.shopify) {
    await prisma.$transaction([
      prisma.marchandise.update({ where: { id: homonyme.id }, data: { prix } }),
      prisma.marchandiseShopify.create({
        data: { marchandiseId: homonyme.id, boutiqueId: boutique.id, idProduitShopify, idVarianteShopify, sku },
      }),
    ]);
    return 'rattachees';
  }

  // Homonyme déjà lié à une AUTRE variante (deux variantes au même titre) :
  // on distingue par le SKU, ou à défaut par l'identifiant de variante.
  const nomFinal = homonyme ? `${nom} [${sku ?? idVarianteShopify}]` : nom;
  await prisma.marchandise.create({
    data: {
      marchandId,
      nom: nomFinal,
      prix,
      shopify: { create: { boutiqueId: boutique.id, idProduitShopify, idVarianteShopify, sku } },
    },
  });
  return 'creees';
}

// ---------------------------------------------------------------------------
// Réception d'une commande → colis
// ---------------------------------------------------------------------------

export type IssueReception = 'cree' | 'deja_recu' | 'ignore' | 'rejete' | 'erreur';

async function journaliser(entree: {
  boutiqueId: string | null;
  domaine: string | null;
  idWebhook: string | null;
  sujet: string | null;
  issue: IssueReception;
  reference?: string | null;
  message?: string | null;
}): Promise<void> {
  try {
    await prisma.webhookShopifyRecu.create({
      data: { ...entree, message: entree.message?.slice(0, 1000) ?? null },
    });
  } catch (error) {
    // Le journal ne doit jamais faire échouer une réception.
    console.error('Journal des webhooks Shopify :', error);
  }
}

function construireNotes(
  commande: CommandeShopifyLue,
  villeRetenue: { nom: string; methode: string } | null,
  telephoneNormalise: boolean
): string {
  const notes = [`Commande Shopify ${commande.numero}`];
  if (commande.devise && commande.devise !== 'MAD') {
    notes.push(`Montant en ${commande.devise}, repris sans conversion`);
  }
  if (commande.montantCod === 0) notes.push('Déjà payée en ligne : rien à encaisser');
  if (commande.ville && !villeRetenue) {
    notes.push(`Ville « ${commande.ville} » non reconnue dans notre réseau : à corriger`);
  } else if (villeRetenue && villeRetenue.methode !== 'exacte') {
    notes.push(`Ville saisie par le client : « ${commande.ville} »`);
  }
  if (commande.manquants.length > 0) notes.push(`À compléter : ${commande.manquants.join(', ')}`);
  if (commande.telephoneBrut && !telephoneNormalise) notes.push('Téléphone hors format marocain : à vérifier');
  if (commande.noteClient) notes.push(`Note du client : ${commande.noteClient}`);
  return notes.join('\n');
}

async function creerColis(
  boutique: BoutiqueShopify,
  commande: CommandeShopifyLue,
  auteurId: string,
  codeSuiviPartenaire: string
): Promise<string> {
  const villes = await prisma.ville.findMany({ select: { id: true, nom: true } });
  const ville = commande.ville ? rapprocherVille(commande.ville, villes) : null;

  const telephoneNormalise = commande.telephoneBrut ? normalizePhoneMaroc(commande.telephoneBrut) : null;
  const clientTelephone = telephoneNormalise ?? commande.telephoneBrut ?? '';

  // RG-08 : la liste noire s'applique à une commande Shopify comme à toute autre.
  const aRisque = await checkBlacklist({ telephone: clientTelephone, nom: commande.clientNom, adresse: commande.adresse });

  // Rattachement à la marchandise importée, seulement quand la commande ne
  // porte qu'UN article distinct : Commande.marchandiseId n'en désigne qu'un.
  const variantes = [...new Set(commande.lignes.map((l) => l.idVariante).filter((v): v is string => !!v))];
  const marchandiseId =
    variantes.length === 1 && commande.lignes.length === 1
      ? ((
          await prisma.marchandiseShopify.findUnique({
            where: { boutiqueId_idVarianteShopify: { boutiqueId: boutique.id, idVarianteShopify: variantes[0] } },
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
        // Le nom du RÉFÉRENTIEL quand la ville est reconnue : le routage vers
        // les hubs lit ce texte (lib/hub-envoi.ts), pas villeId. La saisie
        // d'origine est conservée dans la note.
        ville: ville?.nom ?? commande.ville,
        villeId: ville?.id ?? null,
        adresse: commande.adresse,
        codePostal: commande.codePostal,
        produitDescription: commande.produitDescription,
        marchandiseId,
        quantite: commande.quantite,
        poidsKg: commande.poidsKg,
        montantCod: commande.montantCod,
        notes: construireNotes(commande, ville, !!telephoneNormalise),
        statut: 'nouveau_colis',
        aRisque,
        source: 'api',
        shopify: {
          create: {
            boutiqueId: boutique.id,
            idCommandeShopify: commande.idCommande,
            numero: commande.numero,
            devise: commande.devise,
          },
        },
      },
    });

    // RG-10 : l'état initial est historisé. L'auteur est le titulaire du
    // compte marchand — c'est sa boutique qui a passé la commande.
    await tx.historiqueStatutCommande.create({
      data: {
        commandeId: creee.id,
        ancienStatut: null,
        nouveauStatut: 'nouveau_colis',
        utilisateurId: auteurId,
        note: `Colis créé depuis la commande Shopify ${commande.numero}`,
      },
    });
    return creee.codeSuivi;
  });
}

function estDoublon(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function ingererCommande(
  boutique: BoutiqueShopify,
  commande: CommandeShopifyLue
): Promise<{ issue: 'cree' | 'deja_recu'; message: string }> {
  const dejaLa = () =>
    prisma.commandeShopify.findUnique({
      where: { boutiqueId_idCommandeShopify: { boutiqueId: boutique.id, idCommandeShopify: commande.idCommande } },
      select: { commande: { select: { codeSuivi: true } } },
    });

  const existante = await dejaLa();
  if (existante) return { issue: 'deja_recu', message: `Déjà reçue : colis ${existante.commande.codeSuivi}` };

  const marchand = await prisma.marchand.findUniqueOrThrow({
    where: { id: boutique.marchandId },
    select: { utilisateurId: true },
  });

  // Le numéro Shopify sert de référence partenaire, pour que le marchand
  // retrouve sa commande. Il peut entrer en collision avec un colis saisi à la
  // main sous la même référence (commandes_marchand_ref_partenaire_key) : on
  // se rabat alors sur l'identifiant Shopify, unique par construction.
  const references = [commande.numero, `shopify-${commande.idCommande}`];
  for (const reference of references) {
    try {
      const codeSuivi = await creerColis(boutique, commande, marchand.utilisateurId, reference);
      return { issue: 'cree', message: `Colis ${codeSuivi} créé` };
    } catch (error) {
      if (!estDoublon(error)) throw error;
      // Deux livraisons simultanées du même webhook : la contrainte
      // (boutique, commande) a arrêté la seconde. C'est un succès.
      const gagnante = await dejaLa();
      if (gagnante) return { issue: 'deja_recu', message: `Déjà reçue : colis ${gagnante.commande.codeSuivi}` };
    }
  }
  throw new ErreurShopify('reference_occupee', `Référence ${commande.numero} déjà utilisée par un autre colis`);
}

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

/**
 * Importe les commandes des derniers jours que le webhook n'a pas apportées :
 * celles passées AVANT la connexion (Shopify ne notifie que l'avenir), et
 * celles dont le webhook a échoué chez nous (tunnel coupé, serveur arrêté…) et
 * que Shopify n'a pas encore renvoyées.
 *
 * Lecture par l'API REST `orders.json` et non GraphQL : elle rend exactement
 * le format des webhooks, donc la même lecture (lireCommandeShopify) et la même
 * ingestion s'appliquent — aucune seconde traduction à maintenir. Idempotent
 * par construction : une commande déjà reçue n'est jamais doublée.
 */
export async function rattraperCommandes(boutique: BoutiqueShopify): Promise<ResultatRattrapage> {
  const depuis = new Date(Date.now() - JOURS_RATTRAPAGE * 24 * 3600 * 1000).toISOString();
  let reponse: Response;
  try {
    reponse = await fetch(
      `https://${boutique.domaine}/admin/api/${VERSION_API_SHOPIFY}/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(depuis)}`,
      {
        headers: { 'X-Shopify-Access-Token': jetonDe(boutique) },
        signal: AbortSignal.timeout(DELAI_APPEL_MS),
        cache: 'no-store',
      }
    );
  } catch {
    throw new ErreurShopify('injoignable', `Boutique injoignable (${boutique.domaine})`);
  }
  if (reponse.status === 401) throw new ErreurShopify('jeton_invalide', 'Jeton d’accès refusé par Shopify : reconnectez la boutique');
  if (!reponse.ok) throw new ErreurShopify('erreur_shopify', `Shopify a répondu ${reponse.status}`);
  const { orders } = (await reponse.json()) as { orders?: unknown[] };

  const resultat: ResultatRattrapage = { lues: 0, creees: 0, dejaRecues: 0, ignorees: 0, rejetees: 0 };
  const trace = { boutiqueId: boutique.id, domaine: boutique.domaine, idWebhook: null, sujet: 'rattrapage' };
  // Plus anciennes d'abord : les codes de suivi suivent l'ordre des commandes.
  for (const corps of [...(orders ?? [])].reverse()) {
    resultat.lues += 1;
    let reference: string | null = null;
    try {
      const lecture = lireCommandeShopify(corps);
      if (lecture.type === 'ignoree') {
        resultat.ignorees += 1;
        continue; // pas de ligne de journal : rejouer le rattrapage la réécrirait à chaque fois
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
      if (!(error instanceof ErreurShopify)) console.error('Rattrapage Shopify :', error);
      resultat.rejetees += 1;
      await journaliser({ ...trace, issue: 'rejete', reference, message: messageErreur(error) });
    }
  }
  return resultat;
}

export interface ReceptionWebhook {
  corpsBrut: Buffer;
  domaine: string | null;
  signature: string | null;
  sujet: string | null;
  idWebhook: string | null;
}

/**
 * Traite un webhook Shopify de bout en bout et dit quel code HTTP répondre.
 *
 * Le code pilote les nouvelles tentatives de Shopify (plusieurs sur quelques
 * heures, puis abandon — et suppression de l'abonnement s'il échoue trop) :
 *   · 401 : boutique inconnue ou signature fausse — réessayer ne changera rien
 *           tant que la clé secrète n'est pas corrigée ;
 *   · 200 : tout ce qui a été lu, y compris une commande ignorée ou déjà
 *           reçue — la rejouer ne changerait rien ;
 *   · 500 : une panne chez nous, pour que Shopify réessaie.
 */
export async function recevoirWebhookShopify(reception: ReceptionWebhook): Promise<{ statut: number; issue: IssueReception }> {
  const domaine = reception.domaine ? normaliserDomaineShopify(reception.domaine) : null;
  const trace = { domaine: domaine ?? reception.domaine?.slice(0, 200) ?? null, idWebhook: reception.idWebhook, sujet: reception.sujet };

  const boutique = domaine ? await prisma.boutiqueShopify.findUnique({ where: { domaine } }) : null;
  if (!boutique || boutique.deconnecteeLe) {
    await journaliser({
      ...trace,
      boutiqueId: boutique?.id ?? null,
      issue: 'rejete',
      message: boutique ? 'Boutique déconnectée' : 'Boutique inconnue',
    });
    return { statut: 401, issue: 'rejete' };
  }

  let secret: string;
  try {
    secret = dechiffrer(boutique.cleSecreteChiffree);
  } catch (error) {
    // Clé de chiffrement changée ou absente : c'est une panne CHEZ NOUS.
    await journaliser({ ...trace, boutiqueId: boutique.id, issue: 'erreur', message: messageErreur(error) });
    return { statut: 500, issue: 'erreur' };
  }

  if (!signatureShopifyValide(reception.corpsBrut, reception.signature, secret)) {
    // Ni lecture du corps ni création : seulement une trace. Le cas courant
    // n'est pas une attaque mais une clé secrète mal recopiée — d'où un
    // message qui dit quoi vérifier.
    await journaliser({
      ...trace,
      boutiqueId: boutique.id,
      issue: 'rejete',
      message: 'Signature invalide : vérifiez la clé secrète de l’API (shpss_…)',
    });
    return { statut: 401, issue: 'rejete' };
  }

  // Seul orders/create est souscrit. Tout autre sujet est accusé sans effet,
  // pour que Shopify ne s'acharne pas.
  if (reception.sujet && reception.sujet !== 'orders/create') {
    await journaliser({ ...trace, boutiqueId: boutique.id, issue: 'ignore', message: `Sujet ${reception.sujet} non traité` });
    return { statut: 200, issue: 'ignore' };
  }

  let reference: string | null = null;
  try {
    let corps: unknown;
    try {
      corps = JSON.parse(reception.corpsBrut.toString('utf8'));
    } catch {
      throw new ErreurShopify('corps_invalide', 'Corps JSON illisible');
    }
    const lecture = lireCommandeShopify(corps);
    if (lecture.type === 'ignoree') {
      await journaliser({ ...trace, boutiqueId: boutique.id, issue: 'ignore', reference: lecture.numero, message: lecture.motif });
      return { statut: 200, issue: 'ignore' };
    }
    reference = lecture.commande.numero;

    const resultat = await ingererCommande(boutique, lecture.commande);
    const avertissement =
      lecture.commande.manquants.length > 0 ? ` — à compléter : ${lecture.commande.manquants.join(', ')}` : '';
    await journaliser({
      ...trace,
      boutiqueId: boutique.id,
      issue: resultat.issue,
      reference,
      message: resultat.message + avertissement,
    });
    return { statut: 200, issue: resultat.issue };
  } catch (error) {
    if (error instanceof ErreurShopify) {
      // Commande illisible ou référence bloquée : la rejouer donnerait le
      // même résultat. Accusée, et visible dans le journal du marchand.
      await journaliser({ ...trace, boutiqueId: boutique.id, issue: 'rejete', reference, message: error.message });
      return { statut: 200, issue: 'rejete' };
    }
    await journaliser({ ...trace, boutiqueId: boutique.id, issue: 'erreur', reference, message: messageErreur(error) });
    return { statut: 500, issue: 'erreur' };
  }
}

// ---------------------------------------------------------------------------
// Traduction pour les routes marchand
// ---------------------------------------------------------------------------

const STATUT_PAR_CODE: Record<string, number> = {
  domaine_invalide: 400,
  jeton_invalide: 400,
  cle_invalide: 400,
  acces_refuse: 400,
  acces_manquants: 400,
  boutique_introuvable: 400,
  boutique_indisponible: 400,
  aucune_boutique: 404,
  boutique_deja_liee: 409,
  autre_boutique_connectee: 409,
  // Shopify indisponible ou en erreur : le problème n'est ni chez le marchand
  // ni chez nous.
  injoignable: 502,
  quota: 503,
  erreur_shopify: 502,
  webhook_refuse: 502,
};

/**
 * Une ErreurShopify devient une ApiError au statut juste ; une erreur de
 * chiffrement (clé absente ou changée) reste une panne interne, journalisée,
 * dont le détail ne sort pas vers le marchand.
 */
export function versApiError(error: unknown): unknown {
  if (error instanceof ErreurShopify) return new ApiError(STATUT_PAR_CODE[error.code] ?? 400, error.message);
  if (error instanceof ErreurChiffrement) {
    console.error('Intégration Shopify, chiffrement :', error.message);
    return new ApiError(500, 'Intégration Shopify mal configurée sur la plateforme : contactez le support');
  }
  return error;
}
