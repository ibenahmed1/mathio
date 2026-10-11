import type { StatutCommande } from '@/app/generated/prisma/enums';
import { Prisma } from '@/app/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { ErreurPlateforme, type ContextePlateforme } from '@/lib/plateforme-auth';
import { LABELS_STATUT_COMMANDE, STATUTS_TERMINAUX } from '@/lib/statuts';

// Les statuts TRANSMIS aux plateformes, choisis par l'exploitation le
// 11/10/2026 (« client intéressé » retiré le même jour). Les autres étapes
// internes (enregistrement, ramassage, transits, remise au transporteur,
// centre d'appel en cours, retour par transporteur) ne sortent pas : le colis
// garde chez la plateforme le dernier statut transmis. Ajouter ou retirer un
// statut ici change le contrat : prévenir les plateformes avant de déployer.
export const STATUTS_TRANSMIS: StatutCommande[] = [
  'pret_pour_preparation',
  'mise_en_distribution',
  'livre',
  'boite_vocale',
  'deuxieme_appel_pas_reponse',
  'troisieme_appel_pas_reponse',
  'pas_de_reponse_sms',
  'injoignable',
  'numero_errone',
  'relance_nouveau_client',
  'attente_de_relancer',
  'programme',
  'reporte',
  'hors_zone',
  'refuse',
  'retourne_au_hub',
  'retourne',
  'annule',
  'annule_par_vendeur',
];

// § GET /v1/colis — les colis d'une plateforme dont le statut a changé.
//
// Demande de Shipeh du 10/10/2026 : elle paie ses vendeurs à la livraison, et
// notre API ne lui rendait rien. Format de LEUR demande : un tableau `colis`,
// UNE LIGNE PAR COLIS, avec son statut ACTUEL (le dernier transmis) et la date
// de ce statut — et non un flux d'événements (première version du 11/10,
// remplacée le jour même à la demande de l'exploitation).
//
// Les statuts sortent TELS QUELS — nos codes internes (StatutCommande) et leur
// libellé français — par décision de l'exploitation du 11/10/2026, limités à
// STATUTS_TRANSMIS.
//
// Garanties :
//   - ORDRE TOTAL : tri par (statutDate, identifiant du colis). Un curseur ne
//     saute jamais un colis ;
//   - RIEN DE PERDU : un colis dont le statut change APRÈS avoir été lu
//     ressort au passage suivant (sa nouvelle date est postérieure au
//     curseur), avec son nouveau statut. Les étapes intermédiaires entre deux
//     lectures ne sont pas rendues : seul l'état actuel compte ici ;
//   - REJOUABLE : relire la même fenêtre rend les mêmes colis, sauf ceux qui
//     ont changé depuis — ils ressortent alors plus loin ;
//   - STABILISATION : un changement des STABILISATION_MS dernières
//     millisecondes n'est pas encore pris en compte. Une transaction peut
//     valider un horodatage légèrement antérieur à celui d'une autre déjà
//     visible ; sans ce délai, un curseur passé au-delà le manquerait ;
//   - PÉRIMÈTRE : seuls les colis DÉPOSÉS PAR CETTE PLATEFORME (source api)
//     chez SES marchands, dans l'environnement de la clé.

export const LIMITE_DEFAUT = 200;
export const LIMITE_MAX = 500;
export const STABILISATION_MS = 10_000;

export interface RequeteSuivi {
  depuis: Date | null;
  curseur: { horodatage: Date; id: string } | null;
  limite: number;
}

export interface ColisSuivi {
  reference: string | null;
  codeSuivi: string;
  // Code interne du statut (« livre », « refuse », « injoignable »…).
  statut: StatutCommande;
  libelle: string;
  // Statut terminal (STATUTS_TERMINAUX) : livré, retourné, annulé. Seul un
  // admin peut encore le corriger : le colis ressort alors avec son statut
  // corrigé.
  final: boolean;
  statutDate: string;
  // COD encaissé : le COD du colis quand il est livré (c'est à la livraison
  // qu'il est encaissé), 0 sinon. Montant ATTENDU, non confirmé par le
  // transporteur : le montant réellement reversé viendra avec le journal
  // financier.
  montantEncaisse: number;
  montantCod: number;
  // Réservé (décision du 11/10/2026) : nom et numéro du livreur, fournis
  // ultérieurement. Toujours `null` pour l'instant, mais présent dans le
  // contrat pour que son arrivée ne change pas la forme de la réponse.
  transporteur: null;
}

export interface PageSuivi {
  colis: ColisSuivi[];
  curseurSuivant: string | null;
  fin: boolean;
}

