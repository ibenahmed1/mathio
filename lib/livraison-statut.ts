import type { StatutCommande } from '@/app/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ErreurPlateforme, type ContextePlateforme } from '@/lib/plateforme-auth';
import { normaliserVille } from '@/lib/hub-stock';
import {
  STATUTS_PRESTATAIRE,
  STATUTS_TERMINAUX,
  statutPrestataire,
  type StatutPrestataire,
} from '@/lib/statuts';

// Suivi des colis confiés à un transporteur sous-traitant
// (§ POST /api/v1/livraisons/statut et POST /api/v1/livraisons/statuts).
//
// C'est le canal de RETOUR de la sous-traitance : les colis partent chez le
// prestataire par un fichier, hors système, et sans ce module ils y
// disparaissent — figés à leur dernier statut connu jusqu'à ce que quelqu'un
// téléphone. Ici, c'est le transporteur qui dépose l'information, au fil de
// ses tournées.
//
// LE PÉRIMÈTRE EST LA PREMIÈRE GARANTIE, avant même l'authentification. Une
// clé authentifiée mais sans périmètre pourrait poser `livre` sur le colis
// d'un confrère — et `livre` est une écriture d'argent : elle ferme le colis,
// le rend facturable au marchand et fait naître une dette COD.
//
// LE SEUL CRITÈRE est la VILLE DE DESTINATION du colis : un transporteur peut
// déclarer un colis dès lors que `Commande.ville` figure parmi les villes que
// ses agences desservent (table `Ville`, § /admin/hubs).
//
// Le critère précédent — « le colis est physiquement dans une de ses agences »
// (Commande.hubActuelId → Hub.prestataireId) — a été RETIRÉ : il ne devenait
// vrai qu'au scan de réception, alors que le transporteur a le colis en main
// bien avant et n'avait donc rien à déclarer entre-temps.
//
// Deux conséquences à connaître, et elles sont assumées :
//
//   - LE MOMENT N'EST PLUS BORNÉ. Un colis destiné à sa zone est déclarable
//     avant même de lui être remis, et le reste après son retour chez nous.
//   - UNE VILLE PARTAGÉE EST PARTAGÉE. Quand deux réseaux annoncent la même
//     ville — Aknoul, Bouhlou, Tahla, Taourirt (§ SOUS_TRAITANCE.md) — les
//     DEUX transporteurs peuvent déclarer le colis. `meilleurHub` tranche le
//     routage, pas le périmètre de cette API.
//
// Seule une table de remise explicite refermerait les deux
// (§10 d'API_SUIVI_PRESTATAIRES.md).

// Plafond d'un lot. Cent lignes couvrent largement une tournée, et bornent une
// requête dont chaque ligne fait sa propre transaction — le lot n'est
// volontairement PAS atomique (voir appliquerLotStatuts).
export const TAILLE_MAX_LOT_STATUTS = 100;

// Même borne que la note livreur des API du marché : assez pour « client
// absent, rappelle demain », trop court pour qu'un intégrateur y déverse un
// journal. La note atterrit dans un commentaire de colis lu par des humains.
export const NOTE_MAX = 150;

// Date seule (2026-09-12) ou horodatage ISO complet. Volontairement strict :
// tout ce qui n'a pas cette forme est refusé plutôt que confié à l'analyseur
// permissif de JavaScript (cf. le commentaire dans analyserEntreeStatut).
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export interface EntreeStatut {
  codeSuivi: string;
  statut: StatutPrestataire;
  date: Date | null;
  note: string | null;
}

export type IssueStatut = 'applique' | 'inchange';

export interface ResultatStatut {
  issue: IssueStatut;
  codeSuivi: string;
  statut: StatutCommande;
}

export interface LigneRefusee {
  issue: 'refuse';
  codeSuivi: string | null;
  code: string;
  message: string;
}

export interface ResultatLotStatuts {
  totalTraite: number;
  totalRefuse: number;
  resultats: (ResultatStatut | LigneRefusee)[];
}

// --- Validation -------------------------------------------------------------

