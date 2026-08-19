import { LayoutDashboard, ScanLine, Share2 } from 'lucide-react';
import type { NavItem } from '@/components/AppSidebar';

// § Web app Planner (/planner) : le Planner n'a plus à emprunter le
// back-office pour travailler — son espace applicatif dédié tient en trois
// écrans, qui couvrent exactement son périmètre métier (planifier les
// tournées de SON hub, scanner au quai, décharger au retour). Toute route
// hors de ces trois branches lui est fermée par proxy.ts.
export const NAV_PLANNER: NavItem[] = [
  { label: 'Accueil', href: '/planner', icon: LayoutDashboard },
  { label: 'Bons de distribution', href: '/planner/bons-distribution', icon: Share2 },
  { label: 'Scanner', href: '/planner/scan', icon: ScanLine },
];
