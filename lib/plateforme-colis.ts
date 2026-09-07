import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { checkBlacklist } from '@/lib/blacklist';
import { nextCodeSuivi } from '@/lib/codes';
import { normaliserVille } from '@/lib/hub-stock';
import { ErreurPlateforme, type ContextePlateforme } from '@/lib/plateforme-auth';

// Ingestion des colis déposés par une plateforme partenaire
// (§ POST /v1/colis et POST /v1/colis/lot).
//
// La table `commandes` n'a reçu AUCUNE colonne pour ce chantier : tout tient
// dans des champs qui existaient déjà.
//
//   codeSuiviPartenaire  la référence du colis CHEZ EUX
//   source = 'api'       valeur de l'enum SourceCommande jamais émise jusqu'ici
//
// L'IDEMPOTENCE ne repose pas sur du code mais sur une contrainte de base
// posée bien avant ce chantier : `@@unique([marchandId, codeSuiviPartenaire])`
// (commandes_marchand_ref_partenaire_key). Rejouer un lot ne duplique donc
// rien, même si deux requêtes arrivent en parallèle — ce qu'un contrôle
// applicatif « chercher puis créer » ne garantirait pas.

// Plafond d'un lot. Assez haut pour qu'une plateforme n'ait pas à découper ses
// envois courants, assez bas pour qu'une requête reste traitable dans le
// temps imparti à une fonction serveur — chaque ligne fait au minimum une
// écriture et un appel de séquence.
export const TAILLE_MAX_LOT = 200;

// Bornes des champs numériques, alignées sur les colonnes de `commandes`.
// Elles ne sont pas décoratives : sans elles, un montant à 13 chiffres passe
// la validation, atteint PostgreSQL, y déclenche un « numeric field overflow »
// et ressort en 500 — c'est-à-dire « le problème est chez nous » pour une
// valeur que l'appelant a mal formée. Un intégrateur ne peut rien faire d'un
// 500 ; il corrige un 400 qui nomme le champ.
const MONTANT_MAX = 99_999_999.99; // Decimal(10,2)
const POIDS_MAX = 9_999.99; // Decimal(6,2)
const QUANTITE_MAX = 2_147_483_647; // Int (4 octets)

// Arrondi à deux décimales à la frontière de `lib/`, comme partout où de
// l'argent entre dans ce dépôt. Sans lui, PostgreSQL arrondirait quand même —
// mais silencieusement, et un partenaire qui envoie 10.999 verrait sa
// réconciliation COD dériver sans jamais savoir d'où.
function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

export interface EntreeColis {
  idExterneMarchand: string;
  reference: string;
  clientNom: string;
  clientTelephone: string;
  ville: string;
  adresse: string;
  montantCod: number;
  codePostal: string | null;
  produitDescription: string | null;
  quantite: number;
  poidsKg: number | null;
  notes: string | null;
  ouvrir: boolean;
  fragile: boolean;
}

function requis(corps: Record<string, unknown>, cle: string): string {
  const valeur = typeof corps[cle] === 'string' ? (corps[cle] as string).trim() : '';
  if (!valeur) throw new ErreurPlateforme(400, 'champ_requis', `Le champ « ${cle} » est requis`);
  return valeur;
}

function optionnel(corps: Record<string, unknown>, cle: string): string | null {
  const valeur = typeof corps[cle] === 'string' ? (corps[cle] as string).trim() : '';
  return valeur || null;
}

