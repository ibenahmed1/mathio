import { BookOpen, LayoutDashboard, Package, Send, Share2, Wallet, Undo2 } from 'lucide-react';
import type { NavItem } from '@/components/AppSidebar';

// § Module Espace Livreur : les sections du menu (cf. spec module livreur),
// une sidebar desktop comme admin/marchand plutôt que la coquille mobile à 2
// onglets qu'utilisaient auparavant /livreur/tournee et /livreur/caisse.
//
// Le découpage en `section` suit celui du back-office (§ components/admin/nav.ts) :
// la barre est désormais littéralement la même (AdminSidebar), et sept entrées
// à plat y perdaient le peu de hiérarchie que le métier porte — ce que le
// livreur fait sur le terrain, les documents qu'il transporte, ce qu'il gagne.
const SECTION_TOURNEE = 'Ma tournée';
const SECTION_DOCUMENTS = 'Documents de transport';
const SECTION_FINANCE = 'Finance';
const SECTION_RESSOURCES = 'Ressources';

export const NAV_LIVREUR: NavItem[] = [
  { label: 'Accueil', href: '/livreur', icon: LayoutDashboard },
  { label: 'Colis', href: '/livreur/colis', icon: Package, section: SECTION_TOURNEE },
  { label: 'Bons de distribution', href: '/livreur/bons-distribution', icon: Share2, section: SECTION_TOURNEE },
  { label: "Bons d'envoi", href: '/livreur/bons-envoi', icon: Send, section: SECTION_DOCUMENTS },
  { label: 'Bon de retour', href: '/livreur/bons-retour', icon: Undo2, section: SECTION_DOCUMENTS },
  { label: 'Bons de paiement', href: '/livreur/bons-paiement', icon: Wallet, section: SECTION_FINANCE },
  { label: 'Documentation API', href: '/livreur/documentation-api', icon: BookOpen, section: SECTION_RESSOURCES },
];
