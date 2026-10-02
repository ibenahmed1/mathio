'use client';

import { PageTabs } from '@/components/PageTabs';
import { usePermissionsMarchand } from '@/components/marchand/permissions-context';

export function InventaireSubNav() {
  // § Équipe & accès : seuls les onglets ouverts au rôle du membre.
  const { peutOuvrir } = usePermissionsMarchand();
  return (
    <PageTabs
      tabs={[
        { label: 'Inventaire', href: '/marchand/inventaire' },
        { label: 'Ajouter produit', href: '/marchand/inventaire/nouveau' },
      ].filter((t) => peutOuvrir(t.href))}
    />
  );
}
