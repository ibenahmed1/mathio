// § Sous-traitance Colivraison — client de LEUR API (https://colivraison24h.ma).
//
// Nous sommes ici un CLIENT de leur API, comme n'importe quelle boutique : nous
// leur remettons nos colis (addcolis.php), nous lisons leur suivi (track.php).
// Ils n'ont NI webhook, NI modification, NI annulation, NI demande de retour :
// tout ce qui suit la remise se règle par leur suivi, ou au téléphone.
//
// QUATRE RÈGLES tiennent tout ce fichier :
//
//  1. LES IDENTIFIANTS NE SORTENT JAMAIS. Leur API les veut DANS L'URL
//     (`tk`, `sk` en paramètres de requête) : une URL ne figure donc dans aucun
//     message d'erreur ni aucun journal — seul le nom du script est cité.
//
//  2. UN 200 NE VEUT RIEN DIRE. Relevé du 01/10/2026 : leurs erreurs arrivent
//     en HTTP 200 (« Some parameter are missing », « This account doesn't
//     exist or it is disabled »…), sous des formes qui changent d'un script à
//     l'autre — objet `{message}`, objet `{message, status}`, tableau d'une
//     chaîne. C'est le TEXTE qui tranche. Une création n'est réussie que sur
//     « Package added succesfully » (sic) ; tout le reste est un refus.
//
//  3. LEUR DOCUMENTATION N'EST PAS UN CONTRAT. Elle ne montre ni la réponse
//     complète de addcolis.php, ni celle de colislist.php, ni la liste des
//     états de track.php. Les réponses sont lues de façon défensive et la
//     réponse BRUTE est rendue à l'appelant pour qu'il la conserve.
//
//  4. LE MARCHAND N'EST JAMAIS TRANSMIS. Ni son nom, ni son téléphone, ni ses
//     notes libres (cf. `ColisAConfier`, qui n'a pas accès au marchand).

import type { ColisAConfier } from '@/lib/power-delivery';

export type { ColisAConfier };

// Surchargeable par COLIVRAISON_BASE_URL, et uniquement pour les TESTS : chaque
// appel réel à addcolis.php crée un vrai colis chez eux, sans aucun moyen de
// l'annuler par l'API. Lue à chaque appel, pas au chargement du module.
const BASE_URL_PAR_DEFAUT = 'https://colivraison24h.ma';

function baseUrl(): string {
  return (process.env.COLIVRAISON_BASE_URL?.trim() || BASE_URL_PAR_DEFAUT).replace(/\/+$/, '');
}

const DELAI_MS = 20_000;

// Notre code chez eux, préfixé comme chez Power Delivery. Il part dans le
// paramètre `code` d'addcolis.php — OBLIGATOIRE bien qu'absent de leur
// documentation : sans lui, toute création répond « Some parameter are
// missing » (relevé du 01/10/2026, première remise réelle). Il est aussi
// recopié en tête de la note, filet pour le retrouver dans colislist.php si
// leur suivi ne le connaissait pas.
export const PREFIXE_CODE_COLIVRAISON = 'MTH-';

export function codeColivraison(codeSuivi: string): string {
  return `${PREFIXE_CODE_COLIVRAISON}${codeSuivi}`;
}

export class ErreurColivraison extends Error {
  constructor(
    // null = pas de réponse HTTP du tout (délai dépassé, réseau coupé) : on ne
    // sait PAS si la demande a abouti. Un nombre = ils ont répondu (y compris
    // un refus servi en HTTP 200).
    readonly statutHttp: number | null,
    message: string,
    readonly brut: unknown = null
  ) {
    super(message);
    this.name = 'ErreurColivraison';
  }
}

interface Identifiants {
  tk: string;
  sk: string;
}

