import type { StatutMarchand } from '@/app/generated/prisma/enums';

// § Inscription marchand progressive.
//
// Le formulaire d'inscription ne demande plus que l'essentiel (email, mot de
// passe, nom de boutique) : un marchand entre dans son espace tout de suite,
// saisit ses colis et invite son équipe sans attendre. Tout ce qui n'a de sens
// qu'au moment de FAIRE CIRCULER de la marchandise ou de l'ARGENT — bons,
// ramassages, factures — reste verrouillé tant que le dossier est incomplet.
//
// Ce module tient la règle, et rien d'autre : pas d'accès base, pas d'import
// `next/*`. Il est la source unique des deux verrous, lus à la fois par les
// routes/Server Actions (qui refusent) et par l'espace marchand (qui floute et
// explique). Les deux ne doivent jamais diverger : un écran flouté dont l'API
// répondrait quand même serait un faux verrou, l'inverse une impasse muette.

// Les champs retirés du formulaire d'inscription, donc ceux qu'il reste à
// fournir. Deliberément limité à ce qui est INDISPENSABLE pour opérer :
//
//  - téléphone : on appelle le marchand quand un ramassage tourne mal ;
//  - CIN, ville, adresse : on va chercher la marchandise chez lui ;
//  - RIB + justificatif : on lui reverse le COD encaissé. Sans eux, un bon de
//    paiement n'a aucune destination.
//
// Restent facultatifs, et ne bloquent donc rien : site web, banque, registre
// de commerce, ville de ramassage, raison sociale, ICE/RC.
export type ChampProfilMarchand = 'telephone' | 'cin' | 'ville' | 'adresse' | 'rib' | 'ribPhotoUrl';

export const CHAMPS_A_FINALISER: readonly ChampProfilMarchand[] = [
  'telephone',
  'cin',
  'ville',
  'adresse',
  'rib',
  'ribPhotoUrl',
] as const;

export const LABELS_CHAMP_PROFIL: Record<ChampProfilMarchand, string> = {
  telephone: 'Numéro de téléphone',
  cin: 'CIN',
  ville: 'Ville',
  adresse: 'Adresse',
  rib: 'RIB',
  ribPhotoUrl: 'Justificatif RIB',
};

// Le téléphone vit sur Utilisateur (identifiant de connexion du titulaire),
// les cinq autres sur Marchand : cette forme aplatie évite aux appelants de
// reconstruire la jointure à chaque fois.
export interface ProfilMarchandAFinaliser {
  telephone: string | null;
  cin: string | null;
  ville: string | null;
  adresse: string | null;
  rib: string | null;
  ribPhotoUrl: string | null;
}

// Ce qui empêche le marchand d'opérer, du plus actionnable au moins : un
// dossier incomplet est de son ressort et s'affiche en premier ; l'attente de
// validation ne dépend que de nous ; la suspension est une décision prise
// contre lui, qu'il ne lève pas depuis son espace.
export type BlocageMarchand = 'compte_suspendu' | 'profil_incomplet' | 'validation_en_attente';

export interface EtatActivationMarchand {
  profilComplet: boolean;
  champsManquants: ChampProfilMarchand[];
  // null quand le marchand opère normalement.
  blocage: BlocageMarchand | null;
  operationnel: boolean;
}

// Une chaîne d'espaces n'est pas une information : on la traite comme absente,
// sinon un champ « rempli » avec une espace lèverait le verrou pour rien.
function renseigne(valeur: string | null | undefined): boolean {
  return typeof valeur === 'string' && valeur.trim().length > 0;
}

export function champsProfilManquants(profil: ProfilMarchandAFinaliser): ChampProfilMarchand[] {
  return CHAMPS_A_FINALISER.filter((champ) => !renseigne(profil[champ]));
}

// Les DEUX verrous, dans l'ordre : le marchand remplit son dossier, puis
// l'admin approuve (RF-22 — l'approbation n'a pas disparu, elle ne bloque
// simplement plus la connexion).
export function etatActivationMarchand(entree: {
  profil: ProfilMarchandAFinaliser;
  statut: StatutMarchand;
}): EtatActivationMarchand {
  const champsManquants = champsProfilManquants(entree.profil);
  const profilComplet = champsManquants.length === 0;

  let blocage: BlocageMarchand | null = null;
  if (entree.statut === 'suspendu') {
    blocage = 'compte_suspendu';
  } else if (!profilComplet) {
    blocage = 'profil_incomplet';
  } else if (entree.statut !== 'actif') {
    blocage = 'validation_en_attente';
  }

  return { profilComplet, champsManquants, blocage, operationnel: blocage === null };
}

// Les fonctions tenues derrière ces verrous, nommées comme le marchand les
// voit dans sa barre latérale — le message d'erreur d'une API et le panneau
// d'un écran flouté doivent raconter la même chose.
export const FONCTIONS_VERROUILLEES = ['Bons & Documents', 'Ramassages', 'Factures'] as const;

// Le motif du blocage en une phrase, sans la liste des champs : l'écran
// verrouillé affiche celle-ci séparément (en pastilles), l'API la colle à la
// suite. Une seule formulation pour les deux — le marchand ne doit pas lire
// deux explications différentes du même refus.
export const RESUME_BLOCAGE: Record<BlocageMarchand, string> = {
  compte_suspendu: 'Votre compte est suspendu. Contactez le support pour le réactiver.',
  profil_incomplet: 'Finalisez votre inscription pour accéder à cette fonctionnalité.',
  validation_en_attente:
    "Votre dossier est complet et en cours de validation par nos équipes. Cette fonctionnalité s'ouvrira dès l'approbation.",
};

// Message complet, servi tel quel dans le 403 des routes verrouillées : il
// nomme ce qui manque, parce que c'est la seule information qui permette au
// marchand d'agir.
export function messageBlocage(etat: EtatActivationMarchand): string {
  if (etat.blocage === null) return '';
  const resume = RESUME_BLOCAGE[etat.blocage];
  // La liste des champs n'a de sens que quand c'est elle qui bloque : la
  // servir à un compte suspendu l'enverrait remplir un formulaire qui ne
  // débloquera rien.
  if (etat.blocage !== 'profil_incomplet') return resume;
  const manquants = etat.champsManquants.map((champ) => LABELS_CHAMP_PROFIL[champ]).join(', ');
  return `${resume} Champs à compléter : ${manquants}.`;
}
