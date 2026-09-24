import { Undo2 } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

// Même cas que /livreur/bons-envoi : l'entrée existait dans le menu, la page
// non. Les bons de retour « pour livreur » se gèrent aujourd'hui côté
// back-office (§ /admin/bon-retour/livreur).
export default function BonsRetourLivreurPage() {
  return (
    <ComingSoon
      icon={Undo2}
      title="Bon de retour"
      description="Les colis que vous rapportez au dépôt seront regroupés ici en bon de retour. Ils sont pour l'instant enregistrés par le Planner au moment de la clôture de votre tournée."
    />
  );
}
