import { BonRetourCreer } from '@/components/bon-retour/BonRetourCreer';

// Entrée « par livreur » : les puces de filtre de l'étape 3 trient les colis
// restituables par le livreur qui les a rapportés — l'angle qui sert quand on
// vide un véhicule. Le bon produit reste groupé par marchand.
export default function BonRetourLivreurPage() {
  return <BonRetourCreer axe="livreur" />;
}
