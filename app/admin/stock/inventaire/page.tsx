import { Boxes } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function StockInventairePage() {
  return (
    <ComingSoon
      icon={Boxes}
      title="Inventory"
      description="Suivi de l'inventaire des produits en stock : bientôt disponible."
    />
  );
}
