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

// Rôles autorisés uniquement sur les items dont une route API vérifie
// réellement `requireUser([...])` avec une liste plus étroite que l'ensemble
// des rôles back-office (cf. audit § permissions Kanban/2026-08 puis audit
// verrouillage 2026-08-06) : Colis>Nouveau, les 4 items de Gestion de stock
// (§ /api/stock/**, /api/bons-preparation/**, /api/produits/**), Marchands,
// Utilisateurs, Zones & Villes, Bon de livraison, Bon d'envoi (dont la
// création, § /api/bons-envoi, POST requireUser(['admin'])) et Demande
// ramassage ne répondent qu'à `admin` (+ `marchand` côté portail marchand,
// hors de cette nav ; + `agent_hub`, cantonné à sa propre branche de
// filterNavByRole pour Bon d'envoi en lecture/réception seulement, cf.
// ROLES_HUB_UNIQUEMENT ci-dessous) ; Confirmation (statut colis) et
// Réclamations ont chacune leur propre
// sous-ensemble. Les autres items n'ont soit aucune restriction API, soit pas
// encore de backend (pages "à venir") — les restreindre arbitrairement
// inventerait une permission qui n'existe pas.
const ADMIN_SEUL: Role[] = ['admin'];
// § Réception dépôt hub (/admin/scan/reception) : seul item ouvert à
// agent_hub (cf. ROLES_HUB_UNIQUEMENT, lib/auth.ts).
const SCAN_RECEPTION_HUB: Role[] = ['admin', 'agent_hub'];
// § Import Excel (/admin/colis/import) : ouvert aux rôles qui gèrent déjà les
// colis/finances au quotidien, cf. requireUser dans app/api/commandes/import/route.ts.
const IMPORT_COLIS: Role[] = ['admin', 'superviseur', 'responsable'];
const CONFIRMATION_COLIS: Role[] = ['admin', 'superviseur', 'moderateur', 'equipe_suivi'];
const RECLAMATIONS: Role[] = ['admin', 'superviseur', 'moderateur'];
// § Comptabilité (RBAC) : réservé à admin + responsable (responsables
// comptables), cf. ROLES_COMPTABILITE dans app/api/finance/route.ts.
const COMPTABILITE: Role[] = ['admin', 'responsable'];
// § Planification des tournées (/admin/planification, /admin/bon-distribution,
// /admin/scan/tournee) : mêmes rôles que ROLES_PLANIFICATION (lib/auth.ts),
// redéclarés ici parce que ce module est chargé côté client — importer
// lib/auth y ferait entrer Prisma et next/headers.
const PLANIFICATION_TOURNEES: Role[] = ['admin', 'planner'];
// § Bon de retour (/admin/bon-retour/**) : même liste que ROLES_COMPOSITION
// dans app/api/bons-retour/route.ts — le planner compose les retours de son
// hub, comme il compose ses tournées.
const COMPOSITION_RETOURS: Role[] = ['admin', 'planner'];
// § Statistiques (/admin/statistique/**) : les pages affichent le COD encaissé
// et la performance nominative des livreurs. Même liste que la comptabilité,
// élargie au superviseur, dont c'est le métier de piloter l'exploitation.
const STATISTIQUES: Role[] = ['admin', 'responsable', 'superviseur'];

