import { Send } from 'lucide-react';
import { ComingSoon } from '@/components/ComingSoon';

// L'entrée « Bons d'envoi » figure dans la navigation du livreur (§
// components/livreur/nav.ts) depuis l'ouverture de l'espace, mais aucune page
// ne répondait à ce chemin : le menu renvoyait un 404 en plein visage. Tant
// que l'écran n'existe pas, il le dit — comme le fait déjà /admin/depenses.
export default function BonsEnvoiLivreurPage() {
  return (
    <ComingSoon
      icon={Send}
      title="Bons d'envoi"
      description="Les bons d'envoi que vous transportez vers un autre hub ou un prestataire seront consultables ici. En attendant, le document papier fait foi."
    />
  );
}
