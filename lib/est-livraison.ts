// § Sous-traitance EST Livraison — client de LEUR API (https://pb.estlivraison.com).
//
// Nous sommes ici un CLIENT de leur API, comme n'importe quelle boutique : nous
// leur déposons nos colis, ils les ramassent et les livrent. C'est le sens
// inverse de /api/v1/livraisons/statut (API_SUIVI_PRESTATAIRES.md), où c'est le
// transporteur qui nous appelle — et c'est par là, et par là seulement, que
// l'issue des colis nous reviendra : leur API ne sert AUCUNE lecture.
//
// QUATRE RÈGLES tiennent ce fichier :
//
//  1. LA CLÉ NE SORT JAMAIS. Ni dans un message d'erreur, ni dans un journal,
//     ni dans une réponse. Elle vaut pleins pouvoirs sur notre compte chez eux
//     — créer des colis COD en notre nom, supprimer ceux qui ne sont pas encore
//     ramassés — et leur API ne connaît aucune notion de portée.
//
//  2. LEUR DOCUMENTATION N'EST PAS LEUR API. Leur OpenAPI décrit un dépôt EN
//     LOT, sous une enveloppe `{ commands: [...] }`, avec une réponse au
//     pluriel. Leur serveur, lui, attend un objet PLAT — un colis par appel —
//     et répond au singulier. Constaté contre leur serveur le 23/09/2026 ;
//     preuves et détail dans INTEGRATION_EST_LIVRAISON.md §3. Ce fichier suit
//     ce qu'ils FONT, pas ce qu'ils écrivent, tout en tolérant la forme
//     documentée au cas où ils aligneraient leur API sur leur doc.
//
//  3. `city_created` EST UNE ALARME, PAS UNE INFORMATION. Leur API CRÉE la
//     ville quand elle ne la connaît pas, au lieu de refuser. Une ville créée
//     par notre appel est donc la preuve qu'on a envoyé un libellé faux, et que
//     le colis part dans une ville que personne ne dessert. La création est
//     alors traitée comme un ÉCHEC (cf. `lireCreation`), jamais comme un succès.
//     `null` — et non un tableau vide — est ce qu'ils rendent quand la ville
//     existait déjà.
//
//  4. LE MARCHAND N'EST JAMAIS TRANSMIS. Leurs champs `client_name` et
//     `client_phone` restent vides : leur sens n'est pas documenté, et le seul
//     sens plausible — l'expéditeur — désignerait notre marchand. Le leur
//     donner, c'est leur donner notre client. `construireCommandeEst` n'a même
//     pas accès au marchand.

// Surchargeable par EST_LIVRAISON_BASE_URL, et uniquement pour les TESTS :
// c'est ce qui permet d'exercer toute la chaîne contre un faux serveur local,
// sans créer un seul vrai colis chez eux — chaque appel réel à `add-rammasage`
// déclenche un ramassage. Lue à chaque appel, pas au chargement du module.
const BASE_URL_PAR_DEFAUT = 'https://pb.estlivraison.com';

function baseUrl(): string {
  return (process.env.EST_LIVRAISON_BASE_URL?.trim() || BASE_URL_PAR_DEFAUT).replace(/\/+$/, '');
}

// Les deux chemins de leur API, recopiés À L'IDENTIQUE depuis leur OpenAPI.
// « rammasage » porte leur faute de frappe (deux m, un s) et le préfixe est
// `/v1/api` et non `/api/v1` : corriger l'un ou l'autre donne un 404.
const CHEMIN_CREATION = '/v1/api/clients/commands/add-rammasage';

// ⚠️ CE CHEMIN N'EXISTE PAS sur leur serveur : 404 générique de PocketBase, le
// 23/09/2026, ainsi que cinq transpositions du préfixe et quatre variantes du
// nom (`delete-rammasage`, `remove`, `cancel`, `delete-commands`). L'annulation
// d'un colis déposé est donc IMPOSSIBLE aujourd'hui — il faut la leur demander
// à la main. Le chemin reste ici pour que le jour où ils le déploient, il n'y
// ait qu'une ligne à confirmer. Le corps envoyé est celui de leur doc, jamais
// observé (INTEGRATION_EST_LIVRAISON.md §3.2).
const CHEMIN_SUPPRESSION = '/v1/api/clients/commands/delete';

