import { ApiError } from '@/lib/api-utils';
import { deciderTransitionStatut } from '@/lib/livraison-statut';
import type { Role, StatutCommande, TypeCompteLivreur } from '@/app/generated/prisma/enums';

// § Comptes livreurs — individu ou société de livraison (cf. TypeCompteLivreur
// dans prisma/schema.prisma).
//
// La règle vit ici et non dans les route handlers parce qu'elle est métier et
// qu'elle est appliquée à DEUX endroits (POST et PATCH /api/utilisateurs) :
// écrite deux fois, elle aurait divergé au premier ajustement, et un compte
// créé correctement aurait pu être corrompu par une modification.

export const TYPES_COMPTE_LIVREUR: TypeCompteLivreur[] = ['individuel', 'societe'];

// Type par défaut d'un compte livreur : la très grande majorité des comptes
// sont des personnes, et c'est aussi ce que la migration a posé sur les
// comptes existants (20260924_type_compte_livreur). Un appel qui ne dit rien
// obtient donc le cas courant, jamais un compte sans type.
export const TYPE_LIVREUR_DEFAUT: TypeCompteLivreur = 'individuel';

export interface IdentiteCompteLivreur {
  typeLivreur: TypeCompteLivreur | null;
  raisonSociale: string | null;
  ice: string | null;
}

function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim();
  return propre.length > 0 ? propre : null;
}

export function estTypeCompteLivreur(valeur: unknown): valeur is TypeCompteLivreur {
  return typeof valeur === 'string' && (TYPES_COMPTE_LIVREUR as string[]).includes(valeur);
}

// La CIN identifie une PERSONNE : l'exiger d'une société reviendrait à
// demander la carte d'identité de son gérant sous un autre nom, et à empêcher
// purement et simplement la création du compte. Elle reste obligatoire pour un
// ramasseur et pour un livreur individuel, comme avant ce module.
export function cinRequise(role: Role, typeLivreur: TypeCompteLivreur | null): boolean {
  if (role === 'ramasseur') return true;
  if (role === 'livreur') return typeLivreur !== 'societe';
  return false;
}

// Le hub de rattachement dit à quel quai un compte se présente le matin :
// l'agent y réceptionne, le planner y compose les tournées, le livreur y prend
// sa feuille de route. Une SOCIÉTÉ de livraison n'a pas de quai chez nous —
// on lui confie des colis par bon d'envoi, elle les emporte, elle ne revient
// pas. L'exiger d'elle reviendrait à lui inventer un rattachement, et à faire
// apparaître son nom dans les écrans filtrés par hub.
//
// Elle PEUT en avoir un (transporteur qui vient effectivement charger à un
// quai précis) : le champ reste proposé, il n'est simplement plus obligatoire.
export function hubRequis(role: Role, typeLivreur: TypeCompteLivreur | null): boolean {
  if (role === 'agent_hub' || role === 'planner') return true;
  if (role === 'livreur') return typeLivreur !== 'societe';
  return false;
}

const AUCUNE_IDENTITE: IdentiteCompteLivreur = { typeLivreur: null, raisonSociale: null, ice: null };

// Résout les trois champs d'identité à écrire en base, à partir du corps de la
// requête et du rôle FINAL du compte.
//
// `actuel` porte ce qui est déjà en base et sert aux modifications partielles
// (PATCH) : un corps qui ne parle pas du type ne doit pas faire retomber une
// société sur `individuel`, ni effacer sa raison sociale parce que la fenêtre
// n'envoyait que le numéro de téléphone. Champ absent = champ inchangé, comme
// partout ailleurs dans PATCH /api/utilisateurs. À la création, l'appelant ne
// le fournit pas et c'est TYPE_LIVREUR_DEFAUT qui s'applique.
export function analyserIdentiteLivreur(
  role: Role,
  corps: Record<string, unknown>,
  actuel: IdentiteCompteLivreur = AUCUNE_IDENTITE
): IdentiteCompteLivreur {
  // Tout autre rôle : les trois champs sont remis à null, et non simplement
  // laissés de côté. C'est ce qui nettoie un compte rétrogradé de livreur à
  // superviseur — sans quoi il garderait une raison sociale que plus aucun
  // écran n'afficherait, mais qu'un export irait chercher.
  if (role !== 'livreur') {
    return { typeLivreur: null, raisonSociale: null, ice: null };
  }

  const brut = corps.typeLivreur;
  let typeLivreur: TypeCompteLivreur;
  if (brut === undefined || brut === null || brut === '') {
    typeLivreur = actuel.typeLivreur ?? TYPE_LIVREUR_DEFAUT;
  } else if (estTypeCompteLivreur(brut)) {
    typeLivreur = brut;
  } else {
    throw new ApiError(400, `typeLivreur invalide. Valeurs possibles : ${TYPES_COMPTE_LIVREUR.join(', ')}`);
  }

  // Un compte individuel n'a pas d'identité d'entreprise. On l'efface au lieu
  // de la conserver : c'est le geste qui compte au moment où une société est
  // repassée en individu, et il doit être le même que le corps ait mentionné
  // ces champs ou non.
  if (typeLivreur === 'individuel') {
    return { typeLivreur, raisonSociale: null, ice: null };
  }

  // Société : raison sociale et ICE restent FACULTATIVES à ce stade (décision
  // du 24/09/2026, le module est en cours d'essai). Mieux vaut un compte créé
  // sans ses papiers qu'un compte impossible à créer — ils se complètent
  // ensuite depuis la même fenêtre.
  return {
    typeLivreur,
    raisonSociale: corps.raisonSociale === undefined ? actuel.raisonSociale : texteOuNull(corps.raisonSociale),
    ice: corps.ice === undefined ? actuel.ice : texteOuNull(corps.ice),
  };
}

