import { redirect } from 'next/navigation';
import { getPageSession, roleMatches } from '@/lib/auth';

// Avant ce fichier, app/ramasseur/page.tsx n'avait aucune vérification de
// session côté serveur (page 100% client). Le proxy (proxy.ts) protège
// désormais /ramasseur/:path*, et ce layout revérifie indépendamment :
// défense en profondeur, cohérent avec app/admin/layout.tsx.
export default async function RamasseurLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('terrain');
  if (!session || !roleMatches(session, ['ramasseur'])) {
    redirect('/login');
  }

  return <>{children}</>;
}