export function encoderCurseur(horodatage: Date, id: string): string {
  return Buffer.from(`${horodatage.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decoderCurseur(brut: string): { horodatage: Date; id: string } {
  const texte = Buffer.from(brut, 'base64url').toString('utf8');
  const [date, id] = texte.split('|');
  const horodatage = new Date(date ?? '');
  if (!id || Number.isNaN(horodatage.getTime())) {
    throw new ErreurPlateforme(400, 'curseur_invalide', 'curseur illisible : reprendre celui renvoyé par la page précédente');
  }
  return { horodatage, id };
}

// Paramètres de l'URL. `modifiesDepuis` est REQUIS sans curseur : sans borne
// basse, chaque appel renverrait tous les colis.
export function analyserRequeteSuivi(params: URLSearchParams): RequeteSuivi {
  const curseurBrut = params.get('curseur');
  const depuisBrut = params.get('modifiesDepuis');
  const limiteBrute = params.get('limite');

  const limite = limiteBrute === null ? LIMITE_DEFAUT : Number(limiteBrute);
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAX) {
    throw new ErreurPlateforme(400, 'limite_invalide', `limite doit être un entier de 1 à ${LIMITE_MAX}`);
  }

  if (curseurBrut) return { depuis: null, curseur: decoderCurseur(curseurBrut), limite };

  if (!depuisBrut) {
    throw new ErreurPlateforme(400, 'champ_requis', 'Le paramètre « modifiesDepuis » est requis (ou « curseur »)');
  }
  const depuis = new Date(depuisBrut);
  if (Number.isNaN(depuis.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(depuisBrut)) {
    throw new ErreurPlateforme(400, 'date_invalide', 'modifiesDepuis doit être une date ISO 8601 (ex. 2026-10-10T08:00:00Z)');
  }
  return { depuis, curseur: null, limite };
}

interface LigneSql {
  commande_id: string;
  nouveau_statut: string;
  horodatage: Date;
  code_suivi: string;
  code_suivi_partenaire: string | null;
  montant_cod: Prisma.Decimal | number | string;
}

export async function listerColisModifies(
  contexte: ContextePlateforme,
  requete: RequeteSuivi,
  maintenant: Date = new Date()
): Promise<PageSuivi> {
  const liens = await prisma.compteMarchandExterne.findMany({
    where: { plateformeId: contexte.plateformeId, environnement: contexte.environnement },
    select: { marchandId: true },
  });
  const marchandIds = liens.map((l) => l.marchandId);
  if (marchandIds.length === 0) return { colis: [], curseurSuivant: null, fin: true };

  const stabilise = new Date(maintenant.getTime() - STABILISATION_MS);
  const borne = requete.curseur
    ? Prisma.sql`(d."horodatage", d."commande_id") > (${requete.curseur.horodatage}, ${requete.curseur.id})`
    : Prisma.sql`d."horodatage" >= ${requete.depuis!}`;

  // Pour chaque colis du périmètre : son DERNIER changement vers un statut
  // transmis (DISTINCT ON), puis la page triée par (date, colis).
  const lignes = await prisma.$queryRaw<LigneSql[]>`
    WITH dernier AS (
      SELECT DISTINCT ON (h."commande_id")
             h."commande_id", h."nouveau_statut"::text AS "nouveau_statut", h."horodatage"
      FROM "historique_statuts_commande" h
      JOIN "commandes" c ON c."id" = h."commande_id"
      WHERE c."source"::text = 'api'
        AND c."marchand_id" = ANY(${marchandIds})
        AND h."nouveau_statut"::text = ANY(${STATUTS_TRANSMIS as string[]})
        AND h."horodatage" <= ${stabilise}
      ORDER BY h."commande_id", h."horodatage" DESC, h."id" DESC
    )
    SELECT d."commande_id", d."nouveau_statut", d."horodatage",
           c."code_suivi", c."code_suivi_partenaire", c."montant_cod"
    FROM dernier d
    JOIN "commandes" c ON c."id" = d."commande_id"
    WHERE ${borne}
    ORDER BY d."horodatage" ASC, d."commande_id" ASC
    LIMIT ${requete.limite + 1}
  `;

  const fin = lignes.length <= requete.limite;
  const page = lignes.slice(0, requete.limite);
  const derniere = page.at(-1);

  return {
    colis: page.map((l) => {
      const statut = l.nouveau_statut as StatutCommande;
      const montantCod = Number(l.montant_cod);
      return {
        reference: l.code_suivi_partenaire,
        codeSuivi: l.code_suivi,
        statut,
        libelle: LABELS_STATUT_COMMANDE[statut],
        final: STATUTS_TERMINAUX.includes(statut),
        statutDate: l.horodatage.toISOString(),
        montantEncaisse: statut === 'livre' ? montantCod : 0,
        montantCod,
        transporteur: null,
      };
    }),
    // Toujours renvoyé dès qu'une page a été lue, même en fin de liste : le
    // partenaire le garde pour son prochain passage.
    curseurSuivant: derniere
      ? encoderCurseur(derniere.horodatage, derniere.commande_id)
      : requete.curseur
        ? encoderCurseur(requete.curseur.horodatage, requete.curseur.id)
        : null,
    fin,
  };
}
