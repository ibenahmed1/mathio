'use client';

import { PageTabs } from '@/components/PageTabs';
import { usePermissionsMarchand } from '@/components/marchand/permissions-context';

export function BonsDocumentsSubNav() {
  // § Équipe & accès : seuls les onglets ouverts au rôle du membre.
  const { peutOuvrir } = usePermissionsMarchand();
  return (
    <PageTabs
      tabs={[
        { label: 'Bons de livraison', href: '/marchand/bons-livraison' },
        { label: 'Bons de retour', href: '/marchand/bons-retour' },
        { label: 'Factures', href: '/marchand/factures' },
      ].filter((t) => peutOuvrir(t.href))}
    />
  );
}
