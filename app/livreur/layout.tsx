import { redirect } from 'next/navigation';
import { getPageSession, roleMatches } from '@/lib/auth';

// Le proxy (proxy.ts) protège déjà /livreur/:path*, et ce layout revérifie
// indépendamment : défense en profondeur, cohérent avec app/ramasseur/layout.tsx.
export default async function LivreurLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('terrain');
  if (!session || !roleMatches(session, ['livreur'])) {
    redirect('/login');
  }

  return <>{children}</>;
}
