import { LayoutDashboard, Package, Send, Share2, Wallet, Undo2 } from 'lucide-react';
import type { NavItem } from '@/components/AppSidebar';

// § Module Espace Livreur : les 6 sections du menu (cf. spec module livreur),
// une sidebar desktop comme admin/marchand plutôt que la coquille mobile à 2
// onglets qu'utilisaient auparavant /livreur/tournee et /livreur/caisse.
export const NAV_LIVREUR: NavItem[] = [
  { label: 'Accueil', href: '/livreur', icon: LayoutDashboard },
  { label: 'Colis', href: '/livreur/colis', icon: Package },
  { label: "Bons d'envoi", href: '/livreur/bons-envoi', icon: Send },
  { label: 'Bons de distribution', href: '/livreur/bons-distribution', icon: Share2 },
  { label: 'Bons de paiement', href: '/livreur/bons-paiement', icon: Wallet },
  { label: 'Bon de retour', href: '/livreur/bons-retour', icon: Undo2 },
];
