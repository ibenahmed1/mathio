import { redirect } from 'next/navigation';
import { getPageSession, ROLES_BACKOFFICE, ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AdminShell } from '@/components/admin/AdminShell';

// Le confinement des rôles Kanban-only (design, gestionnaire_hub) à
// /admin/tasks est déjà fait par proxy.ts (chemin par chemin) ; ce layout ne
// vérifie ici que l'appartenance à l'espace admin au sens large.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('admin');
  if (!session || ![...ROLES_BACKOFFICE, ...ROLES_KANBAN_UNIQUEMENT].includes(session.role)) {
    redirect('/login');
  }

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: session.sub },
    select: { nomComplet: true },
  });

  return (
    <AdminShell adminName={utilisateur?.nomComplet ?? 'Administrateur'} role={session.role}>
      {children}
    </AdminShell>
  );
}
