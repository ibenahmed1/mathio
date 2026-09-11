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
  Files,
  Send,
  Share2,
  Wallet,
  Undo2,
  User,
  Receipt,
  Banknote,
  FilePlus2,
  MessageSquareWarning,
  ClipboardList,
  UserCog,
  Settings,
  Store,
  Columns3,
  Calculator,
  LifeBuoy,
  Network,
  Plug,
  ScanLine,
} from 'lucide-react';
import type { NavItem, NavLeaf } from '@/components/AppSidebar';
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
// L'ARBORESCENCE, elle, suit le métier et non le modèle de données : une
// vingtaine d'entrées à plat étaient devenues illisibles. On les regroupe donc
// en trois domaines — exploitation, finance, administration — portés par le
// champ `section`, et on descend jusqu'à trois niveaux là où une famille de
// documents le justifie (Stock, Bon de retour, Bon de paiement, Factures).
// Aucune permission n'a bougé : seul l'endroit où l'on clique change.
//
// Ce module est chargé côté client : il ne doit importer ni lib/auth (qui
// entraînerait Prisma et next/headers) ni lib/permission-routes — seulement
// des chaînes.

const SECTION_EXPLOITATION = 'Exploitation & logistique';
const SECTION_FINANCE = 'Finance & comptabilité';
const SECTION_ADMINISTRATION = 'Administration & paramètres';

