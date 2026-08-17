import { Truck } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function BonPaiementLivreurPage() {
  return (
    <ComingSoon
      icon={Truck}
      title="Bon de paiement — Pour livreur"
      description="Le règlement des livreurs sera disponible prochainement."
    />
  );
}
