import { createHmac, timingSafeEqual } from 'node:crypto';

// § Intégration YouCan (INTEGRATION_YOUCAN.md) — tout ce qui se décide SANS
// base de données : la signature d'un webhook, et la lecture d'une commande.
// Module pur, donc testé en unitaire (lib/__tests__/youcan-commandes.test.ts) ;
// l'écriture en base et les appels à YouCan vivent dans lib/youcan.ts.
//
// Source : developer.youcan.shop (pages Orders, Order/Customer/Address
// entities, REST Hooks), lue le 2026-09-26. Aucune commande réelle n'a encore
// été reçue : la lecture ci-dessous suit la doc et ses exemples, et reste
// tolérante sur la forme (tableau vide au lieu d'objet, champs absents).

export class ErreurYoucan extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Signature des webhooks
// ---------------------------------------------------------------------------

/**
 * Vérifie `X-YOUCAN-SIGNATURE` : HMAC-SHA256 du corps BRUT, en hexadécimal,
 * signé avec le secret du CLIENT OAUTH (l'application de la plateforme), et
 * non avec un secret propre à chaque boutique comme chez Shopify.
 *
 * Comparaison en temps constant sur les octets décodés ; la casse de l'hexa
 * reçu est indifférente.
 */
export function signatureYoucanValide(corpsBrut: Buffer | string, entete: string | null, secret: string): boolean {
  if (!secret || !entete) return false;
  const valeur = entete.trim();
  if (!/^[0-9a-f]{64}$/i.test(valeur)) return false;
  const attendue = createHmac('sha256', secret).update(corpsBrut).digest();
  const recue = Buffer.from(valeur, 'hex');
  return recue.length === attendue.length && timingSafeEqual(recue, attendue);
}

/**
 * Vérifie le `hmac` que YouCan joint au RETOUR OAuth
 * (`?timestamp=…&code=…&store=…&seller=…&locale=…&embedded=…&hmac=…`).
 *
 * YouCan ne renvoie PAS le paramètre `state` qu'on lui passe : c'est cette
 * signature qui prouve que le retour vient de lui. Calcul VÉRIFIÉ le
 * 2026-09-26 sur un vrai retour (la doc n'en parle pas) : HMAC-SHA256 en
 * hexadécimal, avec le secret du client OAuth, de la chaîne de requête privée
 * du seul paramètre `hmac`, dans l'ORDRE REÇU — une version triée ne
 * correspond pas. Les valeurs vues étaient sans caractère à encoder ; on
 * accepte donc la forme brute comme la forme décodée.
 */
export function signatureRetourOAuthValide(chaineRequete: string, secret: string): boolean {
  if (!secret) return false;
  const parties = chaineRequete.replace(/^\?/, '').split('&').filter(Boolean);
  const partieHmac = parties.find((p) => p.startsWith('hmac='));
  const recu = partieHmac?.slice('hmac='.length) ?? '';
  if (!/^[0-9a-f]{64}$/i.test(recu)) return false;
  const reste = parties.filter((p) => !p.startsWith('hmac='));
  const decode = (p: string) => {
    try {
      return decodeURIComponent(p.replace(/\+/g, ' '));
    } catch {
      return p;
    }
  };
  const recuOctets = Buffer.from(recu, 'hex');
  return [reste.join('&'), reste.map(decode).join('&')].some((message) => {
    const attendu = createHmac('sha256', secret).update(message).digest();
    return attendu.length === recuOctets.length && timingSafeEqual(attendu, recuOctets);
  });
}

// ---------------------------------------------------------------------------
// Lecture d'une commande
// ---------------------------------------------------------------------------

const MONTANT_MAX = 99_999_999.99; // Commande.montantCod, Decimal(10,2)
const LONGUEUR_MAX_DESCRIPTION = 500;

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

type Objet = Record<string, unknown>;

// YouCan sérialise un sous-objet vide en `[]` (ex. `shipping.address: []`) :
// seul un objet non vide compte.
function objet(valeur: unknown): Objet | null {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return null;
  return Object.keys(valeur).length > 0 ? (valeur as Objet) : null;
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
  return (
    texte([texte(source.first_name), texte(source.last_name)].filter(Boolean).join(' ')) ??
    texte(source.full_name) ??
    texte(source.name)
  );
}

/** Slug d'un statut YouCan : `status_object.slug`, à défaut le libellé texte. */
function slugStatut(porteur: Objet | null, ...cles: string[]): string | null {
  if (!porteur) return null;
  const slug = texte(objet(porteur.status_object)?.slug);
  if (slug) return slug.toLowerCase();
  for (const cle of cles) {
    const valeur = texte(porteur[cle]);
    if (valeur) return valeur.toLowerCase();
  }
  return null;
}

export interface LigneCommandeYoucan {
  titre: string;
  quantite: number;
  idVariante: string | null;
  sku: string | null;
}

export interface CommandeYoucanLue {
  /** UUID de la commande chez YouCan. */
  idCommande: string;
  /** Référence lisible (`ref`, « 021 »), celle que le marchand voit. */
  numero: string;
  devise: string | null;
  clientNom: string;
  /** Tel que saisi : la normalisation au format marocain est faite par l'appelant. */
  telephoneBrut: string | null;
  ville: string;
  adresse: string;
  codePostal: string | null;
  /** Montant à encaisser à la livraison. 0 pour une commande déjà payée. */
  montantCod: number;
  lignes: LigneCommandeYoucan[];
  quantite: number;
  produitDescription: string | null;
  noteClient: string | null;
  /** Champs du destinataire absents de la commande — le colis est créé quand
   *  même, et le marchand doit les compléter. */
  manquants: string[];
}

export type LectureCommandeYoucan =
  | { type: 'commande'; commande: CommandeYoucanLue }
  | { type: 'ignoree'; numero: string | null; motif: string };