export function analyserEntreeStatut(corpsBrut: unknown): EntreeStatut {
  if (typeof corpsBrut !== 'object' || corpsBrut === null || Array.isArray(corpsBrut)) {
    throw new ErreurPlateforme(400, 'corps_invalide', 'Chaque ligne doit être un objet JSON');
  }
  const corps = corpsBrut as Record<string, unknown>;

  // Normalisé en majuscules : nos codes s'écrivent `PD-000123` (lib/codes.ts),
  // et un partenaire qui recopie depuis un tableur ou un scan renvoie parfois
  // une autre casse. Répondre 404 sur une différence de casse enverrait
  // chercher un colis qui existe.
  const codeSuivi = typeof corps.codeSuivi === 'string' ? corps.codeSuivi.trim().toUpperCase() : '';
  if (!codeSuivi) {
    throw new ErreurPlateforme(400, 'champ_requis', 'Le champ « codeSuivi » est requis');
  }

  const statut = statutPrestataire(corps.statut);
  if (!statut) {
    // Citer les valeurs acceptées plutôt que renvoyer vers la documentation :
    // c'est l'erreur qu'un intégrateur rencontre le premier jour, et la
    // première réponse qu'il lit est celle du serveur.
    throw new ErreurPlateforme(
      400,
      'statut_invalide',
      `Le champ « statut » doit valoir l’une de ces valeurs : ${STATUTS_PRESTATAIRE.join(', ')}`
    );
  }

  let date: Date | null = null;
  if (statut.dateRequise) {
    const brut = typeof corps.date === 'string' ? corps.date.trim() : '';
    // La FORME est vérifiée avant l'analyse, et ce n'est pas du zèle : `new
    // Date()` accepte « 12/09/2026 » et le lit à l'américaine, soit le 9
    // DÉCEMBRE pour un partenaire qui voulait le 12 septembre. La date part
    // ensuite dans `dateNouvelleLivraison`, donc dans la file de relance —
    // l'erreur ne se verrait qu'au moment où le colis ne serait pas retenté.
    // Seul l'ISO 8601 est accepté, comme annoncé au catalogue.
    const analysee = ISO_8601.test(brut) ? new Date(brut) : null;
    if (!analysee || Number.isNaN(analysee.getTime())) {
      throw new ErreurPlateforme(
        400,
        'date_requise',
        `Le statut « ${statut.statut} » exige une date de prochaine tentative (ISO 8601) dans le champ « date »`
      );
    }
    date = analysee;
  }
  // Une date envoyée sur un statut qui n'en demande pas est IGNORÉE, pas
  // refusée : les intégrateurs sérialisent souvent une structure unique où le
  // champ est toujours présent, et refuser les obligerait à découper leur code
  // par statut sans qu'aucun colis n'en soit mieux traité.

  const noteBrute = typeof corps.note === 'string' ? corps.note.trim() : '';
  if (noteBrute.length > NOTE_MAX) {
    throw new ErreurPlateforme(
      400,
      'note_trop_longue',
      `Le champ « note » est limité à ${NOTE_MAX} caractères`
    );
  }

  return { codeSuivi, statut, date, note: noteBrute || null };
}

export function analyserLotStatuts(corpsBrut: unknown): unknown[] {
  if (typeof corpsBrut !== 'object' || corpsBrut === null || Array.isArray(corpsBrut)) {
    throw new ErreurPlateforme(400, 'corps_invalide', 'Le corps doit être un objet JSON');
  }
  const lignes = (corpsBrut as Record<string, unknown>).livraisons;
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new ErreurPlateforme(
      400,
      'champ_requis',
      'Le champ « livraisons » doit être un tableau non vide'
    );
  }
  if (lignes.length > TAILLE_MAX_LOT_STATUTS) {
    throw new ErreurPlateforme(
      400,
      'lot_trop_grand',
      `Un lot ne peut dépasser ${TAILLE_MAX_LOT_STATUTS} livraisons`
    );
  }
  return lignes;
}

// --- Transition -------------------------------------------------------------

// Trois issues nommées plutôt qu'un booléen `autorisee` doublé d'un `inchange` :
// « refusé » et « inchangé » ne sont pas deux nuances d'un même oui/non, et les
// distinguer par leur nom évite au lecteur — comme au compilateur — d'avoir à
// combiner deux drapeaux pour retrouver le cas réel.
export type DecisionTransition =
  | { issue: 'applique' }
  | { issue: 'inchange' }
  | { issue: 'refuse'; code: string; message: string };

