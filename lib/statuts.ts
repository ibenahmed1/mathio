import type {
  StatutCommande,
  EtatPaiement,
  StatutReclamation,
  StatutTache,
  PrioriteTache,
  StatutBonDistribution,
} from '@/app/generated/prisma/enums';

// Source unique pour l'ordre et le libellé des statuts colis / état de
// paiement — évite que chaque page (admin, marchand, badges, validation API)
// redéclare sa propre liste/union avec le risque de divergence.

// Cycle de vie façon centre d'appel / plateforme de livraison COD : ordre
// d'affichage = celui du menu "Status" de l'admin.
export const STATUTS_COMMANDE: StatutCommande[] = [
  'nouveau_colis',
  'attente_de_ramassage',
  'ramasse',
  'recu',
  'pret_pour_preparation',
  'recu_au_hub',
  'en_transit',
  'expedie',
  'expedier_par_amana',
  'en_voyage',
  'mise_en_distribution',
  'livre',
  'en_cours',
  'boite_vocale',
  'deuxieme_appel_pas_reponse',
  'troisieme_appel_pas_reponse',
  'pas_de_reponse_sms',
  'injoignable',
  'numero_errone',
  'client_interesse',
  'relance_nouveau_client',
  'attente_de_relancer',
  'programme',
  'reporte',
  'hors_zone',
  'refuse',
  'retourne',
  'retourne_au_hub',
  'en_retour_par_amana',
  'annule',
  'annule_par_vendeur',
];

export const LABELS_STATUT_COMMANDE: Record<StatutCommande, string> = {
  nouveau_colis: 'Nouveau Colis',
  attente_de_ramassage: 'Attente De Ramassage',
  ramasse: 'Ramassé',
  recu: 'Reçu',
  pret_pour_preparation: 'Prêt pour préparation',
  recu_au_hub: 'Reçu au Hub',
  en_transit: 'En transit',
  expedie: 'Expédié',
  expedier_par_amana: 'Expédier par AMANA',
  en_voyage: 'En Voyage',
  mise_en_distribution: 'Mise en distribution',
  livre: 'Livré',
  en_cours: 'En cours',
  boite_vocale: 'Boite Vocal',
  deuxieme_appel_pas_reponse: 'Deuxième Appel Pas Réponse',
  troisieme_appel_pas_reponse: 'Troisième Appel Pas Réponse',
  pas_de_reponse_sms: 'Pas de réponse + SMS',
  injoignable: 'Injoignable',
  numero_errone: 'Numero_Erroné',
  client_interesse: 'Client intéressé',
  relance_nouveau_client: 'Relancé nouveau client',
  attente_de_relancer: 'Attente de relancer',
  programme: 'Programmé',
  reporte: 'Reporté',
  hors_zone: 'Hors-zone',
  refuse: 'Refusé',
  retourne: 'Retourné',
  retourne_au_hub: 'Retourné au Hub',
  en_retour_par_amana: 'En retour par AMANA',
  annule: 'Annulé',
  annule_par_vendeur: 'Annulé par Vendeur',
};

export const STATUTS_TERMINAUX: StatutCommande[] = ['livre', 'retourne', 'annule', 'annule_par_vendeur'];

// § Bon de retour (/admin/bon-retour) : colis dont la livraison a
// définitivement échoué et qui sont PHYSIQUEMENT au hub, donc restituables au
// marchand. `retourne_au_hub` est le cas dominant — c'est le statut qu'un
// colis reçoit quand le Planner le scanne au retour d'une tournée. Les autres
// couvrent les colis fermés avant même d'être sortis en tournée.
//
// `retourne` n'y figure pas : c'est justement l'état d'ARRIVÉE du bon de
// retour (colis remis au marchand), pas un état d'entrée. Les motifs de
// relance en cours (injoignable, boîte vocale, deuxième appel…) n'y figurent
// pas non plus : le marchand peut encore les faire retenter, les basculer en
// retour reviendrait à trancher à sa place.
export const STATUTS_ELIGIBLES_RETOUR: StatutCommande[] = [
  'retourne_au_hub',
  'refuse',
  'hors_zone',
  'annule',
  'annule_par_vendeur',
];

// Sous-ensemble utilisé par l'action rapide admin "Colis non livré".
export const STATUTS_NON_LIVRAISON: StatutCommande[] = [
  'numero_errone',
  'injoignable',
  'hors_zone',
  'boite_vocale',
  'pas_de_reponse_sms',
  'refuse',
  'reporte',
];

// Statuts exposés au marchand sous "Colis à relancer" : tentatives de
// livraison en échec, hors colis déjà livrés ou en cours de retour — le
// marchand peut y corriger l'adresse puis relancer une nouvelle tentative.
export const STATUTS_A_RELANCER: StatutCommande[] = [
  ...STATUTS_NON_LIVRAISON,
  'deuxieme_appel_pas_reponse',
  'troisieme_appel_pas_reponse',
];

// Sous-ensemble "client injoignable" utilisé par la tuile dédiée du dashboard
// marchand — motifs d'échec de contact téléphonique uniquement, à l'exclusion
// des refus/zone/report qui ont une cause différente.
export const STATUTS_INJOIGNABLES: StatutCommande[] = [
  'injoignable',
  'boite_vocale',
  'pas_de_reponse_sms',
  'deuxieme_appel_pas_reponse',
  'troisieme_appel_pas_reponse',
  'numero_errone',
];

