import { BonPaiementBoard } from '@/components/BonPaiementBoard';

// Entrée « par zone » : le hub est choisi d'abord et filtre la liste des
// livreurs. Le bon produit reste nominatif — cf. BonPaiementBoard.
export default function BonPaiementZonePage() {
  return <BonPaiementBoard parZone />;
}