// Décision PURE — aucune base, donc testable seule. Elle porte les deux règles
// que les API livreur du marché n'ont pas, et qui manquent toutes les deux
// pour la même raison : elles ne se voient qu'au rejeu.
//
//  1. IDEMPOTENCE. Un lot rejoué après un timeout ne doit rien changer. Le
//     même statut sur le même colis répond succès sans réécrire, plutôt que
//     d'empiler une seconde ligne d'historique qui laisserait croire à une
//     seconde tentative de livraison.
//
//  2. COLIS CLOS. Un colis livré ne redevient pas « reporté » parce qu'un
//     fichier est renvoyé deux fois, ou qu'un lot part d'un export périmé.
//     Sans cette règle, un rejeu peut rouvrir un colis déjà facturé.
export function deciderTransition(
  statutActuel: StatutCommande,
  demande: StatutPrestataire
): DecisionTransition {
  return deciderTransitionStatut(statutActuel, demande.statut);
}

// Même décision, sur n'importe quel statut de colis et non sur les seuls douze
// du catalogue public. C'est la porte des transporteurs branchés par LEUR API
// (lib/suivi-power-delivery.ts), qui posent aussi la mise en distribution et le
// retour : une règle, deux portes — jamais deux règles qui divergeraient.
export function deciderTransitionStatut(
  statutActuel: StatutCommande,
  demande: StatutCommande
): DecisionTransition {
  if (statutActuel === demande) {
    return { issue: 'inchange' };
  }
  if (STATUTS_TERMINAUX.includes(statutActuel)) {
    return {
      issue: 'refuse',
      code: 'colis_clos',
      message: `Ce colis est clos (« ${statutActuel} ») : son statut ne peut plus être modifié`,
    };
  }
  return { issue: 'applique' };
}

// --- Résolution du périmètre ------------------------------------------------

// Le transporteur derrière la clé. Une clé de plateforme de VENTE n'en a pas :
// elle dépose des colis, elle n'en livre aucun. Le 403 est donc la réponse
// juste — la clé est valide, elle n'a simplement rien à faire ici.
async function prestataireDeLaCle(contexte: ContextePlateforme): Promise<string> {
  const plateforme = await prisma.plateformePartenaire.findUnique({
    where: { id: contexte.plateformeId },
    select: { prestataireId: true },
  });
  if (!plateforme?.prestataireId) {
    throw new ErreurPlateforme(
      403,
      'compte_sans_prestataire',
      'Ce compte n’est rattaché à aucun transporteur : il ne peut pas poser de statut de livraison'
    );
  }
  return plateforme.prestataireId;
}

/**
 * Les villes desservies par un transporteur, NORMALISÉES.
 *
 * Toutes les villes de toutes ses agences, sans arbitrage : `getVilleHubIndex()`
 * (lib/hub-envoi.ts) n'en retient qu'une par nom pour décider du ROUTAGE, ce
 * qui écarterait le second réseau sur une ville partagée. Ici la question est
 * différente — « ce transporteur annonce-t-il cette ville ? » —, et deux
 * transporteurs peuvent y répondre oui.
 */
export async function villesDesserviesPar(prestataireId: string): Promise<Set<string>> {
  const villes = await prisma.ville.findMany({
    where: { hub: { prestataireId } },
    select: { nom: true },
  });
  return new Set(villes.map((v) => normaliserVille(v.nom)));
}

export interface PerimetreTransporteur {
  prestataireId: string;
  /** Noms normalisés — comparer avec `villeDesservie`, jamais en direct. */
  villes: ReadonlySet<string>;
}

/**
 * Résout, en une fois par requête, ce que la clé a le droit de toucher.
 *
 * Chargé au niveau de la REQUÊTE et non de la ligne : un lot de cent
 * déclarations ne doit pas relire cent fois la liste des villes.
 */
export async function perimetreDuTransporteur(
  contexte: ContextePlateforme
): Promise<PerimetreTransporteur> {
  const prestataireId = await prestataireDeLaCle(contexte);
  return { prestataireId, villes: await villesDesserviesPar(prestataireId) };
}

/**
 * `Commande.ville` est du TEXTE LIBRE saisi par un marchand : la comparaison
 * se fait sur le nom normalisé (casse et accents repliés, `normaliserVille`),
 * jamais sur la chaîne brute. Sans ça, « Meknès » ne retrouverait pas
 * « meknes » et le colis serait refusé à un transporteur qui le dessert.
 *
 * Fonction PURE — c'est ce qui rend la règle testable sans base.
 */
