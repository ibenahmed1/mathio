import { BonRetourCreer } from '@/components/bon-retour/BonRetourCreer';

// § Web app Planner : même wizard que côté admin. L'étape 1 se franchit
// d'elle-même — GET /api/bons-retour/zones ne lui renvoie que son hub de
// rattachement (resolveUserHub), et le composant saute une étape qui n'aurait
// qu'une seule carte à cliquer.
export default function PlannerBonsRetourPage() {
  return <BonRetourCreer />;
}
