import { User } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function BonRetourClientPage() {
  return (
    <ComingSoon
      icon={User}
      title="Bon de retour — Pour client"
      description="La gestion des retours par client sera disponible prochainement."
    />
  );
}
