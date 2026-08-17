'use client';

import { PageTabs } from '@/components/PageTabs';

export function InventaireSubNav() {
  return (
    <PageTabs
      tabs={[
        { label: 'Inventaire', href: '/marchand/inventaire' },
        { label: 'Ajouter produit', href: '/marchand/inventaire/nouveau' },
      ]}
    />
  );
}
