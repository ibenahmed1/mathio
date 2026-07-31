import { Undo2 } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';
import { BonsDocumentsSubNav } from '../BonsDocumentsSubNav';

export default function BonsRetourPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Bons & Documents</h1>
      <BonsDocumentsSubNav />
      <ComingSoon
        icon={Undo2}
        title="Bons de retour"
        description="La gestion des bons de retour sera disponible prochainement."
      />
    </div>
  );
}
