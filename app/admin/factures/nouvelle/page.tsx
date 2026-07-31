import { FilePlus2 } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function NouvelleFacturePage() {
  return (
    <ComingSoon
      icon={FilePlus2}
      title="Nouvelle facture"
      description="La création de factures sera disponible prochainement."
    />
  );
}