export function analyserEntreeColis(corpsBrut: unknown): EntreeColis {
  if (typeof corpsBrut !== 'object' || corpsBrut === null || Array.isArray(corpsBrut)) {
    throw new ErreurPlateforme(400, 'corps_invalide', 'Chaque colis doit être un objet JSON');
  }
  const corps = corpsBrut as Record<string, unknown>;

  // `reference` est la clé d'idempotence : sans elle, un rejeu créerait des
  // doublons que rien n'arrêterait (PostgreSQL ne compare pas deux NULL dans
  // un index unique — c'est justement ce qui laisse les colis saisis à la
  // main libres de toute contrainte). Elle est donc REQUISE ici, alors que la
  // colonne est nullable.
  const reference = requis(corps, 'reference');

  const montantBrut = Number(corps.montantCod);
  if (!Number.isFinite(montantBrut) || montantBrut <= 0) {
    throw new ErreurPlateforme(400, 'montant_invalide', 'montantCod est requis et doit être supérieur à 0');
  }
  if (montantBrut > MONTANT_MAX) {
    throw new ErreurPlateforme(
      400,
      'montant_invalide',
      `montantCod dépasse le maximum autorisé (${MONTANT_MAX})`
    );
  }

  const quantiteBrute = corps.quantite === undefined || corps.quantite === null ? 1 : Number(corps.quantite);
  if (!Number.isInteger(quantiteBrute) || quantiteBrute <= 0 || quantiteBrute > QUANTITE_MAX) {
    throw new ErreurPlateforme(400, 'quantite_invalide', 'quantite doit être un entier positif');
  }

  let poidsKg: number | null = null;
  if (corps.poidsKg !== undefined && corps.poidsKg !== null) {
    const poids = Number(corps.poidsKg);
    if (!Number.isFinite(poids) || poids <= 0) {
      throw new ErreurPlateforme(400, 'poids_invalide', 'poidsKg doit être un nombre positif');
    }
    if (poids > POIDS_MAX) {
      throw new ErreurPlateforme(400, 'poids_invalide', `poidsKg dépasse le maximum autorisé (${POIDS_MAX})`);
    }
    poidsKg = arrondi(poids);
  }

  return {
    idExterneMarchand: requis(corps, 'idExterneMarchand'),
    reference,
    clientNom: requis(corps, 'clientNom'),
    clientTelephone: requis(corps, 'clientTelephone'),
    ville: requis(corps, 'ville'),
    adresse: requis(corps, 'adresse'),
    montantCod: arrondi(montantBrut),
    codePostal: optionnel(corps, 'codePostal'),
    produitDescription: optionnel(corps, 'produitDescription'),
    quantite: quantiteBrute,
    poidsKg,
    notes: optionnel(corps, 'notes'),
    ouvrir: Boolean(corps.ouvrir),
    fragile: Boolean(corps.fragile),
  };
}

export type IssueColis = 'cree' | 'deja_ingere';

export interface ResultatColis {
  issue: IssueColis;
  reference: string;
  codeSuivi: string;
  marchandId: string;
  statut: string;
  aRisque: boolean;
}

// Résolution du marchand ET du cloisonnement bac à sable / production.
//
// C'est ICI que le cloisonnement d'environnement est réellement appliqué, et
// il est structurel : une clé `test` ne trouve que des liens `test`, donc ne
// peut pas déposer un colis chez un marchand de production — même si elle
// connaît son identifiant externe. Aucun drapeau sur `commandes` n'est
// nécessaire, et aucune règle applicative « ne pas facturer les colis de
// test » n'a à être tenue plus tard.
async function resoudreMarchand(contexte: ContextePlateforme, idExterne: string): Promise<string> {
  // L'environnement fait partie de la CLÉ de recherche, il n'est plus comparé
  // après coup. La comparaison explicite qui vivait ici a disparu dans la
  // contrainte d'unicité : une clé `test` ne trouve pas un lien `live`, elle
  // ne le trouve simplement pas. C'est la bonne façon pour une défense de
  // mourir — absorbée par le modèle, pas retirée.
  const lien = await prisma.compteMarchandExterne.findUnique({
    where: {
      plateformeId_environnement_idExterne: {
        plateformeId: contexte.plateformeId,
        environnement: contexte.environnement,
        idExterne,
      },
    },
    select: { marchandId: true },
  });

  if (!lien) {
    // Message unique, qu'il s'agisse d'un identifiant inexistant ou d'un
    // identifiant qui n'existe que dans l'AUTRE environnement : les
    // distinguer ferait de cet endpoint un oracle permettant à une clé de
    // test de savoir ce qui existe en production.
    throw new ErreurPlateforme(
      404,
      'marchand_inconnu',
      `Aucun marchand synchronisé sous l’identifiant « ${idExterne} » dans l’environnement ${contexte.environnement}. ` +
        'Le créer d’abord via POST /v1/marchands, avec une clé du même environnement.'
    );
  }

  return lien.marchandId;
}

