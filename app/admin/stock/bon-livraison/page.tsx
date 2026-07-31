import { FileText } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function StockBonLivraisonPage() {
  return (
    <ComingSoon
      icon={FileText}
      title="Bon de livraison stock"
      description="Génération de bons de livraison de stock : bientôt disponible."
    />
  );
}
