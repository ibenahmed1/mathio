import SimulateurRentabilite from '@/components/simulateur/SimulateurRentabilite';

export const metadata = { title: 'Simulateur de rentabilité — Mathio Delivery' };

// § Simulateur de rentabilité — le même écran que /marchand/simulateur. L'accès
// est gardé par le proxy (`simulateur:use`, lib/permission-routes.ts) ; l'écran
// ne lit aucune donnée, il n'y a donc rien d'autre à vérifier ici.
export default function SimulateurAdminPage() {
  return <SimulateurRentabilite />;
}