export const NAV_ADMIN: NavItem[] = [
  { label: 'Accueil', href: '/admin', icon: LayoutDashboard },
  {
    label: 'Colis',
    icon: Package,
    children: [
      { label: 'Nouveau', href: '/admin/colis/nouveau', icon: PackagePlus, roles: ADMIN_SEUL },
      { label: 'Import Excel', href: '/admin/colis/import', icon: FileSpreadsheet, roles: IMPORT_COLIS },
      { label: 'Liste', href: '/admin/commandes', icon: ListOrdered },
      { label: 'Suivi', href: '/admin/colis/suivi', icon: MapPinned },
      { label: 'Confirmation', href: '/admin/colis/confirmation', icon: CheckCircle2, roles: CONFIRMATION_COLIS },
    ],
  },
  // § Statistiques : réactivé avec le module (les six pages étaient des écrans
  // "à venir" jusqu'ici). Même périmètre que la comptabilité — un taux de
  // livraison par livreur est une donnée de pilotage, et le COD encaissé qui
  // s'y affiche est un chiffre financier.
  {
    label: 'Statistique',
    icon: BarChart3,
    children: [
      { label: 'Tout', href: '/admin/statistique/tout', icon: BarChart3, roles: STATISTIQUES },
      { label: 'Client', href: '/admin/statistique/client', icon: Users, roles: STATISTIQUES },
      { label: 'Livreur', href: '/admin/statistique/livreur', icon: Truck, roles: STATISTIQUES },
      { label: 'Zone', href: '/admin/statistique/zone', icon: MapPin, roles: STATISTIQUES },
      { label: 'Ville', href: '/admin/statistique/ville', icon: Building2, roles: STATISTIQUES },
      { label: 'Comparer', href: '/admin/statistique/comparer', icon: ArrowLeftRight, roles: STATISTIQUES },
    ],
  },
  {
    label: 'Gestion de stock',
    icon: Boxes,
    children: [
      { label: 'Nouveaux colis stock', href: '/admin/stock/nouveaux', icon: PackageSearch, roles: ADMIN_SEUL },
      { label: 'Prêts pour préparation', href: '/admin/stock/prets', icon: CheckCircle2, roles: ADMIN_SEUL },
      { label: 'Bons de préparation', href: '/admin/stock/bons-preparation', icon: FileText, roles: ADMIN_SEUL },
      { label: 'Inventory', href: '/admin/stock/inventaire', icon: Boxes, roles: ADMIN_SEUL },
    ],
  },
  { label: 'Bon de livraison', href: '/admin/bon-livraison', icon: FileText, roles: ADMIN_SEUL },
  // roles: ADMIN_SEUL ci-dessous ne s'applique qu'à la branche générique de
  // filterNavByRole — agent_hub y accède quand même via sa propre branche
  // ROLES_HUB_UNIQUEMENT (confinement à /admin/scan/reception + /admin/bon-envoi
  // hors création, cf. proxy.ts), qui ne consulte jamais `roles`.
  { label: "Bon d'envoi", href: '/admin/bon-envoi', icon: Send, roles: ADMIN_SEUL },
  // § Planification des tournées — les trois écrans du Planner, rapatriés dans
  // le back-office par le passage à trois domaines (cf. lib/spaces.ts) : son
  // tableau de bord, la composition/clôture des tournées, et le poste de scan
  // du quai (à distinguer de « Scan Réception Hub », celui de l'Agent Hub).
  // Même périmètre pour les trois, cf. ROLES_PLANIFICATION dans lib/auth.ts —
  // l'admin voit tous les hubs, le planner uniquement le sien (périmètre forcé
  // côté API, cf. resolveHubPlanification dans lib/bon-distribution.ts).
  { label: 'Planification', href: '/admin/planification', icon: LayoutDashboard, roles: PLANIFICATION_TOURNEES },
  { label: 'Bon de distribution', href: '/admin/bon-distribution', icon: Share2, roles: PLANIFICATION_TOURNEES },
  { label: 'Scan Tournée', href: '/admin/scan/tournee', icon: ScanLine, roles: PLANIFICATION_TOURNEES },
  // § Règlement du livreur : même périmètre que la comptabilité — émettre et
  // régler un bon sort de l'argent et génère une écriture (cf. ROLES_PAIEMENT
  // dans app/api/bons-paiement/route.ts).
  {
    label: 'Bon de paiement',
    icon: Wallet,
    children: [
      { label: 'Pour livreur', href: '/admin/bon-paiement/livreur', icon: Truck, roles: COMPTABILITE },
      { label: 'Pour zone', href: '/admin/bon-paiement/zone', icon: MapPin, roles: COMPTABILITE },
    ],
  },
  // § Bon de retour : composition ouverte à admin et planner (cf.
  // ROLES_COMPOSITION dans app/api/bons-retour/route.ts). Le planner y accédait
  // auparavant par sa propre web app, d'où l'absence de ces entrées dans cette
  // navigation ; elles lui sont désormais montrées ici, à la place.
  {
    label: 'Bon de retour',
    icon: Undo2,
    children: [
      { label: 'Pour livreur', href: '/admin/bon-retour/livreur', icon: Truck, roles: COMPOSITION_RETOURS },
      { label: 'Pour zone', href: '/admin/bon-retour/zone', icon: MapPin, roles: COMPOSITION_RETOURS },
      { label: 'Pour client', href: '/admin/bon-retour/client', icon: User, roles: COMPOSITION_RETOURS },
    ],
  },
  // § Facturation marchand : réactivée avec le module (les pages étaient des
  // écrans "à venir" jusqu'ici). Même périmètre que la comptabilité — une
  // facture est une écriture financière engageante, cf. ROLES_FACTURATION
  // dans app/api/factures/route.ts.
  {
    label: 'Facture',
    icon: Receipt,
    children: [
      { label: 'Nouvelle facture', href: '/admin/factures/nouvelle', icon: FilePlus2, roles: COMPTABILITE },
      { label: 'Toutes les factures', href: '/admin/factures/toutes', icon: Receipt, roles: COMPTABILITE },
    ],
  },
  { label: 'Comptabilité', href: '/admin/comptabilite', icon: Calculator, roles: COMPTABILITE },
  { label: 'Réclamations', href: '/admin/reclamations', icon: MessageSquareWarning, roles: RECLAMATIONS },
  // { label: 'Modification des colis', href: '/admin/colis/modification', icon: SquarePen },
  { label: 'Marchands', href: '/admin/marchands', icon: Store, roles: ADMIN_SEUL },
  // {
  //   label: 'Client',
  //   icon: UsersRound,
  //   children: [
  //     { label: 'Liste clients', href: '/admin/clients/liste', icon: Users },
  //     { label: 'Nouveau client', href: '/admin/clients/nouveau', icon: UserPlus },
  //   ],
  // },
  { label: 'Demande ramassage', href: '/admin/ramassages', icon: ClipboardList, roles: ADMIN_SEUL },
  { label: 'Scan Réception Hub', href: '/admin/scan/reception', icon: ScanLine, roles: SCAN_RECEPTION_HUB },
  { label: 'Utilisateurs', href: '/admin/equipe', icon: UserCog, roles: ADMIN_SEUL },
  { label: 'Tâches (Kanban)', href: '/admin/tasks', icon: Columns3 },
  // { label: 'Dépenses', href: '/admin/depenses', icon: Banknote },
  { label: 'Hubs', href: '/admin/hubs', icon: MapPin, roles: ADMIN_SEUL },
  { label: 'Paramètres', href: '/admin/parametres', icon: Settings },
];

