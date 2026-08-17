'use client';

import { PageTabs } from '@/components/PageTabs';

export function SupportProfilSubNav() {
  return (
    <PageTabs
      tabs={[
        { label: 'Réclamations', href: '/marchand/reclamations' },
        { label: 'Profil', href: '/marchand/profil' },
      ]}
    />
  );
}
