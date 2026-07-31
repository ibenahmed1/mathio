import { LayoutDashboard, Package, Boxes, FileStack, Truck, LifeBuoy } from 'lucide-react';
import type { NavItem } from '@/components/AppSidebar';

// Navigation plate : le détail (sous-listes, filtres, actions) vit dans des
// onglets en haut de page (voir PageTabs), pas dans la sidebar — ça évite les
// sous-menus à déplier. Les destinations liées à la marchandise (colis,
// catalogue produits, ramassages, documents) sont regroupées sous la section
// "Marchandise", isolée visuellement du Dashboard et du Support.
//
// Séparée en deux groupes ("Menu" / "Autre") pour la sidebar refondue
// (MarchandSidebar) : Dashboard + Marchandise vivent sous "Menu", Support &
// Profil sous "Autre" (avec la Déconnexion, ajoutée directement par le
// composant).
export const NAV_MARCHAND_MENU: NavItem[] = [
  { label: 'Dashboard', href: '/marchand', icon: LayoutDashboard },
  { label: 'Colis', href: '/marchand/colis', icon: Package, section: 'Marchandise' },
  { label: 'Marchandises', href: '/marchand/colis/marchandises', icon: Boxes, section: 'Marchandise' },
  { label: 'Ramassages', href: '/marchand/ramassages', icon: Truck, section: 'Marchandise' },
  { label: 'Bons & Documents', href: '/marchand/bons-livraison', icon: FileStack, section: 'Marchandise' },
];

export const NAV_MARCHAND_AUTRE: NavItem[] = [
  { label: 'Support & Profil', href: '/marchand/reclamations', icon: LifeBuoy },
];

export const NAV_MARCHAND: NavItem[] = [...NAV_MARCHAND_MENU, ...NAV_MARCHAND_AUTRE];
