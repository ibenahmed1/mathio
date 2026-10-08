import { Suspense } from 'react';
import { CentreNotifications } from '@/components/notifications/CentreNotifications';

// § Notifications — centre de notifications de l'espace (historique et
// préférences). Le composant est commun aux quatre espaces.
export default function NotificationsPage() {
  return (
    <Suspense>
      <CentreNotifications />
    </Suspense>
  );
}
