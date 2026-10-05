import SimulateurRentabilite from '@/components/simulateur/SimulateurRentabilite';

export const metadata = { title: 'Simulateur de rentabilité' };

// § Simulateur de rentabilité — le même écran que /admin/simulateur, gardé par
// `simulateur.utiliser` (PAGES_MARCHAND). Pas de verrou d'activation
// (VerrouProfil) : le calcul ne dépend d'aucune validation du dossier.
export default function SimulateurMarchandPage() {
  return <SimulateurRentabilite />;
}
