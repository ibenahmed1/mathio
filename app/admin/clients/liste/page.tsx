import { Users } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

export default function ListeClientsPage() {
  return (
    <ComingSoon
      icon={Users}
      title="Liste clients"
      description="La gestion d'un carnet de clients sera disponible prochainement."
    />
  );
}
