import type { StatutCommande, EtatPaiement, StatutReclamation } from '@/app/generated/prisma/enums';

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
  'en_retour_par_amana',
  'annule',
  'annule_par_vendeur',
];

export const LABELS_STATUT_COMMANDE: Record<StatutCommande, string> = {
  nouveau_colis: 'Nouveau Colis',
  attente_de_ramassage: 'Attente De Ramassage',
  ramasse: 'Ramassé',
  recu: 'Reçu',
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
  en_retour_par_amana: 'En retour par AMANA',
  annule: 'Annulé',
  annule_par_vendeur: 'Annulé par Vendeur',
};

export const STATUTS_TERMINAUX: StatutCommande[] = ['livre', 'retourne', 'annule', 'annule_par_vendeur'];

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

export const ETATS_PAIEMENT: EtatPaiement[] = ['non_paye', 'facture', 'paye', 'rembourse'];

export const LABELS_ETAT_PAIEMENT: Record<EtatPaiement, string> = {
  non_paye: 'Non payé',
  facture: 'Facturé',
  paye: 'Payé',
  rembourse: 'Remboursé',
};

export const STATUTS_RECLAMATION: StatutReclamation[] = ['ouverte', 'en_cours', 'resolue', 'rejetee'];

export const LABELS_STATUT_RECLAMATION: Record<StatutReclamation, string> = {
  ouverte: 'Ouverte',
  en_cours: 'En cours',
  resolue: 'Résolue',
  rejetee: 'Rejetée',
};
