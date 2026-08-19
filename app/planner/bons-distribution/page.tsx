import { BonDistributionListe } from '@/components/bon-distribution/BonDistributionListe';

// § Web app Planner : même module que /admin/bon-distribution, rendu par le
// composant partagé (components/bon-distribution/) — la liste est déjà
// restreinte au hub du Planner côté serveur (scopeHubBonsDistribution).
export default function PlannerBonsDistributionPage() {
  return <BonDistributionListe basePath="/planner/bons-distribution" />;
}