/**
 * Villes du référentiel, chargées UNE fois par appel plutôt qu'une fois par
 * colis. POST /api/commandes fait ce `findMany` à chaque création, ce qui est
 * sans conséquence pour un formulaire ; sur un lot de 200 colis ce serait 200
 * lectures de toute la table.
 */
export type ReferentielVilles = { id: string; nom: string }[];

export async function chargerReferentielVilles(): Promise<ReferentielVilles> {
  return prisma.ville.findMany({ select: { id: true, nom: true } });
}

export async function ingererColis(
  contexte: ContextePlateforme,
  entree: EntreeColis,
  villes: ReferentielVilles
): Promise<ResultatColis> {
  const marchandId = await resoudreMarchand(contexte, entree.idExterneMarchand);

  // RG-08 : la liste noire s'applique au colis d'une plateforme comme à
  // n'importe quel autre. Un client signalé ne cesse pas de l'être parce que
  // la commande vient d'un canal tiers.
  const aRisque = await checkBlacklist({
    telephone: entree.clientTelephone,
    nom: entree.clientNom,
    adresse: entree.adresse,
  });

  // Résolution best-effort de villeId, jamais bloquante : `ville` reste le
  // texte libre reçu, source de vérité, et ce rapprochement n'est qu'un
  // enrichissement pour le routage automatique (cf. lib/hub-envoi.ts).
  const villeNormalisee = normaliserVille(entree.ville);
  const villeId = villes.find((v) => normaliserVille(v.nom) === villeNormalisee)?.id ?? null;

  const codeSuivi = await nextCodeSuivi();

  try {
    const commande = await prisma.$transaction(async (tx) => {
      const creee = await tx.commande.create({
        data: {
          codeSuivi,
          codeSuiviPartenaire: entree.reference,
          marchandId,
          clientNom: entree.clientNom,
          clientTelephone: entree.clientTelephone,
          ville: entree.ville,
          adresse: entree.adresse,
          codePostal: entree.codePostal,
          produitDescription: entree.produitDescription,
          quantite: entree.quantite,
          poidsKg: entree.poidsKg,
          montantCod: entree.montantCod,
          notes: entree.notes,
          ouvrir: entree.ouvrir,
          fragile: entree.fragile,
          statut: 'nouveau_colis',
          aRisque,
          source: 'api',
          villeId,
        },
      });

      // RG-10 : chaque changement de statut est historisé, l'état initial
      // compris. L'auteur est le compte de service de la plateforme — c'est
      // toute sa raison d'être (cf. PlateformePartenaire.utilisateurTechnique).
      await tx.historiqueStatutCommande.create({
        data: {
          commandeId: creee.id,
          ancienStatut: null,
          nouveauStatut: 'nouveau_colis',
          utilisateurId: contexte.utilisateurTechniqueId,
          note: `Colis déposé par ${contexte.plateformeCode} (réf. ${entree.reference})`,
        },
      });

      return creee;
    });

    return {
      issue: 'cree',
      reference: entree.reference,
      codeSuivi: commande.codeSuivi,
      marchandId,
      statut: commande.statut,
      aRisque: commande.aRisque,
    };
  } catch (error) {
    // P2002 sur commandes_marchand_ref_partenaire_key : cette référence a déjà
    // été ingérée pour ce marchand. On répond en SUCCÈS avec le code de suivi
    // déjà attribué plutôt qu'en erreur — une reprise après timeout ou une
    // redélivrance de file de messages est un cas NORMAL, pas une panne, et
    // renvoyer le code existant est précisément ce dont l'appelant a besoin
    // pour se réconcilier.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existante = await prisma.commande.findFirst({
        where: { marchandId, codeSuiviPartenaire: entree.reference },
        select: { codeSuivi: true, statut: true, aRisque: true },
      });
      if (existante) {
        return {
          issue: 'deja_ingere',
          reference: entree.reference,
          codeSuivi: existante.codeSuivi,
          marchandId,
          statut: existante.statut,
          aRisque: existante.aRisque,
        };
      }
    }
    throw error;
  }
}

