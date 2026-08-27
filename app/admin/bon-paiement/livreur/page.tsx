import { BonPaiementBoard } from '@/components/BonPaiementBoard';

// Entrée « par livreur » : tous les livreurs ayant un solde, tous hubs
// confondus. Cf. BonPaiementBoard pour la logique partagée avec /zone.
export default function BonPaiementLivreurPage() {
  return <BonPaiementBoard parZone={false} />;
}
