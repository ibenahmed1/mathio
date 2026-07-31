import { redirect } from 'next/navigation';
import { getPageSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AdminShell } from '@/components/admin/AdminShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('admin');
  if (!session || session.role !== 'admin') {
    redirect('/login');
  }

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: session.sub },
    select: { nomComplet: true },
  });

  return <AdminShell adminName={utilisateur?.nomComplet ?? 'Administrateur'}>{children}</AdminShell>;
}
