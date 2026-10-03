// § Sous-traitance Meta Livraison — client de LEUR API
// (https://api.metalivraison.ma/colis-service/api/v1/partner).
//
// Nous sommes un CLIENT de leur API : nous leur remettons nos colis
// (`POST /colis`) et nous lisons leur suivi (`GET /colis?code=`). Eux nous
// poussent les changements de statut par webhook (lib/suivi-meta-livraison.ts).
//
// SOURCES. Leur documentation (fournie le 02/10/2026) donne les champs de
// création : obligatoires `code`, `destinataire`, `phone`, `address`, `price`,
// `colisStock`, et `cityId` ; facultatifs `quantity`, `canOpen`,
// `replaceColis`, `description`, `marchendise`. Vérifié en direct le même jour
// par des corps vides (refusés avant tout enregistrement) : enveloppe
// `{ success, message, data, errors, errorCode }`, validation en HTTP 400,
// « Colis introuvable » en HTTP 404 — le suivi se fait avec NOTRE code.
//
// ⚠️ Leur API IGNORE les champs qu'elle ne connaît pas : un champ mal nommé
// ne déclenche aucune erreur, il disparaît. Les noms ci-dessous sont recopiés
// de leur doc, `marchendise` compris (sic).
//
// La doc ne décrit pas la réponse d'une création unitaire : elle est lue de
// façon défensive et rendue BRUTE à l'appelant, qui la conserve.
//
// LE MARCHAND N'EST JAMAIS TRANSMIS (cf. `ColisAConfier`).

import type { ColisAConfier } from '@/lib/power-delivery';

export type { ColisAConfier };

// Surchargeable pour les TESTS uniquement : chaque création réelle part en
// livraison. Lue à chaque appel.
const BASE_URL_PAR_DEFAUT = 'https://api.metalivraison.ma/colis-service';

function baseUrl(): string {
  return (process.env.META_LIVRAISON_BASE_URL?.trim() || BASE_URL_PAR_DEFAUT).replace(/\/+$/, '');
}

const DELAI_MS = 20_000;

// Notre code chez eux, préfixé comme chez Power Delivery et Colivraison.
export const PREFIXE_CODE_META = 'MTH-';

export function codeMeta(codeSuivi: string): string {
  return `${PREFIXE_CODE_META}${codeSuivi}`;
}

export class ErreurMeta extends Error {
  constructor(
    // null = pas de réponse du tout : on ne sait PAS si la demande a abouti.
    readonly statutHttp: number | null,
    message: string,
    readonly brut: unknown = null
  ) {
    super(message);
    this.name = 'ErreurMeta';
  }
}

interface Identifiants {
  cle: string;
  secret: string;
}

function lireIdentifiants(): Identifiants {
  const cle = process.env.META_LIVRAISON_CLE?.trim() ?? '';
  const secret = process.env.META_LIVRAISON_SECRET?.trim() ?? '';
  if (!cle || !secret) throw new ErreurMeta(null, 'META_LIVRAISON_CLE ou META_LIVRAISON_SECRET absent de l’environnement');
  return { cle, secret };
}

// --- Lecture défensive (PURE) -------------------------------------------------

function objet(valeur: unknown): Record<string, unknown> | null {
  return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null;
}

function chaine(valeur: unknown): string | null {
  if (typeof valeur === 'string' && valeur.trim()) return valeur.trim();
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return String(valeur);
  return null;
}

// Le message d'une réponse, avec le détail de validation s'il y en a :
// « Validation failed — colis[0].phone : Le téléphone est obligatoire ».
export function messageMeta(brut: unknown): string | null {
  const racine = objet(brut);
  if (!racine) return typeof brut === 'string' ? chaine(brut) : null;
  const message = chaine(racine.message);
  const erreurs = objet(racine.errors);
  const details = erreurs
    ? Object.entries(erreurs)
        .map(([champ, texte]) => `${champ} : ${chaine(texte) ?? '?'}`)
        .join(' ; ')
    : '';
  return [message, details].filter(Boolean).join(' — ') || null;
}

// --- Construction d'un colis (PURE) ------------------------------------------

