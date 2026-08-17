import {
  LayoutDashboard,
  Package,
  PackagePlus,
  ListOrdered,
  MapPinned,
  CheckCircle2,
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
  SquarePen,
  UsersRound,
  UserPlus,
  ClipboardList,
  UserCog,
  Banknote,
  Settings,
  Store,
  Columns3,
  Calculator,
} from 'lucide-react';
import type { NavItem } from '@/components/AppSidebar';
import type { Role } from '@/app/generated/prisma/enums';

// Rôles autorisés uniquement sur les items dont une route API vérifie
// réellement `requireUser([...])` avec une liste plus étroite que l'ensemble
// des rôles back-office (cf. audit § permissions Kanban/2026-08 puis audit
// verrouillage 2026-08-06) : Colis>Nouveau, Gestion de stock>Inventory,
// Marchands, Utilisateurs, Zones & Villes, Bon de livraison et Demande
// ramassage ne répondent qu'à `admin` (+ `marchand` côté portail marchand,
// hors de cette nav) ; Confirmation (statut colis) et Réclamations ont
// chacune leur propre sous-ensemble. Les autres items n'ont soit aucune
// restriction API, soit pas encore de backend (pages "à venir") — les
// restreindre arbitrairement inventerait une permission qui n'existe pas.
const ADMIN_SEUL: Role[] = ['admin'];
const CONFIRMATION_COLIS: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi'];
const RECLAMATIONS: Role[] = ['admin', 'superviseur', 'moderateur'];
// § Comptabilité (RBAC) : réservé à admin + responsable (responsables
// comptables), cf. ROLES_COMPTABILITE dans app/api/finance/route.ts.
const COMPTABILITE: Role[] = ['admin', 'responsable'];

export const NAV_ADMIN: NavItem[] = [
  { label: 'Accueil', href: '/admin', icon: LayoutDashboard },
  {
    label: 'Colis',
    icon: Package,
    children: [
      { label: 'Nouveau', href: '/admin/colis/nouveau', icon: PackagePlus, roles: ADMIN_SEUL },
      { label: 'Liste', href: '/admin/commandes', icon: ListOrdered },
      { label: 'Suivi', href: '/admin/colis/suivi', icon: MapPinned },
      { label: 'Confirmation', href: '/admin/colis/confirmation', icon: CheckCircle2, roles: CONFIRMATION_COLIS },
    ],
  },
  {
    label: 'Statistique',
    icon: BarChart3,
    children: [
      { label: 'Tout', href: '/admin/statistique/tout', icon: BarChart3 },
      { label: 'Client', href: '/admin/statistique/client', icon: Users },
      { label: 'Livreur', href: '/admin/statistique/livreur', icon: Truck },
      { label: 'Zone', href: '/admin/statistique/zone', icon: MapPin },
      { label: 'Ville', href: '/admin/statistique/ville', icon: Building2 },
      { label: 'Comparer', href: '/admin/statistique/comparer', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Gestion de stock',
    icon: Boxes,
    children: [
      { label: 'Nouveau colis préparation', href: '/admin/stock/nouveau', icon: PackageSearch },
      { label: 'Bon livraison stock', href: '/admin/stock/bon-livraison', icon: FileText },
      { label: 'Inventory', href: '/admin/stock/inventaire', icon: Boxes, roles: ADMIN_SEUL },
    ],
  },
  { label: 'Bon de livraison', href: '/admin/bon-livraison', icon: FileText, roles: ADMIN_SEUL },
  { label: "Bon d'envoi", href: '/admin/bon-envoi', icon: Send },
  { label: 'Bon de distribution', href: '/admin/bon-distribution', icon: Share2 },
  {
    label: 'Bon de paiement',
    icon: Wallet,
    children: [
      { label: 'Pour livreur', href: '/admin/bon-paiement/livreur', icon: Truck },
      { label: 'Pour zone', href: '/admin/bon-paiement/zone', icon: MapPin },
    ],
  },
  {
    label: 'Bon de retour',
    icon: Undo2,
    children: [
      { label: 'Pour livreur', href: '/admin/bon-retour/livreur', icon: Truck },
      { label: 'Pour zone', href: '/admin/bon-retour/zone', icon: MapPin },
      { label: 'Pour client', href: '/admin/bon-retour/client', icon: User },
    ],
  },
  {
    label: 'Facture',
    icon: Receipt,
    children: [
      { label: 'Nouvelle facture', href: '/admin/factures/nouvelle', icon: FilePlus2 },
      { label: 'Toutes les factures', href: '/admin/factures/toutes', icon: Receipt },
    ],
  },
  { label: 'Comptabilité', href: '/admin/comptabilite', icon: Calculator, roles: COMPTABILITE },
  { label: 'Réclamations', href: '/admin/reclamations', icon: MessageSquareWarning, roles: RECLAMATIONS },
  { label: 'Modification des colis', href: '/admin/colis/modification', icon: SquarePen },
  { label: 'Marchands', href: '/admin/marchands', icon: Store, roles: ADMIN_SEUL },
  {
    label: 'Client',
    icon: UsersRound,
    children: [
      { label: 'Liste clients', href: '/admin/clients/liste', icon: Users },
      { label: 'Nouveau client', href: '/admin/clients/nouveau', icon: UserPlus },
    ],
  },
  { label: 'Demande ramassage', href: '/admin/ramassages', icon: ClipboardList, roles: ADMIN_SEUL },
  { label: 'Utilisateurs', href: '/admin/equipe', icon: UserCog, roles: ADMIN_SEUL },
  { label: 'Tâches (Kanban)', href: '/admin/tasks', icon: Columns3 },
  { label: 'Dépenses', href: '/admin/depenses', icon: Banknote },
  { label: 'Zones & Villes', href: '/admin/zones', icon: MapPin, roles: ADMIN_SEUL },
  { label: 'Paramètres', href: '/admin/parametres', icon: Settings },
];

// Rôles cantonnés à l'outil Kanban uniquement (cf. lib/auth.ts
// ROLES_KANBAN_UNIQUEMENT + confinement de page dans proxy.ts) : le reste du
// back-office leur étant de toute façon inaccessible côté API/pages, la nav
// ne doit leur montrer que "Tâches (Kanban)" — sinon la sidebar affiche des
// liens qui les renvoient aussitôt vers /admin/tasks.
const ROLES_KANBAN_UNIQUEMENT: Role[] = ['design', 'gestionnaire_hub'];

// Filtre récursif : un groupe ne survit que s'il lui reste au moins un enfant
// visible pour `role` (évite d'afficher un intitulé de section vide).
export function filterNavByRole(nav: NavItem[], role: Role): NavItem[] {
  if (ROLES_KANBAN_UNIQUEMENT.includes(role)) {
    return nav.filter((item) => 'href' in item && item.href === '/admin/tasks');
  }
  return nav.reduce<NavItem[]>((acc, item) => {
    if (item.roles && !item.roles.includes(role)) return acc;
    if ('children' in item) {
      const children = item.children.filter((c) => !c.roles || c.roles.includes(role));
      if (children.length > 0) acc.push({ ...item, children });
      return acc;
    }
    acc.push(item);
    return acc;
  }, []);
}
