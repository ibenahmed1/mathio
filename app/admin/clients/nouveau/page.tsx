import { UserPlus } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function NouveauClientPage() {
  return (
    <ComingSoon
      icon={UserPlus}
      title="Nouveau client"
      description="La création de fiches client sera disponible prochainement."
    />
  );
}