export interface ColisMeta {
  code: string;
  destinataire: string;
  phone: string;
  address: string;
  price: number;
  cityId: number;
  quantity: number;
  canOpen: boolean;
  replaceColis: boolean;
  // Consignes au livreur ; omis s'il n'y en a pas.
  description?: string;
  // Nature du contenu (leur orthographe) ; omis sans description produit.
  marchendise?: string;
  // Le colis vient de NOTRE entrepôt, pas de leur stock : jamais de
  // `colisDetails`.
  colisStock: false;
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

// Ouvrir et échanger ont leurs champs (`canOpen`, `replaceColis`) ; reste
// « fragile », qui part en `description`. `Commande.notes`, texte libre, n'y
// va jamais.
// `adresse` est l'adresse déjà complétée de la localité (adresseLivraisonMeta).
export function construireColisMeta(colis: ColisAConfier, cityId: number, adresse: string): ColisMeta {
  const montant = Number(colis.montantCod.toString());
  if (!Number.isFinite(montant) || montant < 0) {
    throw new Error(`Montant COD invalide pour ${colis.codeSuivi}`);
  }
  // Bornes de leur doc (modification-request) : marchendise de 2 à 255 caractères.
  const produit = colis.produitDescription?.trim().slice(0, 255) ?? '';
  return {
    code: codeMeta(colis.codeSuivi),
    destinataire: colis.clientNom.trim(),
    phone: colis.clientTelephone.trim(),
    address: adresse,
    price: arrondi(montant),
    cityId,
    quantity: Math.max(1, Math.trunc(colis.quantite)),
    canOpen: colis.ouvrir,
    replaceColis: colis.aRemplacer,
    ...(colis.fragile && { description: 'Colis fragile' }),
    ...(produit.length >= 2 && { marchendise: produit }),
    colisStock: false,
  };
}

// Le code que LEUR système attribue, s'il en renvoie un distinct du nôtre.
// La forme de `data` n'est pas connue : on accepte un objet, un tableau d'un
// élément, ou une liste sous `colis` / `created` / `items`.
export function codeExterneDeReponseMeta(brut: unknown, codeEnvoye: string): string | null {
  const data = objet(brut)?.data;
  const candidats: unknown[] = Array.isArray(data) ? data : [data];
  const d = objet(data);
  for (const cle of ['colis', 'created', 'items', 'success', 'results']) {
    if (d && Array.isArray(d[cle])) candidats.push(...(d[cle] as unknown[]));
  }
  for (const c of candidats) {
    const o = objet(c);
    if (!o) continue;
    for (const cle of ['trackingCode', 'tracking', 'codeSuivi', 'reference', 'code']) {
      const v = chaine(o[cle]);
      if (v && v.toUpperCase() !== codeEnvoye.toUpperCase()) return v;
    }
  }
  return null;
}

// Une réponse 200 peut porter un refus : `success: false`, ou — forme de leur
// bulk, documentée — `totalFailed > 0` avec le détail dans `errors`.
export function refusDansReponseMeta(brut: unknown): string | null {
  const racine = objet(brut);
  if (!racine) return 'réponse illisible';
  if (racine.success === false) return messageMeta(brut) ?? 'refusé';
  const data = objet(racine.data) ?? racine;
  const echecs = Number(data.totalFailed);
  const erreurs = data.errors;
  const listeErreurs = Array.isArray(erreurs) && erreurs.length > 0;
  if ((Number.isFinite(echecs) && echecs > 0) || listeErreurs) {
    return listeErreurs ? JSON.stringify(erreurs).slice(0, 300) : `${echecs} colis refusé(s)`;
  }
  return null;
}

// --- Les appels ----------------------------------------------------------------

async function appeler(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<unknown> {
  const { cle, secret } = lireIdentifiants();
  let reponse: Response;
  try {
    reponse = await fetch(`${baseUrl()}/api/v1/partner${chemin}`, {
      method: methode,
      headers: {
        'X-API-Key': cle,
        'X-API-Secret': secret,
        Accept: 'application/json',
        ...(corps !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (erreur) {
    const expire = erreur instanceof Error && erreur.name === 'TimeoutError';
    const cause = erreur instanceof Error ? (erreur.cause as { code?: unknown } | undefined)?.code : undefined;
    throw new ErreurMeta(
      null,
      expire
        ? `${methode} ${chemin.split('?')[0]} : pas de réponse en ${DELAI_MS / 1000} s`
        : `${methode} ${chemin.split('?')[0]} : injoignable${typeof cause === 'string' ? ` (${cause})` : ''}`
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
  if (!reponse.ok) {
    const detail = messageMeta(brut);
    throw new ErreurMeta(reponse.status, `${methode} ${chemin.split('?')[0]} → HTTP ${reponse.status}${detail ? ` — ${detail}` : ''}`, brut);
  }
  return brut;
}

export interface ResultatCreationMeta {
  codeExterne: string | null;
  brut: unknown;
}

// `POST /colis`, un colis par appel : une réponse par colis, donc une issue
// par colis sans apparier les lignes d'un lot.
export async function creerColisMeta(colis: ColisMeta): Promise<ResultatCreationMeta> {
  const brut = await appeler('POST', '/colis', colis);
  const refus = refusDansReponseMeta(brut);
  // Ils ont répondu : c'est un refus, pas une incertitude.
  if (refus) throw new ErreurMeta(200, `colis — ${refus}`, brut);
  return { codeExterne: codeExterneDeReponseMeta(brut, colis.code), brut };
}

export interface SuiviMeta {
  statut: string | null;
  libelle: string | null;
  planifieLe: string | null;
  livreurNom: string | null;
  livreurTelephone: string | null;
  injoignables: number | null;
  brut: unknown;
}

// Lecture du suivi, avec les noms de champs de leur webhook (`status`,
// `statusLabel`, `scheduledAt`, `delivererName`, `delivererPhone`) — la forme
// de cette réponse n'est pas documentée chez nous.
export function lireSuiviMeta(brut: unknown): SuiviMeta {
  const racine = objet(brut);
  const data = objet(racine?.data) ?? racine;
  const statut = chaine(data?.status) ?? chaine(data?.statut);
  return {
    statut: statut ? statut.toUpperCase() : null,
    libelle: chaine(data?.statusLabel) ?? chaine(data?.libelle),
    planifieLe: chaine(data?.scheduledAt),
    livreurNom: chaine(data?.delivererName),
    livreurTelephone: chaine(data?.delivererPhone),
    injoignables: typeof data?.unreachableCount === 'number' ? data.unreachableCount : null,
    brut,
  };
}

export async function suivreColisMeta(code: string): Promise<SuiviMeta> {
  // « Colis introuvable » arrive en HTTP 404 (relevé du 02/10/2026) : levé par
  // `appeler`, statutHttp 404.
  const brut = await appeler('GET', `/colis?code=${encodeURIComponent(code)}`);
  if (objet(brut)?.success === false) throw new ErreurMeta(200, `colis — ${messageMeta(brut) ?? 'refusé'}`, brut);
  return lireSuiviMeta(brut);
}
