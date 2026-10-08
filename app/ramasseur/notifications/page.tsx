import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { CentreNotifications } from '@/components/notifications/CentreNotifications';

// § Notifications — centre de notifications du ramasseur. Cet espace n'a pas
// de coquille (cf. app/ramasseur/layout.tsx) : la page porte son propre
// retour vers l'écran de scan.
export default function NotificationsPage() {
  return (
    <div className="min-h-dvh shell-surface p-4 sm:p-6">
      <Link href="/ramasseur" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold opacity-70 hover:opacity-100">
        <ChevronLeft className="h-4 w-4" />
        Retour
      </Link>
      <Suspense>
        <CentreNotifications />
      </Suspense>
    </div>
  );
}
