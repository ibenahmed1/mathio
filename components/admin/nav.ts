import {
  LayoutDashboard,
  Package,
  PackagePlus,
  ListOrdered,
  MapPinned,
  CheckCircle2,
  FileSpreadsheet,
  BarChart3,
  Users,
  Truck,
  MapPin,
  Building2,
  ArrowLeftRight,
  Boxes,
  PackageSearch,
  FileText,
  Send,
  Share2,
  Wallet,
  Undo2,
  User,
  Receipt,
  FilePlus2,
  MessageSquareWarning,
  ClipboardList,
  UserCog,
  Settings,
  Store,
  Columns3,
  Calculator,
  ScanLine,
} from 'lucide-react';
import type { NavItem } from '@/components/AppSidebar';
import type { Role } from '@/app/generated/prisma/enums';

// Navigation du back-office, filtrée par PERMISSION (§ lib/permissions.ts) et
// non plus par rôle.
//
// La clé portée par chaque item est EXACTEMENT celle que le proxy exige sur le
// chemin correspondant (§ lib/permission-routes.ts) : la barre latérale ne
// peut donc pas afficher un lien qui renverrait aussitôt un refus, et il n'y a
// plus qu'un seul tableau à tenir à jour au lieu des deux listes de rôles
// autrefois dupliquées ici et dans les routes.
//
// Ce module est chargé côté client : il ne doit importer ni lib/auth (qui
// entraînerait Prisma et next/headers) ni lib/permission-routes — seulement
// des chaînes.

export const NAV_ADMIN: NavItem[] = [
  { label: 'Accueil', href: '/admin', icon: LayoutDashboard, permission: 'dashboard:view' },
  {
    label: 'Colis',
    icon: Package,
    children: [
      { label: 'Nouveau', href: '/admin/colis/nouveau', icon: PackagePlus, permission: 'colis:create' },
      { label: 'Import Excel', href: '/admin/colis/import', icon: FileSpreadsheet, permission: 'colis:import' },
      { label: 'Liste', href: '/admin/commandes', icon: ListOrdered, permission: 'colis:read' },
      { label: 'Suivi', href: '/admin/colis/suivi', icon: MapPinned, permission: 'colis:track' },
      {
        label: 'Confirmation',
        href: '/admin/colis/confirmation',
        icon: CheckCircle2,
        permission: 'colis:confirm',
      },
    ],
  },
  {
    label: 'Statistique',
    icon: BarChart3,
    children: [
      { label: 'Tout', href: '/admin/statistique/tout', icon: BarChart3, permission: 'stats:all' },
      { label: 'Client', href: '/admin/statistique/client', icon: Users, permission: 'stats:client' },
      { label: 'Livreur', href: '/admin/statistique/livreur', icon: Truck, permission: 'stats:livreur' },
      { label: 'Zone', href: '/admin/statistique/zone', icon: MapPin, permission: 'stats:zone' },
      { label: 'Ville', href: '/admin/statistique/ville', icon: Building2, permission: 'stats:ville' },
      { label: 'Comparer', href: '/admin/statistique/comparer', icon: ArrowLeftRight, permission: 'stats:compare' },
    ],
  },
  {
    label: 'Gestion de stock',
    icon: Boxes,
    children: [
      {
        label: 'Nouveaux colis stock',
        href: '/admin/stock/nouveaux',
        icon: PackageSearch,
        permission: 'stock:nouveaux',
      },
      {
        label: 'Prêts pour préparation',
        href: '/admin/stock/prets',
        icon: CheckCircle2,
        permission: 'stock:prets',
      },
      {
        label: 'Bons de préparation',
        href: '/admin/stock/bons-preparation',
        icon: FileText,
        permission: 'stock:bons_preparation',
      },
      { label: 'Inventory', href: '/admin/stock/inventaire', icon: Boxes, permission: 'stock:inventory' },
    ],
  },
  { label: 'Bon de livraison', href: '/admin/bon-livraison', icon: FileText, permission: 'bon_livraison:manage' },
  { label: "Bon d'envoi", href: '/admin/bon-envoi', icon: Send, permission: 'bon_envoi:manage' },
  // § Planification des tournées — les trois écrans du Planner. L'admin voit
  // tous les hubs, le planner uniquement le sien : ce cantonnement-là est
  // affaire de DONNÉES (resolveHubPlanification, lib/bon-distribution.ts) et
  // reste entier, la permission ne gouverne que l'accès à l'écran.
  {
    label: 'Planification',
    href: '/admin/planification',
    icon: LayoutDashboard,
    permission: 'planification:manage',
  },
  {
    label: 'Bon de distribution',
    href: '/admin/bon-distribution',
    icon: Share2,
    permission: 'bon_distribution:manage',
  },
  { label: 'Scan Tournée', href: '/admin/scan/tournee', icon: ScanLine, permission: 'scan:tournee' },
  {
    label: 'Bon de paiement',
    icon: Wallet,
    children: [
      {
        label: 'Pour livreur',
        href: '/admin/bon-paiement/livreur',
        icon: Truck,
        permission: 'paiement_livreur:manage',
      },
      { label: 'Pour zone', href: '/admin/bon-paiement/zone', icon: MapPin, permission: 'paiement_zone:manage' },
    ],
  },
  // § Bon de retour : une seule clé pour les trois écrans, conformément au
  // catalogue (`bon_retour:manage`).
  {
    label: 'Bon de retour',
    icon: Undo2,
    children: [
      { label: 'Pour livreur', href: '/admin/bon-retour/livreur', icon: Truck, permission: 'bon_retour:manage' },
      { label: 'Pour zone', href: '/admin/bon-retour/zone', icon: MapPin, permission: 'bon_retour:manage' },
      { label: 'Pour client', href: '/admin/bon-retour/client', icon: User, permission: 'bon_retour:manage' },
    ],
  },
  {
    label: 'Facture',
    icon: Receipt,
    children: [
      { label: 'Nouvelle facture', href: '/admin/factures/nouvelle', icon: FilePlus2, permission: 'facture:create' },
      { label: 'Toutes les factures', href: '/admin/factures/toutes', icon: Receipt, permission: 'facture:read' },
    ],
  },
  { label: 'Comptabilité', href: '/admin/comptabilite', icon: Calculator, permission: 'comptabilite:read' },
  { label: 'Réclamations', href: '/admin/reclamations', icon: MessageSquareWarning, permission: 'reclamations:manage' },
  // { label: 'Modification des colis', href: '/admin/colis/modification', icon: SquarePen },
  { label: 'Marchands', href: '/admin/marchands', icon: Store, permission: 'marchands:manage' },
  // {
  //   label: 'Client',
  //   icon: UsersRound,
  //   children: [
  //     { label: 'Liste clients', href: '/admin/clients/liste', icon: Users },
  //     { label: 'Nouveau client', href: '/admin/clients/nouveau', icon: UserPlus },
  //   ],
  // },
  {
    label: 'Demande ramassage',
    href: '/admin/ramassages',
    icon: ClipboardList,
    permission: 'demande_ramassage:manage',
  },
  { label: 'Scan Réception Hub', href: '/admin/scan/reception', icon: ScanLine, permission: 'scan:reception_hub' },
  { label: 'Utilisateurs', href: '/admin/equipe', icon: UserCog, permission: 'users:manage' },
  { label: 'Tâches (Kanban)', href: '/admin/tasks', icon: Columns3, permission: 'tasks:manage' },
  // { label: 'Dépenses', href: '/admin/depenses', icon: Banknote },
  { label: 'Hubs', href: '/admin/hubs', icon: MapPin, permission: 'hubs:manage' },
  { label: 'Paramètres', href: '/admin/parametres', icon: Settings, permission: 'settings:manage' },
];