function lireIdentifiants(): Identifiants {
  const tk = process.env.COLIVRAISON_TOKEN?.trim() ?? '';
  const sk = process.env.COLIVRAISON_SECRET?.trim() ?? '';
  if (!tk || !sk) throw new ErreurColivraison(null, 'COLIVRAISON_TOKEN ou COLIVRAISON_SECRET absent de l’environnement');
  return { tk, sk };
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

// Le message qu'ils mettent dans la réponse, quelle qu'en soit la forme :
// `{message}`, `{message, status}`, `["…"]`, ou une chaîne nue.
export function messageColivraison(brut: unknown): string | null {
  if (typeof brut === 'string') return chaine(brut);
  if (Array.isArray(brut)) return brut.length === 1 ? chaine(brut[0]) : null;
  return chaine(objet(brut)?.message);
}

// Les refus qu'ils documentent ou qu'on a relevés. Ne sert qu'à distinguer une
// réponse d'erreur d'une réponse de données dans colislist.php et track.php ;
// pour la création, c'est le message de succès qui tranche, pas cette liste.
const MESSAGES_D_ERREUR = [
  /parameters? (are|is) missing/i,
  /parameters? .*empty/i,
  /doesn'?t exist/i,
  /disabled/i,
  /incorrect credentials/i,
  /doesn'?t belong/i,
];

function estMessageDErreur(message: string | null): boolean {
  return !!message && MESSAGES_D_ERREUR.some((motif) => motif.test(message));
}

export function creationReussie(brut: unknown): boolean {
  return /package added succ?ess?fully/i.test(messageColivraison(brut) ?? '');
}

// Le code que LEUR système attribue, s'il le renvoie à la création. Leur
// documentation ne montre que le message ; les clés essayées sont celles où un
// système de ce genre range un code. Null = rien trouvé : il sera cherché dans
// colislist.php (cf. codeDansListe).
export function codeExterneDeReponse(brut: unknown): string | null {
  const racine = objet(brut);
  if (!racine) return null;
  const data = objet(racine.data) ?? objet(racine.colis) ?? objet(racine.package);
  for (const source of [racine, data]) {
    if (!source) continue;
    for (const cle of ['code', 'Code', 'code_colis', 'Code_Colis', 'tracking', 'tracking_code', 'Code_Suivi']) {
      const v = chaine(source[cle]);
      if (v) return v;
    }
  }
  return null;
}

// --- Construction d'un colis (PURE) ------------------------------------------

export interface ColisColivraison {
  code: string;
  fullname: string;
  phone: string;
  city: string;
  address: string;
  price: string;
  product: string;
  qty: string;
  note: string;
  change: '0' | '1';
  openpackage: '0' | '1';
}

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

// La note commence TOUJOURS par notre code : c'est la clé de rapprochement
// (cf. PREFIXE_CODE_COLIVRAISON). Suivent les seules consignes standardisées ;
// `Commande.notes`, texte libre, n'y va jamais.
export function noteColivraison(colis: ColisAConfier): string {
  const morceaux = [`Réf ${codeColivraison(colis.codeSuivi)}`];
  if (colis.fragile) morceaux.push('Colis fragile');
  return morceaux.join(' — ');
}

export function construireColisColivraison(colis: ColisAConfier, nomVille: string): ColisColivraison {
  const montant = Number(colis.montantCod.toString());
  if (!Number.isFinite(montant) || montant < 0) {
    throw new Error(`Montant COD invalide pour ${colis.codeSuivi}`);
  }
  return {
    code: codeColivraison(colis.codeSuivi),
    fullname: colis.clientNom.trim(),
    phone: colis.clientTelephone.trim(),
    city: nomVille,
    address: colis.adresse.trim(),
    price: String(arrondi(montant)),
    // Leur `product` et leur `qty` sont des listes séparées par des virgules,
    // alignées l'une sur l'autre : une virgule dans notre description la
    // couperait en deux produits sans quantité. On la remplace.
    product: (colis.produitDescription?.trim() || 'Colis').replace(/,/g, ' '),
    qty: String(Math.max(1, Math.trunc(colis.quantite))),
    note: noteColivraison(colis),
    // Leur API a un vrai champ d'échange, contrairement à Power Delivery.
    change: colis.aRemplacer ? '1' : '0',
    openpackage: colis.ouvrir ? '1' : '0',
  };
}

// --- Les appels ----------------------------------------------------------------

async function appeler(script: string, parametres: Record<string, string>): Promise<unknown> {
  const url = `${baseUrl()}/${script}?${new URLSearchParams(parametres).toString()}`;
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (erreur) {
    const expire = erreur instanceof Error && erreur.name === 'TimeoutError';
    // Le nom du script seul : l'URL porte les identifiants. La cause réseau
    // (ECONNRESET, ENOTFOUND…) n'en contient pas, et dit si c'est passager.
    const cause = erreur instanceof Error ? (erreur.cause as { code?: unknown } | undefined)?.code : undefined;
    throw new ErreurColivraison(
      null,
      expire
        ? `${script} : pas de réponse en ${DELAI_MS / 1000} s`
        : `${script} : injoignable${typeof cause === 'string' ? ` (${cause})` : ''}`
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
    const detail = messageColivraison(brut);
    throw new ErreurColivraison(reponse.status, `${script} → HTTP ${reponse.status}${detail ? ` — ${detail}` : ''}`, brut);
  }
  return brut;
}

export interface ResultatCreation {
  codeExterne: string | null;
  brut: unknown;
}

export async function creerColisColivraison(colis: ColisColivraison): Promise<ResultatCreation> {
  const { tk, sk } = lireIdentifiants();
  const brut = await appeler('addcolis.php', { tk, sk, ...colis });
  if (!creationReussie(brut)) {
    const detail = messageColivraison(brut) ?? 'réponse inattendue';
    // Ils ont répondu : c'est un refus, pas une incertitude. 200 est le code
    // HTTP réellement reçu.
    throw new ErreurColivraison(200, `addcolis.php — ${detail}`, brut);
  }
  return { codeExterne: codeExterneDeReponse(brut), brut };
}

export interface EtatColivraison {
  etat: string;
  date: Date | null;
}

export interface SuiviColivraison {
  // Dernier état connu (le plus récent par date), tel que leur API l'écrit.
  etat: string | null;
  date: Date | null;
  historique: EtatColivraison[];
  // Le livreur qui a le colis chez eux, quand ils l'ont affecté.
  livreur: string | null;
  telephoneLivreur: string | null;
  brut: unknown;
}

// Leur suivi, tel que leur serveur le sert RÉELLEMENT (relevé du 01/10/2026,
// sur le premier colis remis) — rien à voir avec leur documentation :
//
//   {"0": {"state": "Ajouter", "eventdate": "1790865035"},
//    "nom_liveur": null, "telephone_liveur": null, "status": "200"}
//
// Un OBJET, dont les états sont rangés sous des clés numériques, à côté du
// livreur et d'un statut. Leur doc montre un tableau `[{Etat, Date_Evenement}]` :
// les deux formes sont lues, au cas où un autre script la servirait. Le plus
// récent est celui qui a la plus grande date, quel que soit l'ordre reçu.
export function lireSuiviColivraison(brut: unknown): SuiviColivraison {
  const racine = objet(brut);
  const lignes = Array.isArray(brut)
    ? brut
    : Object.entries(racine ?? {})
        .filter(([cle]) => /^\d+$/.test(cle))
        .map(([, valeur]) => valeur);
  const historique: EtatColivraison[] = [];
  for (const ligne of lignes) {
    const o = objet(ligne);
    const etat = chaine(o?.state) ?? chaine(o?.Etat) ?? chaine(o?.etat);
    if (!etat) continue;
    const secondes = Number(chaine(o?.eventdate) ?? chaine(o?.Date_Evenement) ?? chaine(o?.date));
    historique.push({ etat, date: Number.isFinite(secondes) && secondes > 0 ? new Date(secondes * 1000) : null });
  }
  const dernier = historique.reduce<EtatColivraison | null>(
    (meilleur, e) => (!meilleur || (e.date?.getTime() ?? 0) > (meilleur.date?.getTime() ?? 0) ? e : meilleur),
    null
  );
  return {
    etat: dernier?.etat ?? null,
    date: dernier?.date ?? null,
    historique,
    livreur: chaine(racine?.nom_liveur),
    telephoneLivreur: chaine(racine?.telephone_liveur),
    brut,
  };
}

export async function suivreColisColivraison(code: string): Promise<SuiviColivraison> {
  // Leur doc ne demande que `code` ; le suivi répond d'ailleurs sans les
  // identifiants. Ils sont joints quand même, leur message d'erreur parlant
  // d'« incorrect credentials ». Le suivi accepte LEUR code comme le NÔTRE
  // (qu'ils rangent en `IDIntern`).
  const tk = process.env.COLIVRAISON_TOKEN?.trim();
  const sk = process.env.COLIVRAISON_SECRET?.trim();
  const brut = await appeler('track.php', { code, ...(tk && sk ? { tk, sk } : {}) });
  const suivi = lireSuiviColivraison(brut);
  // Un refus : `{message, status: "404"}`, sans aucun état.
  if (suivi.historique.length === 0) {
    const detail = messageColivraison(brut) ?? 'aucun état dans la réponse';
    const statut = Number(chaine(objet(brut)?.status));
    throw new ErreurColivraison(Number.isFinite(statut) ? statut : 200, `track.php — ${detail}`, brut);
  }
  return suivi;
}

// Liste des colis du compte. Sa forme n'est pas documentée : on accepte un
// tableau d'objets, ou un objet qui en contient un.
export function lignesDeListe(brut: unknown): Record<string, unknown>[] {
  const racine = objet(brut);
  const tableau = Array.isArray(brut)
    ? brut
    : (Object.values(racine ?? {}).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [];
  return tableau.map(objet).filter((o): o is Record<string, unknown> => o !== null);
}

// Leur code pour NOTRE colis : la ligne dont un champ contient notre code (on
// l'a mis dans la note), et dans cette ligne le champ qui porte leur code.
export function codeDansListe(lignes: Record<string, unknown>[], codeEnvoye: string): string | null {
  const cible = codeEnvoye.toLowerCase();
  const ligne = lignes.find((l) =>
    Object.values(l).some((v) => typeof v === 'string' && v.toLowerCase().includes(cible))
  );
  if (!ligne) return null;
  // Forme réelle : `Code` = leur code, `IDIntern` = le nôtre.
  const code = chaine(ligne.Code);
  if (code && !code.toLowerCase().includes(cible)) return code;
  for (const [cle, valeur] of Object.entries(ligne)) {
    const v = chaine(valeur);
    if (v && /code|tracking|suivi/i.test(cle) && !v.toLowerCase().includes(cible)) return v;
  }
  return null;
}

export async function listerColisColivraison(): Promise<Record<string, unknown>[]> {
  const { tk, sk } = lireIdentifiants();
  const brut = await appeler('colislist.php', { tk, sk });
  const message = messageColivraison(brut);
  if (estMessageDErreur(message)) throw new ErreurColivraison(200, `colislist.php — ${message}`, brut);
  return lignesDeListe(brut);
}

export interface VilleColivraison {
  id: number;
  nom: string;
}

export async function listerVillesColivraison(): Promise<VilleColivraison[]> {
  const brut = await appeler('cities.php', {});
  if (!Array.isArray(brut)) throw new ErreurColivraison(200, 'cities.php — réponse inattendue', brut);
  return brut
    .map(objet)
    .map((o) => ({ id: Number(chaine(o?.ID)), nom: chaine(o?.City) ?? '' }))
    .filter((v) => Number.isFinite(v.id) && v.nom);
}