// ============================================================
// § /livreur/colis — qui a le droit de déclarer quoi
// ============================================================

// D'où vient le colis qu'on veut déclarer, vu du compte qui le déclare :
//   tournee — bon de distribution ouvert, le cas du livreur interne ;
//   confie  — bon d'envoi PRIS EN CHARGE par la société dont ce compte est le
//             compte humain (§ Prestataire.compteLivreurId) ;
//   aucune  — le colis lui est bien affecté, mais ni par l'une ni par l'autre
//             (tournée déjà clôturée et bon d'envoi pas encore remis).
export type OrigineColisLivreur = 'tournee' | 'confie' | 'aucune';

export type DecisionActionColis =
  | { issue: 'autorise' }
  // Le colis porte déjà le statut demandé. Ni une erreur ni une écriture :
  // même réponse que l'API des prestataires sur un rejeu (§ deciderTransition).
  | { issue: 'inchange' }
  | { issue: 'refuse'; status: number; message: string };

export interface ContexteActionColis {
  livreurId: string | null;
  statut: StatutCommande;
  origine: OrigineColisLivreur;
  // Renseigné pour l'origine `tournee` uniquement — sert au message, qui doit
  // pouvoir nommer la tournée que le Planner a fermée.
  tourneeNumero: string | null;
}

// Décision PURE de l'accès d'un compte à un colis depuis l'application
// terrain. Deux origines, deux régimes, et c'est délibéré :
//
//   TOURNÉE — règle inchangée depuis l'ouverture de l'espace livreur : le
//     colis doit être en distribution, et la tournée pas encore déchargée.
//     Après la clôture, le colis relève du back-office.
//
//   CONFIÉ — la règle est celle de `deciderTransitionStatut`, c'est-à-dire
//     EXACTEMENT celle qu'applique déjà l'API des prestataires et celle des
//     webhooks transporteurs. Une société qui déclare depuis l'écran obtient
//     donc la même réponse que si elle avait appelé l'API : un colis clos est
//     refusé, un rejeu est sans effet. Une règle, trois portes — le jour où
//     elles divergeraient, le même colis aurait deux vérités selon le canal.
export function deciderActionColisLivreur(
  contexte: ContexteActionColis,
  sessionId: string,
  demande: StatutCommande
): DecisionActionColis {
  if (contexte.livreurId !== sessionId) {
    return { issue: 'refuse', status: 403, message: "Ce colis ne vous est pas confié" };
  }

  if (contexte.origine === 'aucune') {
    return {
      issue: 'refuse',
      status: 409,
      message: contexte.tourneeNumero
        ? `La tournée ${contexte.tourneeNumero} a été clôturée au dépôt : ce colis n'est plus modifiable depuis l'application livreur.`
        : "Ce colis ne vous a pas encore été remis : il n'est pas modifiable depuis l'application.",
    };
  }

  if (contexte.origine === 'tournee') {
    if (contexte.statut !== 'mise_en_distribution') {
      return { issue: 'refuse', status: 400, message: "Ce colis n'est pas en cours de distribution" };
    }
    return { issue: 'autorise' };
  }

  const transition = deciderTransitionStatut(contexte.statut, demande);
  if (transition.issue === 'refuse') {
    return { issue: 'refuse', status: 409, message: transition.message };
  }
  return transition.issue === 'inchange' ? { issue: 'inchange' } : { issue: 'autorise' };
}
