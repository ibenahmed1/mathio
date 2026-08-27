import { BonDistributionListe } from '@/components/bon-distribution/BonDistributionListe';

// § /admin/bon-distribution : le module est rendu par le composant partagé
// (cf. components/bon-distribution/), utilisé aussi bien par l'admin que par
// le planner — le second n'y voit que les tournées de son hub.
export default function AdminBonDistributionPage() {
  return <BonDistributionListe />;
}