// Rôles cantonnés à l'outil Kanban uniquement (cf. lib/auth.ts
// ROLES_KANBAN_UNIQUEMENT + confinement de page dans proxy.ts) : le reste du
// back-office leur étant de toute façon inaccessible côté API/pages, la nav
// ne doit leur montrer que "Tâches (Kanban)" — sinon la sidebar affiche des
// liens qui les renvoient aussitôt vers /admin/tasks.
const ROLES_KANBAN_UNIQUEMENT: Role[] = ['design', 'gestionnaire_hub'];

// Rôle cantonné à la réception de dépôt au hub régional uniquement (cf.
// lib/auth.ts ROLES_HUB_UNIQUEMENT + confinement de page dans proxy.ts) : la
// nav ne doit lui montrer que "Scan Réception Hub".
const ROLES_HUB_UNIQUEMENT: Role[] = ['agent_hub'];

// Filtre récursif : un groupe ne survit que s'il lui reste au moins un enfant
// visible pour `role` (évite d'afficher un intitulé de section vide).
//
// Le rôle `planner` n'a PAS de branche de confinement ici : depuis le passage
// à trois domaines il fait partie de ROLES_BACKOFFICE et voit la navigation
// ordinaire, filtrée item par item comme pour les autres rôles internes.
export function filterNavByRole(nav: NavItem[], role: Role): NavItem[] {
  if (ROLES_KANBAN_UNIQUEMENT.includes(role)) {
    return nav.filter((item) => 'href' in item && item.href === '/admin/tasks');
  }
  if (ROLES_HUB_UNIQUEMENT.includes(role)) {
    return nav.filter(
      (item) => 'href' in item && (item.href === '/admin/scan/reception' || item.href === '/admin/bon-envoi')
    );
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