export interface LigneLot {
  /** Position dans le tableau reçu — la seule façon de désigner une ligne qui
   *  a été refusée avant même que sa référence soit lisible. */
  index: number;
  reference: string | null;
  ok: boolean;
  resultat?: ResultatColis;
  code?: string;
  message?: string;
}

export interface ResultatLot {
  total: number;
  crees: number;
  dejaIngeres: number;
  refuses: number;
  lignes: LigneLot[];
}

// Traitement LIGNE À LIGNE, jamais en une transaction globale : un lot de 200
// colis dont 3 portent une ville illisible doit en créer 197, pas 0. Une
// machine ne peut pas « corriger et réessayer » comme un humain devant un
// tableur — lui rejeter tout le lot l'oblige à un tri manuel que l'API est
// justement censée éviter.
export async function ingererLot(
  contexte: ContextePlateforme,
  corpsBrut: unknown
): Promise<ResultatLot> {
  if (!Array.isArray(corpsBrut)) {
    throw new ErreurPlateforme(400, 'corps_invalide', 'Le corps doit être un tableau de colis');
  }
  if (corpsBrut.length === 0) {
    throw new ErreurPlateforme(400, 'lot_vide', 'Le lot ne contient aucun colis');
  }
  if (corpsBrut.length > TAILLE_MAX_LOT) {
    throw new ErreurPlateforme(
      413,
      'lot_trop_grand',
      `Un lot ne peut pas dépasser ${TAILLE_MAX_LOT} colis (reçu : ${corpsBrut.length})`
    );
  }

  const villes = await chargerReferentielVilles();
  const lignes: LigneLot[] = [];

  for (const [index, brut] of corpsBrut.entries()) {
    // La référence est extraite avant validation complète : une ligne refusée
    // pour un autre champ doit tout de même pouvoir être désignée par la
    // référence que l'appelant connaît.
    const reference =
      typeof brut === 'object' && brut !== null && typeof (brut as Record<string, unknown>).reference === 'string'
        ? ((brut as Record<string, unknown>).reference as string).trim() || null
        : null;

    try {
      const entree = analyserEntreeColis(brut);
      const resultat = await ingererColis(contexte, entree, villes);
      lignes.push({ index, reference: entree.reference, ok: true, resultat });
    } catch (error) {
      if (error instanceof ErreurPlateforme) {
        lignes.push({ index, reference, ok: false, code: error.code, message: error.message });
        continue;
      }
      // Une erreur inattendue n'interrompt pas le lot non plus : elle est
      // journalisée côté serveur et la ligne est marquée en échec générique,
      // sans rien laisser filtrer de l'interne.
      console.error('Ingestion de colis en échec', error);
      lignes.push({
        index,
        reference,
        ok: false,
        code: 'erreur_interne',
        message: 'Erreur interne sur cette ligne',
      });
    }
  }

  return {
    total: lignes.length,
    crees: lignes.filter((l) => l.resultat?.issue === 'cree').length,
    dejaIngeres: lignes.filter((l) => l.resultat?.issue === 'deja_ingere').length,
    refuses: lignes.filter((l) => !l.ok).length,
    lignes,
  };
}