// Statuts de paiement pour lesquels il ne reste rien à encaisser.
const PAIEMENTS_SOLDES = new Set(['paid', 'refunded', 'partially_refunded', 'voided']);
// Statuts de commande qui n'ont rien à livrer.
const COMMANDES_ANNULEES = new Set(['canceled', 'cancelled', 'refunded']);

/**
 * Montant à encaisser par le livreur : le total de la commande, sauf si elle
 * est déjà réglée (paiement en ligne). Même décision que Shopify (2026-09-26) :
 * une commande prépayée devient un colis à COD 0, elle n'est pas écartée.
 *
 * Le statut de paiement est lu sur l'objet `payment` (include) d'abord, puis
 * sur les champs de premier niveau. Un statut absent est lu comme « à
 * encaisser » : sur YouCan au Maroc, l'immense majorité des commandes sont en
 * paiement à la livraison.
 */
function montantAEncaisser(corps: Objet): number {
  const statut =
    slugStatut(objet(corps.payment), 'status_text') ??
    texte(corps.payment_status_new)?.toLowerCase() ??
    null;
  if (statut && PAIEMENTS_SOLDES.has(statut)) return 0;
  return Math.max(0, montant(corps.total) ?? 0);
}

/** Adresses candidates, de la plus fiable à la moins fiable. */
function adressesCandidates(corps: Objet, client: Objet | null): Objet[] {
  const candidates: (Objet | null)[] = [objet(objet(corps.shipping)?.address)];
  // `customer.address` : tableau d'Address (include par défaut), l'adresse
  // marquée `default` d'abord.
  const adressesClient = Array.isArray(client?.address)
    ? (client.address as unknown[]).map(objet).filter((a): a is Objet => !!a)
    : objet(client?.address)
      ? [objet(client?.address) as Objet]
      : [];
  candidates.push(...adressesClient.filter((a) => a.default === true), ...adressesClient.filter((a) => a.default !== true));
  candidates.push(objet(objet(corps.payment)?.address));
  return candidates.filter((a): a is Objet => !!a);
}

export function lireCommandeYoucan(corpsBrut: unknown): LectureCommandeYoucan {
  const corps = objet(corpsBrut);
  if (!corps) throw new ErreurYoucan('corps_invalide', 'La commande n’est pas un objet JSON');

  const idCommande = texte(corps.id);
  if (!idCommande || !/^[0-9a-f-]{8,64}$/i.test(idCommande)) {
    throw new ErreurYoucan('corps_invalide', 'Identifiant de commande absent ou illisible');
  }
  const numero = texte(corps.ref) ?? idCommande.slice(0, 8);

  const statut = slugStatut(corps, 'status_new');
  if (statut && COMMANDES_ANNULEES.has(statut)) {
    return { type: 'ignoree', numero, motif: 'Commande déjà annulée à sa réception' };
  }

  const lignesBrutes = Array.isArray(corps.variants) ? corps.variants.map(objet).filter((l): l is Objet => !!l) : [];
  const lignes: LigneCommandeYoucan[] = lignesBrutes.map((l) => {
    const variante = objet(l.variant);
    const produit = objet(variante?.product);
    const quantite = Number(l.quantity);
    const titreProduit = texte(produit?.name) ?? 'Article';
    // Un produit sans déclinaison porte une variante unique « default ».
    const valeurs = Array.isArray(variante?.values)
      ? (variante.values as unknown[]).map(texte).filter((v): v is string => !!v && v !== 'default')
      : [];
    return {
      titre: valeurs.length > 0 ? `${titreProduit} (${valeurs.join(' / ')})` : titreProduit,
      quantite: Number.isInteger(quantite) && quantite > 0 ? quantite : 1,
      idVariante: texte(variante?.id),
      sku: texte(variante?.sku),
    };
  });

  const client = objet(corps.customer);
  const adresses = adressesCandidates(corps, client);
  const adresseSource = adresses[0] ?? null;
  const premiere = (lire: (a: Objet) => string | null) => adresses.map(lire).find((v) => !!v) ?? null;

  const clientNom = premiere(nomComplet) ?? nomComplet(client);
  const telephoneBrut = premiere((a) => texte(a.phone)) ?? texte(client?.phone);
  const ville = texte(adresseSource?.city) ?? premiere((a) => texte(a.city)) ?? texte(client?.city);
  const adresse =
    [texte(adresseSource?.first_line), texte(adresseSource?.second_line)].filter(Boolean).join(', ') ||
    premiere((a) => texte(a.first_line)) ||
    null;

  const manquants: string[] = [];
  if (!clientNom) manquants.push('nom');
  if (!telephoneBrut) manquants.push('téléphone');
  if (!ville) manquants.push('ville');
  if (!adresse) manquants.push('adresse');
  if (lignes.length === 0) manquants.push('articles');

  const description = lignes.map((l) => `${l.quantite} × ${l.titre}`).join(', ');

  return {
    type: 'commande',
    commande: {
      idCommande,
      numero,
      devise: texte(corps.currency),
      clientNom: clientNom ?? 'Client YouCan',
      telephoneBrut,
      ville: ville ?? '',
      adresse: adresse ?? '',
      codePostal: texte(adresseSource?.zip_code),
      montantCod: Math.min(arrondi(montantAEncaisser(corps)), MONTANT_MAX),
      lignes,
      quantite: Math.max(1, lignes.reduce((total, l) => total + l.quantite, 0)),
      produitDescription:
        description.length > LONGUEUR_MAX_DESCRIPTION
          ? `${description.slice(0, LONGUEUR_MAX_DESCRIPTION - 1)}…`
          : description || null,
      noteClient: texte(corps.notes),
      manquants,
    },
  };
}
