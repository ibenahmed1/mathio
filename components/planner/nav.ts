import { LayoutDashboard, ScanLine, Share2, Undo2 } from 'lucide-react';
import type { NavItem } from '@/components/AppSidebar';

// § Web app Planner (/planner) : le Planner n'a plus à emprunter le
// back-office pour travailler — son espace applicatif dédié couvre exactement
// son périmètre métier (planifier les tournées de SON hub, scanner au quai,
// décharger au retour, et composer les bons de retour des colis en échec qui
// dorment sur son quai). Toute route hors de ces branches lui est fermée par
// proxy.ts.
export const NAV_PLANNER: NavItem[] = [
  { label: 'Accueil', href: '/planner', icon: LayoutDashboard },
  { label: 'Bons de distribution', href: '/planner/bons-distribution', icon: Share2 },
  { label: 'Bons de retour', href: '/planner/bons-retour', icon: Undo2 },
  { label: 'Scanner', href: '/planner/scan', icon: ScanLine },
];
