'use client';

import { PageTabs } from '@/components/PageTabs';
import { usePermissionsMarchand } from '@/components/marchand/permissions-context';

export function ColisSubNav({ activeHref }: { activeHref?: string }) {
  // § Équipe & accès : seuls les onglets ouverts au rôle du membre.
  const { peutOuvrir } = usePermissionsMarchand();
  return (
    <PageTabs
      activeHref={activeHref}
      tabs={[
        { label: 'Tous les colis', href: '/marchand/colis' },
        { label: 'Nouveaux', href: '/marchand/colis?statut=nouveau_colis' },
        { label: 'Prêts pour ramassage', href: '/marchand/colis/ramassage' },
        { label: 'Colis à relancer', href: '/marchand/colis/relance' },
      ].filter((t) => peutOuvrir(t.href))}
    />
  );
}
