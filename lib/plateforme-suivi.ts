import type { StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ErreurPlateforme, type ContextePlateforme } from '@/lib/plateforme-auth';
import { LABELS_STATUT_COMMANDE, STATUTS_TERMINAUX } from '@/lib/statuts';

// Les statuts TRANSMIS aux plateformes, choisis par l'exploitation le
// 11/10/2026 (« client intéressé » retiré le même jour). Les autres étapes internes (enregistrement, ramassage, transits,
// remise au transporteur, centre d'appel en cours, retour par transporteur) ne
// sortent pas : le colis garde chez la plateforme le dernier statut transmis.
// Ajouter ou retirer un statut ici change le contrat : prévenir les
// plateformes avant de déployer.
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

// § GET /v1/colis — les événements de statut des colis d'une plateforme.
//
// Demande de Shipeh du 10/10/2026 : elle paie ses vendeurs à la livraison, et
// notre API ne lui rendait rien. Les statuts sortent TELS QUELS — nos codes
// internes (StatutCommande) et leur libellé français — par décision de
// l'exploitation du 11/10/2026 : Shipeh n'imposait aucun vocabulaire, et
// leur exemple était le nôtre (« livre »). Conséquence à connaître : ajouter,
// renommer ou retirer un statut interne change le contrat de cette API, il
// faut prévenir les plateformes AVANT de déployer. Plutôt qu'un état « dernier statut » (qui
// perdrait les étapes intermédiaires et ne se rejoue pas), on expose le FLUX
// des changements de statut : chaque ligne de HistoriqueStatutCommande (RG-10,
// tout changement de statut est historisé) devient un événement daté et
// identifié.
//
// Garanties, dans l'ordre où le partenaire en a besoin :
//   - ORDRE TOTAL : tri par (horodatage, id). Deux événements de la même
//     milliseconde sont départagés par l'identifiant : un curseur ne saute
//     jamais une ligne ;
//   - REJOUABLE : relire la même fenêtre rend les mêmes événements, et
//     `evenementId` permet d'écarter les doublons d'un recouvrement volontaire ;
//   - STABILISATION : les événements des STABILISATION_MS dernières
//     millisecondes ne sont pas encore servis. Une transaction peut valider un
//     horodatage légèrement antérieur à celui d'une autre déjà visible ; sans
//     ce délai, un curseur passé au-delà le manquerait pour toujours ;
//   - PÉRIMÈTRE : seuls les colis DÉPOSÉS PAR CETTE PLATEFORME (source api)
//     chez SES marchands, dans l'environnement de la clé. Un marchand rattaché
//     garde ses autres colis pour lui.

export const LIMITE_DEFAUT = 200;
export const LIMITE_MAX = 500;
export const STABILISATION_MS = 10_000;

export interface RequeteSuivi {
  depuis: Date | null;
  curseur: { horodatage: Date; id: string } | null;
  limite: number;
}

export interface EvenementColis {
  evenementId: string;
  reference: string | null;
  codeSuivi: string;
  // Code interne du statut (« livre », « refuse », « injoignable »…).
  statut: StatutCommande;
  libelle: string;
  // Statut terminal (STATUTS_TERMINAUX) : livré, retourné, annulé. Seul un
  // admin peut encore le corriger, ce qui produit un nouvel événement.
  final: boolean;
  statutDate: string;
  // COD à encaisser sur ce colis. Le montant RÉELLEMENT encaissé par le
  // transporteur n'est pas encore connu de nous colis par colis : il viendra
  // avec le journal financier.
  montantCod: number;
}

export interface PageSuivi {
  evenements: EvenementColis[];
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

// Paramètres de l'URL. `modifiesDepuis` est REQUIS sans curseur : un flux sans
// borne basse renverrait tout l'historique à chaque appel.
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

export async function listerEvenementsColis(
  contexte: ContextePlateforme,
  requete: RequeteSuivi,
  maintenant: Date = new Date()
): Promise<PageSuivi> {
  const liens = await prisma.compteMarchandExterne.findMany({
    where: { plateformeId: contexte.plateformeId, environnement: contexte.environnement },
    select: { marchandId: true },
  });
  const marchandIds = liens.map((l) => l.marchandId);
  if (marchandIds.length === 0) return { evenements: [], curseurSuivant: null, fin: true };

  const borne = requete.curseur
    ? {
        OR: [
          { horodatage: { gt: requete.curseur.horodatage } },
          { horodatage: requete.curseur.horodatage, id: { gt: requete.curseur.id } },
        ],
      }
    : { horodatage: { gte: requete.depuis! } };

  const lignes = await prisma.historiqueStatutCommande.findMany({
    where: {
      AND: [
        borne,
        { horodatage: { lte: new Date(maintenant.getTime() - STABILISATION_MS) } },
        { nouveauStatut: { in: STATUTS_TRANSMIS } },
        { commande: { source: 'api', marchandId: { in: marchandIds } } },
      ],
    },
    orderBy: [{ horodatage: 'asc' }, { id: 'asc' }],
    take: requete.limite + 1,
    select: {
      id: true,
      nouveauStatut: true,
      horodatage: true,
      commande: { select: { codeSuivi: true, codeSuiviPartenaire: true, montantCod: true } },
    },
  });

  const fin = lignes.length <= requete.limite;
  const page = lignes.slice(0, requete.limite);
  const derniere = page.at(-1);

  return {
    evenements: page.map((l) => {
      const statut = l.nouveauStatut as StatutCommande;
      return {
        evenementId: l.id,
        reference: l.commande.codeSuiviPartenaire,
        codeSuivi: l.commande.codeSuivi,
        statut,
        libelle: LABELS_STATUT_COMMANDE[statut],
        final: STATUTS_TERMINAUX.includes(statut),
        statutDate: l.horodatage.toISOString(),
        montantCod: Number(l.commande.montantCod),
      };
    }),
    // Toujours renvoyé quand la page n'est pas vide, même en fin de flux : le
    // partenaire le garde pour son prochain passage et ne relit rien deux fois.
    curseurSuivant: derniere ? encoderCurseur(derniere.horodatage, derniere.id) : requete.curseur ? encoderCurseur(requete.curseur.horodatage, requete.curseur.id) : null,
    fin,
  };
}
