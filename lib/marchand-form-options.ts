import type { TypeCompteMarchand } from '@/app/generated/prisma/enums';

// Listes partagées entre le formulaire d'inscription marchand (client) et sa
// validation côté API — évite que les deux divergent sur les valeurs acceptées.

export const VILLES_RAMASSAGE = [
  'Casablanca',
  'Rabat',
  'Fes',
  'Marrakech',
  'Tanger',
  'Agadir',
  'Meknes',
  'Oujda',
  'Kenitra',
  'Tetouan',
  'Safi',
  'El Jadida',
  'Nador',
  'Settat',
  'Beni Mellal',
];

export const BANQUES_MAROC = [
  'Attijariwafa Bank',
  'Banque Populaire',
  'Bank of Africa (BMCE)',
  'BMCI',
  'Société Générale Maroc',
  'Crédit Agricole du Maroc',
  'CIH Bank',
  'Al Barid Bank',
  'CFG Bank',
  'Crédit du Maroc',
  'Bank Al Yousr',
  'Umnia Bank',
  'Bank Assafa',
];

export const LABELS_TYPE_COMPTE: Record<TypeCompteMarchand, string> = {
  marchand: 'Marchand',
  entreprise: 'Entreprise',
  dropshipping: 'Dropshipping',
};

export const TYPES_COMPTE: TypeCompteMarchand[] = ['marchand', 'entreprise', 'dropshipping'];