// Un appel qui ne répond pas en 20 s ne répondra pas mieux en 60, et l'appelant
// est souvent un humain qui attend devant un bouton.
const DELAI_MS = 20_000;

// Longueur maximale de leurs champs texte, annoncée par leur schéma. Au-delà
// ils répondent 400 sans rien créer.
const LONGUEUR_MAX = 350;

// Erreur venant de CHEZ EUX : refus, panne, délai dépassé.
export class ErreurEstLivraison extends Error {
  constructor(
    // null = pas de réponse HTTP du tout (délai dépassé, réseau coupé).
    readonly statutHttp: number | null,
    message: string,
    readonly brut: unknown = null
  ) {
    super(message);
    this.name = 'ErreurEstLivraison';
  }
}

// Erreur venant de CHEZ NOUS : la donnée du colis interdit de l'envoyer. Elle
// est distincte de la précédente parce qu'elle se répare chez nous, et parce
// qu'elle survient AVANT tout appel — rien n'existe chez eux.
export class ErreurColisEstLivraison extends Error {
  constructor(
    readonly codeSuivi: string,
    message: string
  ) {
    super(message);
    this.name = 'ErreurColisEstLivraison';
  }
}

function lireCle(): string {
  const cle = process.env.EST_LIVRAISON_CLE?.trim() ?? '';
  if (!cle) throw new ErreurEstLivraison(null, 'EST_LIVRAISON_CLE absente de l’environnement');
  return cle;
}

// Leurs messages d'erreur sont lisibles par un humain et citent l'index de la
// ligne fautive (« commands[0].city is required ») : on les remonte tels quels,
// faute de codes structurés. Un corps HTML de proxy, lui, ne dirait rien d'utile.
function messageDe(brut: unknown): string | null {
  if (brut && typeof brut === 'object') {
    const valeur = (brut as Record<string, unknown>).message;
    if (typeof valeur === 'string' && valeur.trim()) return valeur.trim();
  }
  return null;
}