export function villeDesservie(villes: ReadonlySet<string>, ville: string): boolean {
  return villes.has(normaliserVille(ville));
}

// --- Application ------------------------------------------------------------

export async function appliquerStatut(
  contexte: ContextePlateforme,
  perimetre: PerimetreTransporteur,
  entree: EntreeStatut
): Promise<ResultatStatut> {
  const commande = await prisma.commande.findUnique({
    where: { codeSuivi: entree.codeSuivi },
    select: { id: true, statut: true, ville: true },
  });

  // UN SEUL code de refus pour « inconnu » et « hors de vos villes », et c'est
  // délibéré : distinguer les deux dirait à qui sonde quels codes de suivi
  // existent chez nous. Même raisonnement que le message unique d'échec de clé
  // (lib/plateforme-auth.ts).
  if (!commande || !villeDesservie(perimetre.villes, commande.ville)) {
    throw new ErreurPlateforme(
      404,
      'colis_introuvable',
      'Aucun colis déclarable ne correspond à ce code de suivi'
    );
  }

  const decision = deciderTransition(commande.statut, entree.statut);
  if (decision.issue === 'refuse') {
    throw new ErreurPlateforme(409, decision.code, decision.message);
  }
  if (decision.issue === 'inchange') {
    return { issue: 'inchange', codeSuivi: entree.codeSuivi, statut: commande.statut };
  }

  const nouveauStatut = entree.statut.statut;
  const issue = await ecrireTransition({
    commandeId: commande.id,
    statutActuel: commande.statut,
    nouveauStatut,
    auteurId: contexte.utilisateurTechniqueId,
    noteHistorique: noteHistorique(contexte.plateformeCode, entree),
    dateNouvelleLivraison: entree.date,
    commentaire: entree.note,
  });

  return { issue, codeSuivi: entree.codeSuivi, statut: nouveauStatut };
}

export interface TransitionColis {
  commandeId: string;
  // Statut LU avant la décision : c'est sur lui que porte le verrou optimiste.
  statutActuel: StatutCommande;
  nouveauStatut: StatutCommande;
  // Compte de service du transporteur : la colonne d'auteur est non nullable,
  // et un colis mis à jour par une machine n'a pas d'auteur humain.
  auteurId: string;
  noteHistorique: string;
  dateNouvelleLivraison: Date | null;
  commentaire: string | null;
}

