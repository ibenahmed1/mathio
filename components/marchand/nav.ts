import { LayoutDashboard, Package, Boxes, FileStack, Truck, LifeBuoy, Warehouse, Plug, UsersRound } from 'lucide-react';
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
  { label: 'Gestion Inventaire', href: '/marchand/inventaire', icon: Warehouse, section: 'Marchandise' },
];

export const NAV_MARCHAND_AUTRE: NavItem[] = [
  { label: 'Support & Profil', href: '/marchand/reclamations', icon: LifeBuoy },
  // § Équipe & accès : membres, rôles et journal de l'équipe de la boutique.
  { label: 'Équipe & accès', href: '/marchand/equipe', icon: UsersRound },
  // § Intégrations Shopify et YouCan : le marchand y connecte lui-même sa boutique.
  { label: 'Intégrations', href: '/marchand/integrations', icon: Plug },
];

export const NAV_MARCHAND: NavItem[] = [...NAV_MARCHAND_MENU, ...NAV_MARCHAND_AUTRE];

// § Inscription progressive : les destinations fermées tant que le dossier du
// marchand n'est pas complet ET validé. La barre latérale y pose un cadenas —
// l'entrée reste cliquable, et l'écran explique alors ce qu'il manque
// (VerrouProfil). Masquer ces entrées serait plus propre à l'œil et pire à
// l'usage : le marchand ne saurait pas qu'elles existent, ni pourquoi il les
// débloquerait.
//
// La liste doit rester le miroir exact des sections portant un layout
// verrouillé (app/marchand/<section>/layout.tsx) : la barre latérale s'en sert
// pour le cadenas (correspondance exacte du href), et le bandeau de rappel
// pour savoir sur quels écrans se taire (préfixe) — y compris ceux qui n'ont
// pas d'entrée propre dans la barre, comme les factures et les bons de retour.
export const CHEMINS_VERROUILLES: string[] = [
  '/marchand/ramassages',
  '/marchand/bons-livraison',
  '/marchand/bons-retour',
  '/marchand/factures',
];

// § Équipe & accès : la navigation réduite aux modules ouverts au rôle du
// membre connecté (le titulaire voit tout). `peutOuvrir` est celui de
// usePermissionsMarchand, lu dans la même table que le proxy.
//
// « Support & Profil » pointe sur les réclamations : un membre qui n'y a pas
// droit garde l'entrée, redirigée vers le profil — c'est là qu'il retrouve
// ses informations de boutique.
export function navMarchandFiltree(items: NavItem[], peutOuvrir: (href: string) => boolean): NavItem[] {
  return items.flatMap<NavItem>((item) => {
    if (!('href' in item)) return [item];
    if (peutOuvrir(item.href)) return [item];
    if (item.href === '/marchand/reclamations') return [{ ...item, href: '/marchand/profil' }];
    // Même logique pour « Bons & Documents » : un rôle qui n'ouvre que les
    // factures y accède quand même.
    if (item.href === '/marchand/bons-livraison' && peutOuvrir('/marchand/factures')) {
      return [{ ...item, href: '/marchand/factures' }];
    }
    return [];
  });
}