async function appeler(chemin: string, corps: unknown): Promise<unknown> {
  const cle = lireCle();
  let reponse: Response;
  try {
    reponse = await fetch(`${baseUrl()}${chemin}`, {
      method: 'POST',
      headers: { 'Client-Key': cle, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (erreur) {
    const expire = erreur instanceof Error && erreur.name === 'TimeoutError';
    throw new ErreurEstLivraison(
      null,
      expire ? `POST ${chemin} : pas de réponse en ${DELAI_MS / 1000} s` : `POST ${chemin} : injoignable`
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

  // Leur enveloppe porte un `success` : un `false` sous un 200 est possible.
  // L'un OU l'autre suffit à dire que la demande n'a pas abouti.
  const refuse = brut && typeof brut === 'object' && (brut as Record<string, unknown>).success === false;
  if (!reponse.ok || refuse) {
    const detail = messageDe(brut);
    throw new ErreurEstLivraison(
      reponse.status,
      `POST ${chemin} → HTTP ${reponse.status}${detail ? ` — ${detail}` : ''}`,
      brut
    );
  }
  return brut;
}

// --- Construction d'une commande (PURE) --------------------------------------

// Les seuls champs d'une Commande qu'EST Livraison a le droit de voir. Le type
// l'impose : `construireCommandeEst` ne reçoit pas le marchand, elle ne peut
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

// Le corps d'une ligne de `commands[]`. Leur schéma est en
// `additionalProperties: false` : tout champ hors de cette liste fait refuser
// l'appel. Aucune référence interne ne s'y glisse.
export interface CommandeEst {
  code: string;
  city: string;
  receiver_full_name: string;
  receiver_phone_number: string;
  receiver_address: string;
  product_name: string;
  quantity: number;
  price: number;
  note: string;
  is_echange: boolean;
  package_opened: boolean;
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

// Champ d'information : le tronquer perd du confort, pas un colis.
function tronquer(valeur: string): string {
  return valeur.length > LONGUEUR_MAX ? valeur.slice(0, LONGUEUR_MAX) : valeur;
}

// Champ dont dépend la livraison : le tronquer enverrait le colis à une adresse
// incomplète ou sous un nom coupé. On refuse, et un humain corrige la commande.
function exigerCourt(codeSuivi: string, champ: string, valeur: string): string {
  if (!valeur) throw new ErreurColisEstLivraison(codeSuivi, `${champ} est vide : EST Livraison le refuse`);
  if (valeur.length > LONGUEUR_MAX) {
    throw new ErreurColisEstLivraison(
      codeSuivi,
      `${champ} dépasse ${LONGUEUR_MAX} caractères (${valeur.length}) : à raccourcir avant de remettre le colis`
    );
  }
  return valeur;
}

// La note ne porte que des consignes STANDARDISÉES. `Commande.notes` n'y va
// pas : c'est du texte libre saisi par le marchand ou par nous, qui peut citer
// une boutique, un contact, un prix d'achat — rien qu'on sache relire avant
// chaque envoi.
//
// L'échange n'y figure pas non plus, contrairement à Power Delivery : leur API
// a un vrai champ `is_echange`, donc la consigne serait un doublon.
function noteColis(colis: ColisAConfier): string {
  return colis.fragile ? 'Colis fragile' : '';
}

// `ville` est le libellé EXACT attendu par eux, résolu en amont par
// `resoudreVilleEst` (lib/est-livraison-villes.ts). Jamais `Commande.ville`,
// qui est du texte libre : leur API créerait la ville au lieu de refuser.
export function construireCommandeEst(colis: ColisAConfier, ville: string): CommandeEst {
  const montant = Number(colis.montantCod.toString());
  if (!Number.isFinite(montant) || montant < 0) {
    throw new ErreurColisEstLivraison(colis.codeSuivi, `Montant COD invalide pour ${colis.codeSuivi}`);
  }

  return {
    // NOTRE code de suivi, brut et sans préfixe. C'est lui qu'ils citeront en
    // retour sur /api/v1/livraisons/statut, qui cherche le colis sur ce champ
    // exact : un préfixe obligerait le module de statuts — partagé par tous les
    // transporteurs — à apprendre à le retirer. Décision du 23/09/2026.
    code: colis.codeSuivi,
    city: exigerCourt(colis.codeSuivi, 'La ville', ville.trim()),
    receiver_full_name: exigerCourt(colis.codeSuivi, 'Le nom du destinataire', colis.clientNom.trim()),
    receiver_phone_number: exigerCourt(colis.codeSuivi, 'Le téléphone du destinataire', colis.clientTelephone.trim()),
    receiver_address: exigerCourt(colis.codeSuivi, 'L’adresse', colis.adresse.trim()),
    product_name: tronquer(colis.produitDescription?.trim() ?? ''),
    quantity: Math.max(1, Math.trunc(colis.quantite)),
    // TOUJOURS explicite : leur `price` vaut 0 par défaut, et 0 sur un COD veut
    // dire « livrer sans rien encaisser ».
    price: arrondi(montant),
    note: tronquer(noteColis(colis)),
    is_echange: colis.aRemplacer,
    package_opened: colis.ouvrir,
  };
}

// --- Lecture défensive des réponses ------------------------------------------

function objet(valeur: unknown): Record<string, unknown> | null {
  return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null;
}

function chaines(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return [];
  return valeur.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

export interface Creation {
  // Identifiant de l'enregistrement chez eux (`command_id`, un id PocketBase —
  // « ar9g1pvqkjayy06 »). Null s'ils n'en rendent pas : c'est alors notre code
  // qui reste la seule clé.
  idExterne: string | null;
  brut: unknown;
}

// Les villes créées au passage, sous les DEUX formes : `city_created` (ce
// qu'ils rendent, une chaîne ou `null`) et `cities_created` (ce que leur doc
// annonce, un tableau). Lire les deux coûte trois lignes et évite qu'un
// alignement de leur API sur leur doc désarme silencieusement l'alarme.
function villesCreees(racine: Record<string, unknown>): string[] {
  const uneSeule = racine.city_created;
  if (typeof uneSeule === 'string' && uneSeule.trim()) return [uneSeule.trim()];
  return chaines(racine.cities_created);
}

// Idem pour le code confirmé : `command_code` observé, `inserted_codes` documenté.
function codesConfirmes(racine: Record<string, unknown>): string[] {
  const unSeul = racine.command_code;
  if (typeof unSeul === 'string' && unSeul.trim()) return [unSeul.trim()];
  return chaines(racine.inserted_codes);
}

// Lit la réponse d'une création. Leur réponse réelle, observée le 23/09/2026 :
//
//   { "success": true, "inserted": 1, "command_id": "ar9g1pvqkjayy06",
//     "command_code": "…", "city_created": null }
//
// Trois conditions doivent être réunies pour parler de succès, et l'absence
// d'une seule est un refus :
//   · aucune ville créée au passage (règle 3, en tête de fichier) ;
//   · notre code confirmé par eux — sans quoi rien ne dit que c'est NOTRE colis
//     que leur réponse décrit ;
//   · un `inserted` d'au moins 1.
export function lireCreation(brut: unknown, codeAttendu: string): Creation {
  const racine = objet(brut);
  if (!racine) throw new ErreurEstLivraison(200, 'Réponse de création illisible', brut);

  const creees = villesCreees(racine);
  if (creees.length > 0) {
    throw new ErreurEstLivraison(
      200,
      `EST Livraison a CRÉÉ la ville « ${creees.join(' », « ')} » au lieu de la reconnaître : ` +
        'le libellé envoyé est faux et le colis partirait dans une ville que personne ne dessert',
      brut
    );
  }

  if (!codesConfirmes(racine).includes(codeAttendu)) {
    throw new ErreurEstLivraison(200, `Leur réponse ne confirme pas la création de ${codeAttendu}`, brut);
  }

  const inseres = typeof racine.inserted === 'number' ? racine.inserted : 0;
  if (inseres < 1) {
    throw new ErreurEstLivraison(200, `Leur réponse annonce ${inseres} création pour ${codeAttendu}`, brut);
  }

  const idExterne = typeof racine.command_id === 'string' && racine.command_id.trim()
    ? racine.command_id.trim()
    : chaines(racine.command_ids)[0] ?? null;

  return { idExterne, brut };
}

export interface Suppression {
  codesSupprimes: string[];
  brut: unknown;
}

export function lireSuppression(brut: unknown): Suppression {
  const racine = objet(brut);
  if (!racine) throw new ErreurEstLivraison(200, 'Réponse de suppression illisible', brut);
  return { codesSupprimes: chaines(racine.deleted_codes), brut };
}

// --- Les appels ---------------------------------------------------------------

// UNE commande par appel, et le corps est PLAT : leur serveur ne lit aucune
// enveloppe `commands[]`, contrairement à ce que leur doc annonce. Le même
// « Code is required. » revient pour `{}`, `{commands:[]}`, `{commands:[{code}]}`
// et `{orders:[{code}]}` — leur handler cherche un `code` à la racine
// (INTEGRATION_EST_LIVRAISON.md §3.3).
//
// Leur validation réclame, dans cet ordre : `code`, `city`,
// `receiver_phone_number`. Les autres champs sont acceptés en plus.
export async function creerCommandeEst(commande: CommandeEst): Promise<Creation> {
  const brut = await appeler(CHEMIN_CREATION, commande);
  return lireCreation(brut, commande.code);
}

// Annulation d'un colis déposé. Refusée par eux s'il est déjà ramassé — c'est
// le seul moment où elle est possible, et leur message le dit tel quel.
export async function supprimerCommandesEst(codes: readonly string[]): Promise<Suppression> {
  if (codes.length === 0) throw new ErreurEstLivraison(null, 'Aucun code à supprimer');
  const brut = await appeler(CHEMIN_SUPPRESSION, { commands: [...codes] });
  return lireSuppression(brut);
}