// L'écriture d'une transition déjà DÉCIDÉE (deciderTransitionStatut), partagée
// par toutes les portes machine. Lève ErreurPlateforme(409) si le colis a
// changé sous nos pieds — `colis_clos` ou `conflit_concurrent`.
export async function ecrireTransition(t: TransitionColis): Promise<IssueStatut> {
  const maintenant = new Date();
  const { nouveauStatut } = t;
  const commande = { id: t.commandeId, statut: t.statutActuel };

  return prisma.$transaction<IssueStatut>(async (tx) => {
    // VERROU OPTIMISTE : la mise à jour n'aboutit que si le statut n'a pas
    // bougé depuis la lecture ci-dessus.
    //
    // Sans lui, deux appels simultanés sur le même colis lisent le même état,
    // décident tous deux « applique », et écrivent DEUX lignes d'historique
    // pour une seule transition — ce qui laisserait croire à deux tentatives
    // de livraison là où il n'y en a eu qu'une. Le cas n'est pas théorique :
    // un partenaire qui rejoue un lot après un timeout envoie précisément des
    // requêtes concurrentes sur les mêmes colis.
    //
    // La garantie est donc portée par la BASE — le `where` sur l'ancien
    // statut — et non par l'ordre des instructions, seul un contrôle
    // applicatif « lire puis écrire » ne fermant pas la fenêtre entre les
    // deux. Même raisonnement que l'idempotence de POST /v1/colis, qui
    // s'appuie sur une contrainte d'unicité plutôt que sur du code.
    const { count } = await tx.commande.updateMany({
      where: { id: commande.id, statut: commande.statut },
      data: {
        statut: nouveauStatut,
        ...(nouveauStatut === 'livre' && { dateLivraison: maintenant }),
        ...(t.dateNouvelleLivraison && { dateNouvelleLivraison: t.dateNouvelleLivraison }),
      },
    });

    if (count === 0) {
      // Quelqu'un est passé entre notre lecture et notre écriture. On rejoue
      // la décision sur l'état réel plutôt que de refuser en bloc : si
      // l'autre appel a fait exactement le même travail — le cas d'un rejeu
      // parallèle — la réponse juste est « inchangé », pas une erreur.
      const actuel = await tx.commande.findUnique({
        where: { id: commande.id },
        select: { statut: true },
      });
      if (actuel?.statut === nouveauStatut) return 'inchange';

      const seconde = deciderTransitionStatut(actuel!.statut, nouveauStatut);
      if (seconde.issue === 'refuse') {
        throw new ErreurPlateforme(409, seconde.code, seconde.message);
      }
      throw new ErreurPlateforme(
        409,
        'conflit_concurrent',
        'Ce colis a changé de statut pendant le traitement de votre requête. Réessayez.'
      );
    }

    // RG-10 : historisation de chaque changement de statut. L'auteur est le
    // compte de SERVICE du prestataire — la colonne est non nullable, et un
    // colis mis à jour par une machine n'a pas d'auteur humain. L'historique
    // affiche donc « Meta Livraison » là où il affiche ailleurs un nom de
    // collègue, ce qui est exactement ce qu'un exploitant a besoin de lire.
    //
    // `hubId` reste nul : la colonne ne se renseigne que sur les transitions
    // posées à un quai (scan de réception, bon d'envoi), et un statut de
    // livraison n'en est pas une.
    await tx.historiqueStatutCommande.create({
      data: {
        commandeId: commande.id,
        ancienStatut: commande.statut,
        nouveauStatut,
        utilisateurId: t.auteurId,
        note: t.noteHistorique,
      },
    });

    // La note du livreur va dans un commentaire de colis, et non dans
    // `motifRetour` : ce champ porte un motif d'une liste FERMÉE
    // (MOTIFS_REPORT_LIVREUR, lib/types.ts), et y verser du texte libre venu
    // d'un tiers casserait les écrans qui le lisent comme une valeur connue.
    if (t.commentaire) {
      await tx.commentaireCommande.create({
        data: {
          commandeId: commande.id,
          utilisateurId: t.auteurId,
          texte: t.commentaire,
        },
      });
    }

    return 'applique';
  });
}

function noteHistorique(plateformeCode: string, entree: EntreeStatut): string {
  const base = `${entree.statut.libelle} — déclaré par ${plateformeCode}`;
  if (!entree.date) return base;
  return `${base} — prochaine tentative le ${entree.date.toLocaleDateString('fr-FR')}`;
}

// --- Lot --------------------------------------------------------------------

// Le lot n'est VOLONTAIREMENT pas atomique : trente colis rentrent d'une
// tournée, un seul porte un code erroné, et refuser les vingt-neuf autres
// obligerait le partenaire à trouver la ligne fautive avant de pouvoir
// déclarer quoi que ce soit — donc à retarder de vraies livraisons pour une
// faute de frappe. Chaque ligne est traitée pour elle-même, et la réponse dit
// exactement laquelle est passée.
export async function appliquerLotStatuts(
  contexte: ContextePlateforme,
  perimetre: PerimetreTransporteur,
  lignes: unknown[]
): Promise<ResultatLotStatuts> {
  const resultats: (ResultatStatut | LigneRefusee)[] = [];
  let totalTraite = 0;
  let totalRefuse = 0;

  for (const ligne of lignes) {
    let codeSuivi: string | null = null;
    try {
      const entree = analyserEntreeStatut(ligne);
      codeSuivi = entree.codeSuivi;
      resultats.push(await appliquerStatut(contexte, perimetre, entree));
      totalTraite += 1;
    } catch (error) {
      totalRefuse += 1;
      resultats.push({
        issue: 'refuse',
        codeSuivi,
        code: error instanceof ErreurPlateforme ? error.code : 'erreur_interne',
        message: error instanceof ErreurPlateforme ? error.message : 'Erreur interne du serveur',
      });
      // Une erreur inattendue sur une ligne ne doit pas passer inaperçue sous
      // couvert de résilience : elle est renvoyée au partenaire en termes
      // neutres, mais tracée en clair de notre côté.
      if (!(error instanceof ErreurPlateforme)) console.error(error);
    }
  }

  return { totalTraite, totalRefuse, resultats };
}
