'use client';

import { PageTabs } from '@/components/PageTabs';

export function BonsDocumentsSubNav() {
  return (
    <PageTabs
      tabs={[
        { label: 'Bons de livraison', href: '/marchand/bons-livraison' },
        { label: 'Bons de retour', href: '/marchand/bons-retour' },
        { label: 'Factures', href: '/marchand/factures' },
      ]}
    />
  );
}
