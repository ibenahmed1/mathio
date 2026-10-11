import type { StatutCommande } from '@/app/generated/prisma/enums';

// § Statut PUBLIC d'un colis — ce que voit un partenaire (GET /v1/colis).
//
// Projection de nos 31 statuts internes sur un vocabulaire FERMÉ et STABLE,
// celui de API_PARTENAIRES.md §5.3 : un partenaire branche son code sur ces
// valeurs, jamais sur nos libellés, et nos statuts internes peuvent évoluer
// sans casser son intégration. Le `Record<StatutCommande, …>` est un garde-fou
// de compilation : ajouter un statut interne sans décider de sa projection ne
// compile pas.
//
// Ce qui n'est PAS exposé, délibérément : le rang d'un appel (2e, 3e…), le
// transporteur, nos hubs. Le motif (`motif`) dit pourquoi une tentative a
// échoué ou pourquoi le colis attend, quand c'est utile au partenaire.
//
// Module PUR : lisible par les routes comme par les tests.

export const STATUTS_PUBLICS = [
  'created',
  'picked_up',
  'at_facility',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'attempt_failed',
  'on_hold',
  'returning',
  'returned',
  'cancelled',
] as const;
export type StatutPublic = (typeof STATUTS_PUBLICS)[number];

export interface ProjectionPublique {
  statut: StatutPublic;
  motif: string | null;
}

export const STATUT_INTERNE_VERS_PUBLIC: Record<StatutCommande, ProjectionPublique> = {
  nouveau_colis: { statut: 'created', motif: 'registered' },
  attente_de_ramassage: { statut: 'created', motif: 'awaiting_pickup' },
  ramasse: { statut: 'picked_up', motif: null },
  recu: { statut: 'at_facility', motif: null },
  pret_pour_preparation: { statut: 'at_facility', motif: 'awaiting_preparation' },
  recu_au_hub: { statut: 'at_facility', motif: null },
  en_transit: { statut: 'in_transit', motif: null },
  expedie: { statut: 'in_transit', motif: null },
  expedier_par_amana: { statut: 'in_transit', motif: 'handed_to_carrier' },
  en_voyage: { statut: 'in_transit', motif: null },
  mise_en_distribution: { statut: 'out_for_delivery', motif: null },
  livre: { statut: 'delivered', motif: null },
  en_cours: { statut: 'on_hold', motif: 'processing' },
  boite_vocale: { statut: 'attempt_failed', motif: 'voicemail' },
  deuxieme_appel_pas_reponse: { statut: 'attempt_failed', motif: 'no_answer' },
  troisieme_appel_pas_reponse: { statut: 'attempt_failed', motif: 'no_answer' },
  pas_de_reponse_sms: { statut: 'attempt_failed', motif: 'no_answer' },
  injoignable: { statut: 'attempt_failed', motif: 'unreachable' },
  numero_errone: { statut: 'attempt_failed', motif: 'wrong_number' },
  client_interesse: { statut: 'on_hold', motif: 'awaiting_customer' },
  relance_nouveau_client: { statut: 'on_hold', motif: 'awaiting_customer' },
  attente_de_relancer: { statut: 'on_hold', motif: 'awaiting_customer' },
  programme: { statut: 'on_hold', motif: 'scheduled' },
  reporte: { statut: 'attempt_failed', motif: 'rescheduled' },
  hors_zone: { statut: 'attempt_failed', motif: 'out_of_area' },
  refuse: { statut: 'attempt_failed', motif: 'refused_by_recipient' },
  retourne_au_hub: { statut: 'at_facility', motif: 'back_at_facility' },
  retourne: { statut: 'returned', motif: null },
  en_retour_par_amana: { statut: 'returning', motif: 'carrier_return' },
  annule: { statut: 'cancelled', motif: 'cancelled_by_carrier' },
  annule_par_vendeur: { statut: 'cancelled', motif: 'cancelled_by_shipper' },
};

export function statutPublic(statut: StatutCommande): ProjectionPublique {
  return STATUT_INTERNE_VERS_PUBLIC[statut];
}
