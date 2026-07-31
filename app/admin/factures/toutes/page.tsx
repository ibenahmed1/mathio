import { Receipt } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function ToutesFacturesPage() {
  return (
    <ComingSoon
      icon={Receipt}
      title="Toutes les factures"
      description="La facturation sera disponible prochainement."
    />
  );
}
