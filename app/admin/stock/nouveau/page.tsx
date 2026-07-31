import { PackageSearch } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function StockNouveauPage() {
  return (
    <ComingSoon
      icon={PackageSearch}
      title="Nouveau colis préparation"
      description="Préparation de colis en stock : bientôt disponible."
    />
  );
}