export const NAV_ADMIN: NavItem[] = [
  { label: 'Accueil', href: '/admin', icon: LayoutDashboard, permission: 'dashboard:view' },
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

  /* ---------- Exploitation & logistique ---------- */
  {
    label: 'Colis',
    icon: Package,
    section: SECTION_EXPLOITATION,
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
      // La demande de ramassage est l'amont du colis — c'est elle qui le fait
      // entrer dans le réseau : sa place est ici, pas dans une entrée isolée.
      {
        label: 'Demande ramassage',
        href: '/admin/ramassages',
        icon: ClipboardList,
        permission: 'demande_ramassage:manage',
      },
      {
        label: 'Stock',
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
          { label: 'Inventaire', href: '/admin/stock/inventaire', icon: Boxes, permission: 'stock:inventory' },
        ],
      },
    ],
  },
  {
    label: 'Opérations & scans',
    icon: ScanLine,
    section: SECTION_EXPLOITATION,
    children: [
      { label: 'Scan Réception Hub', href: '/admin/scan/reception', icon: ScanLine, permission: 'scan:reception_hub' },
      { label: 'Scan Tournée', href: '/admin/scan/tournee', icon: ScanLine, permission: 'scan:tournee' },
      // § Planification des tournées — les trois écrans du Planner. L'admin
      // voit tous les hubs, le planner uniquement le sien : ce cantonnement-là
      // est affaire de DONNÉES (resolveHubPlanification, lib/bon-distribution.ts)
      // et reste entier, la permission ne gouverne que l'accès à l'écran.
      {
        label: 'Planification',
        href: '/admin/planification',
        icon: LayoutDashboard,
        permission: 'planification:manage',
      },
    ],
  },
  {
    label: 'Documents de transport',
    icon: Files,
    section: SECTION_EXPLOITATION,
    children: [
      { label: 'Bon de livraison', href: '/admin/bon-livraison', icon: FileText, permission: 'bon_livraison:manage' },
      { label: "Bon d'envoi", href: '/admin/bon-envoi', icon: Send, permission: 'bon_envoi:manage' },
      {
        label: 'Bon de distribution',
        href: '/admin/bon-distribution',
        icon: Share2,
        permission: 'bon_distribution:manage',
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
    ],
  },

  /* ---------- Finance & comptabilité ---------- */
  {
    label: 'Factures & règlements',
    icon: Banknote,
    section: SECTION_FINANCE,
    children: [
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
      {
        label: 'Factures',
        icon: Receipt,
        children: [
          {
            label: 'Nouvelle facture',
            href: '/admin/factures/nouvelle',
            icon: FilePlus2,
            permission: 'facture:create',
          },
          { label: 'Toutes les factures', href: '/admin/factures/toutes', icon: Receipt, permission: 'facture:read' },
        ],
      },
    ],
  },
  {
    label: 'Comptabilité',
    href: '/admin/comptabilite',
    icon: Calculator,
    section: SECTION_FINANCE,
    permission: 'comptabilite:read',
  },

  /* ---------- Administration & paramètres ---------- */
  // « Réseau & Hubs » est un écran UNIQUE : hubs, prestataires et villes y
  // cohabitent (cf. app/admin/hubs/page.tsx). D'où une feuille et non un
  // groupe, malgré le pluriel de l'intitulé.
  {
    label: 'Réseau & Hubs',
    href: '/admin/hubs',
    icon: Network,
    section: SECTION_ADMINISTRATION,
    permission: 'hubs:manage',
  },
  {
    label: 'Partenaires',
    href: '/admin/marchands',
    icon: Store,
    section: SECTION_ADMINISTRATION,
    permission: 'marchands:manage',
  },
  {
    label: 'Équipe & rôles',
    href: '/admin/equipe',
    icon: UserCog,
    section: SECTION_ADMINISTRATION,
    permission: 'users:manage',
  },
  {
    label: 'Support',
    icon: LifeBuoy,
    section: SECTION_ADMINISTRATION,
    children: [
      {
        label: 'Réclamations',
        href: '/admin/reclamations',
        icon: MessageSquareWarning,
        permission: 'reclamations:manage',
      },
      { label: 'Tâches (Kanban)', href: '/admin/tasks', icon: Columns3, permission: 'tasks:manage' },
    ],
  },
  {
    label: 'Intégrations',
    href: '/admin/integrations',
    icon: Plug,
    section: SECTION_ADMINISTRATION,
    permission: 'integrations:manage',
  },
  {
    label: 'Paramètres',
    href: '/admin/parametres',
    icon: Settings,
    section: SECTION_ADMINISTRATION,
    permission: 'settings:manage',
  },
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

// Les écrans laissés à ces rôles vivent désormais AU FOND de l'arbre
// (/admin/tasks sous Support, /admin/scan/reception sous Opérations & scans).
// On les extrait donc à plat, sans leur section : leur imposer de déplier deux
// groupes pour atteindre le seul écran auquel ils ont droit n'aurait aucun
// sens, et le confinement cesse ainsi de dépendre de la place que la
// hiérarchie donne à ces écrans.
function extraireFeuilles(nav: NavItem[], hrefs: string[]): NavLeaf[] {
  const trouvees: NavLeaf[] = [];
  const visiter = (items: NavItem[]) => {
    for (const item of items) {
      if ('children' in item) visiter(item.children);
      else if (hrefs.includes(item.href)) trouvees.push({ ...item, section: undefined });
    }
  };
  visiter(nav);
  // L'ordre suit celui demandé et non celui de l'arbre : c'est l'écran
  // principal du rôle qui doit arriver en tête.
  return hrefs.flatMap((href) => trouvees.filter((feuille) => feuille.href === href));
}

// Un item n'apparaît que si le compte détient sa permission, et un groupe que
// s'il lui reste au moins un enfant visible — à n'importe quelle profondeur,
// ce qui évite d'afficher un intitulé de groupe qui ne mènerait nulle part.
function filtrerParPermissions(nav: NavItem[], permissions: string[]): NavItem[] {
  return nav.reduce<NavItem[]>((acc, item) => {
    if ('children' in item) {
      const children = filtrerParPermissions(item.children, permissions);
      if (children.length > 0) acc.push({ ...item, children });
      return acc;
    }
    if (!item.permission || permissions.includes(item.permission)) acc.push(item);
    return acc;
  }, []);
}

export function filterNavByPermissions(nav: NavItem[], role: Role, permissions: string[]): NavItem[] {
  if (ROLES_KANBAN_UNIQUEMENT.includes(role)) return extraireFeuilles(nav, ['/admin/tasks']);
  if (ROLES_HUB_UNIQUEMENT.includes(role)) {
    return extraireFeuilles(nav, ['/admin/scan/reception', '/admin/bon-envoi']);
  }
  return filtrerParPermissions(nav, permissions);
}
