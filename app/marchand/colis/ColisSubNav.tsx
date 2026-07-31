'use client';

import { PageTabs } from '@/components/PageTabs';

export function ColisSubNav({ activeHref }: { activeHref?: string }) {
  return (
    <PageTabs
      activeHref={activeHref}
      tabs={[
        { label: 'Tous les colis', href: '/marchand/colis' },
        { label: 'Nouveaux', href: '/marchand/colis?statut=nouveau_colis' },
        { label: 'Prêts pour ramassage', href: '/marchand/colis/ramassage' },
        { label: 'Colis à relancer', href: '/marchand/colis/relance' },
      ]}
    />
  );
}
