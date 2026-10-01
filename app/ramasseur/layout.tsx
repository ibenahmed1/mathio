import { redirect } from 'next/navigation';
import { getPageSession, roleMatches } from '@/lib/auth';
import { NotificationsProvider } from '@/components/notifications/NotificationsProvider';

// Avant ce fichier, app/ramasseur/page.tsx n'avait aucune vérification de
// session côté serveur (page 100% client). Le proxy (proxy.ts) protège
// désormais /ramasseur/:path*, et ce layout revérifie indépendamment :
// défense en profondeur, cohérent avec app/admin/layout.tsx.
export default async function RamasseurLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('terrain');
  if (!session || !roleMatches(session, ['ramasseur'])) {
    redirect('/login');
  }

  // § Notifications : l'espace ramasseur n'a pas de coquille — c'est donc ici
  // que vit l'état de sa cloche, pour toutes ses pages.
  return <NotificationsProvider>{children}</NotificationsProvider>;
}
