import { redirect } from 'next/navigation';
import { getPageSession, roleMatches } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LivreurShell } from '@/components/livreur/LivreurShell';

// Le proxy (proxy.ts) protège déjà /livreur/:path*, et ce layout revérifie
// indépendamment : défense en profondeur, cohérent avec app/ramasseur/layout.tsx.
//
// C'est aussi lui qui monte la coquille, comme app/admin/layout.tsx : les
// pages ne s'enveloppent plus elles-mêmes. Le nom affiché au pied de la barre
// est lu ICI, côté serveur, en une requête par rendu de l'espace — une page
// cliente ne pouvait pas le connaître sans un aller-retour de plus.
export default async function LivreurLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('terrain');
  if (!session || !roleMatches(session, ['livreur'])) {
    redirect('/login');
  }

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: session.sub },
    select: { nomComplet: true },
  });

  return (
    <LivreurShell nomComplet={utilisateur?.nomComplet ?? 'Livreur'} role={session.role}>
      {children}
    </LivreurShell>
  );
}