// Colis pas encore récupérés chez le marchand (avant ramassage effectif) —
// sert à dériver le taux de collecte du dashboard marchand.
export const STATUTS_AVANT_COLLECTE: StatutCommande[] = ['nouveau_colis', 'attente_de_ramassage'];

export const ETATS_PAIEMENT: EtatPaiement[] = ['non_paye', 'facture', 'paye', 'rembourse'];

export const LABELS_ETAT_PAIEMENT: Record<EtatPaiement, string> = {
  non_paye: 'Non payé',
  facture: 'Facturé',
  paye: 'Payé',
  rembourse: 'Remboursé',
};

// § Bon de Distribution / tournée (/admin/bon-distribution) : libellé et
// pastille de l'état du bon lui-même — source unique partagée par la liste,
// le détail et l'écran de clôture, qui affichaient jusqu'ici deux ternaires
// dupliqués incapables de rendre le nouvel état "cloture".
export const LABELS_STATUT_BON_DISTRIBUTION: Record<StatutBonDistribution, string> = {
  nouveau: 'Nouveau',
  en_cours: 'En cours',
  cloture: 'Clôturée',
};

export const STYLE_STATUT_BON_DISTRIBUTION: Record<StatutBonDistribution, string> = {
  nouveau: 'bg-amber-300 text-amber-950',
  en_cours: 'bg-cyan-400 text-cyan-950',
  cloture: 'bg-green-600 text-white',
};

export const STATUTS_RECLAMATION: StatutReclamation[] = ['ouverte', 'en_cours', 'resolue', 'rejetee'];

export const LABELS_STATUT_RECLAMATION: Record<StatutReclamation, string> = {
  ouverte: 'Ouverte',
  en_cours: 'En cours',
  resolue: 'Résolue',
  rejetee: 'Rejetée',
};

// Tableau Kanban interne (§ /admin/tasks) : ordre = ordre des colonnes.
export const STATUTS_TACHE: StatutTache[] = ['a_faire', 'en_cours', 'termine'];

export const LABELS_STATUT_TACHE: Record<StatutTache, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  termine: 'Terminé',
};

export const PRIORITES_TACHE: PrioriteTache[] = ['faible', 'moyenne', 'elevee'];

export const LABELS_PRIORITE_TACHE: Record<PrioriteTache, string> = {
  faible: 'Faible',
  moyenne: 'Moyenne',
  elevee: 'Élevée',
};

// Jetons visuels du Kanban Kadence (design_handoff_kanban) : pastille de
// statut de colonne et chip de priorité de carte, exprimés en classes
// `.kdc-dot--*` / `.kdc-prio--*` (voir board.css + .kdc-board dans
// app/globals.css) pour rester à l'identique de reference-board-light.html
// dans les deux thèmes.
export const STATUT_TACHE_DOT: Record<StatutTache, string> = {
  a_faire: 'kdc-dot--todo',
  en_cours: 'kdc-dot--doing',
  termine: 'kdc-dot--done',
};

export const PRIORITE_TACHE_CLASS: Record<PrioriteTache, string> = {
  faible: 'kdc-prio--basse',
  moyenne: 'kdc-prio--moyenne',
  elevee: 'kdc-prio--haute',
};

// Couleur de statut du Kanban : filet de tête de la carte et lavis de tête
// de colonne (cf. .kdc-card--* / .kdc-column--* dans board.css). Une carte
// qui change de colonne change de dégradé — c'est le repère qu'on lit de
// loin, avant le texte.
export const STATUT_TACHE_BARRE: Record<StatutTache, string> = {
  a_faire: 'kdc-card--todo',
  en_cours: 'kdc-card--doing',
  termine: 'kdc-card--done',
};

export const STATUT_TACHE_COLONNE: Record<StatutTache, string> = {
  a_faire: 'kdc-column--todo',
  en_cours: 'kdc-column--doing',
  termine: 'kdc-column--done',
};

// La clé de couleur d'équipe (EquipeTache.couleur, choisie librement à la
// création du pôle) est projetée sur les 6 chips "étiquette" du board Kadence
// — seules couleurs de chip définies par la maquette — plutôt que d'inventer
// une teinte hors charte.
export const EQUIPE_COULEUR_LABEL: Record<string, string> = {
  blue: 'design',
  violet: 'research',
  emerald: 'docs',
  orange: 'bug',
  sky: 'frontend',
  pink: 'backend',
  gray: 'docs',
};

export function labelClassName(labelKey: string): string {
  return `kdc-label--${labelKey}`;
}

// Étiquettes de tâche (Tache.etiquettes), reprises à l'identique des 6 chips
// du board Kadence (design_handoff_kanban) — indépendantes de l'équipe,
// affectées librement par tâche depuis la modale de détail.
export const ETIQUETTES_TACHE = ['design', 'frontend', 'backend', 'research', 'bug', 'docs'] as const;
export type EtiquetteTache = (typeof ETIQUETTES_TACHE)[number];

export const LABELS_ETIQUETTE_TACHE: Record<EtiquetteTache, string> = {
  design: 'Design',
  frontend: 'Frontend',
  backend: 'Backend',
  research: 'Research',
  bug: 'Bug',
  docs: 'Docs',
};

// Clé courte affichée sur la carte (KAD-118…), dérivée de Tache.numero
// (colonne Postgres SERIAL, unique et croissante) — jamais stockée en texte.
export function formatCleTache(numero: number): string {
  return `KAD-${100 + numero}`;
}
