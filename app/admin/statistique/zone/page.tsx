import { MapPin } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function StatistiqueZonePage() {
  return (
    <ComingSoon
      icon={MapPin}
      title="Statistiques par zone"
      description="Analyse des volumes par zone de livraison : bientôt disponible."
    />
  );
}
