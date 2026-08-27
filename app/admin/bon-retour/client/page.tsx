import { BonRetourCreer } from '@/components/bon-retour/BonRetourCreer';

// Entrée « par client » : par marchand destinataire, quand on prépare une
// restitution précise annoncée à l'avance. Même axe de filtre que « par zone »
// — les deux entrées restent distinctes dans la navigation parce qu'elles
// répondent à deux questions différentes de l'opérateur.
export default function BonRetourClientPage() {
  return <BonRetourCreer />;
}
