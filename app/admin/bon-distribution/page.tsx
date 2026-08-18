import { BonDistributionListe } from '@/components/bon-distribution/BonDistributionListe';

// § /admin/bon-distribution : le module est rendu par le composant partagé
// (cf. components/bon-distribution/), identique à celui servi dans la web app
// Planner sous /planner/bons-distribution — seul le prefixe des liens change.
export default function AdminBonDistributionPage() {
  return <BonDistributionListe basePath="/admin/bon-distribution" />;
}