// Rôles cantonnés à l'outil Kanban (cf. lib/auth.ts ROLES_KANBAN_UNIQUEMENT +
// confinement de chemin dans proxy.ts) et rôle cantonné à la réception au quai
// (ROLES_HUB_UNIQUEMENT).
//
// Ces deux confinements SURVIVENT au passage aux permissions, et c'est
// volontaire : ils bornent un rôle à une portion de l'arborescence, ce qu'une
// permission ne sait pas exprimer. L'agent_hub détient par exemple `colis:read`
// (son écran de réception liste les colis du jour) sans que « Colis > Liste »
// doive lui apparaître pour autant.
const ROLES_KANBAN_UNIQUEMENT: Role[] = ['design', 'gestionnaire_hub'];
const ROLES_HUB_UNIQUEMENT: Role[] = ['agent_hub'];

// Filtre récursif : un item n'apparaît que si le compte détient sa permission,
// et un groupe que s'il lui reste au moins un enfant visible (évite d'afficher
// un intitulé de section vide).
export function filterNavByPermissions(nav: NavItem[], role: Role, permissions: string[]): NavItem[] {
  if (ROLES_KANBAN_UNIQUEMENT.includes(role)) {
    return nav.filter((item) => 'href' in item && item.href === '/admin/tasks');
  }
  if (ROLES_HUB_UNIQUEMENT.includes(role)) {
    return nav.filter(
      (item) => 'href' in item && (item.href === '/admin/scan/reception' || item.href === '/admin/bon-envoi')
    );
  }
  const autorise = (item: { permission?: string }) => !item.permission || permissions.includes(item.permission);
  return nav.reduce<NavItem[]>((acc, item) => {
    if ('children' in item) {
      const children = item.children.filter(autorise);
      if (children.length > 0) acc.push({ ...item, children });
      return acc;
    }
    if (autorise(item)) acc.push(item);
    return acc;
  }, []);
}
