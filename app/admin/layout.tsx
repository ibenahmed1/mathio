import { redirect } from 'next/navigation';
import Script from 'next/script';
import {
  getPageSession,
  roleMatches,
  ROLES_BACKOFFICE,
  ROLES_HUB_UNIQUEMENT,
  ROLES_KANBAN_UNIQUEMENT,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AdminShell } from '@/components/admin/AdminShell';

// Le confinement des rôles Kanban-only (design, gestionnaire_hub) à
// /admin/tasks et de l'Agent Hub (agent_hub) à /admin/scan/reception est déjà
// fait par proxy.ts (chemin par chemin) ; ce layout ne vérifie ici que
// l'appartenance à l'espace admin au sens large. Le Planner n'y figure pas à
// part : il fait partie de ROLES_BACKOFFICE et circule dans tout /admin/**.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('admin');
  if (
    !session ||
    !roleMatches(session, [...ROLES_BACKOFFICE, ...ROLES_KANBAN_UNIQUEMENT, ...ROLES_HUB_UNIQUEMENT])
  ) {
    redirect('/login');
  }

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: session.sub },
    select: { nomComplet: true },
  });

  return (
    <>
      {/* Ionicons (web component) : uniquement pour <ion-icon name="location-outline">
          des cartes "Zone" du wizard Bon de Distribution (BonDistributionCreerUI.jsx)
          — chargé ici plutôt que dans le layout racine pour rester cantonné à
          l'espace admin, seul espace qui en a besoin pour l'instant. */}
      <Script type="module" src="https://unpkg.com/ionicons@7.2.2/dist/ionicons/ionicons.esm.js" strategy="afterInteractive" />
      <Script noModule src="https://unpkg.com/ionicons@7.2.2/dist/ionicons/ionicons.js" strategy="afterInteractive" />
      <AdminShell
        adminName={utilisateur?.nomComplet ?? 'Administrateur'}
        role={session.role}
        permissions={session.permissions}
      >
        {children}
      </AdminShell>
    </>
  );
}
