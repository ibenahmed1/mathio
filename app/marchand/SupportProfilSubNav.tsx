'use client';

import { PageTabs } from '@/components/PageTabs';
import { usePermissionsMarchand } from '@/components/marchand/permissions-context';

export function SupportProfilSubNav() {
  // § Équipe & accès : seuls les onglets ouverts au rôle du membre.
  const { peutOuvrir } = usePermissionsMarchand();
  return (
    <PageTabs
      tabs={[
        { label: 'Réclamations', href: '/marchand/reclamations' },
        { label: 'Profil', href: '/marchand/profil' },
      ].filter((t) => peutOuvrir(t.href))}
    />
  );
}
