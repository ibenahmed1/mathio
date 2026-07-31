import { Send } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function BonEnvoiPage() {
  return (
    <ComingSoon
      icon={Send}
      title="Bon d'envoi"
      description="La génération des bons d'envoi sera disponible prochainement."
    />
  );
}
