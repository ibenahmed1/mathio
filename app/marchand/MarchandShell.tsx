'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import type { Marchand } from '@/lib/types';
import { AppHeader } from '@/components/AppHeader';
import { MarchandSidebar } from '@/components/marchand/MarchandSidebar';
import { NAV_MARCHAND_MENU, NAV_MARCHAND_AUTRE } from '@/components/marchand/nav';
import { CommandMenu } from '@/components/marchand/CommandMenu';

export function MarchandShell({
  children,
  adminAccessible,
}: {
  children: React.ReactNode;
  // Une session admin valide coexiste dans ce navigateur (typiquement après
  // "Accéder à l'espace" depuis /admin/marchands) — affiche un raccourci de
  // retour, purement indicatif.
  adminAccessible?: boolean;
}) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [boutique, setBoutique] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Marchand>('/api/marchands/me')
      .then((m) => setBoutique(m.nomBoutique))
      .catch(() => setBoutique(null));
  }, []);

  // Termine réellement la session marchand empruntée (pas seulement une
  // navigation) : sans ça, le cookie pd_session_marchand resterait valide
  // jusqu'à 7 jours dans ce navigateur après le retour à l'admin — un vrai
  // risque sur un poste partagé. /api/auth/logout ne coupe que l'espace
  // "marchand" (déduit de l'URL courante par lib/api-client.ts), donc la
  // session admin de l'onglet reste intacte.
  async function quitterEspaceMarchand() {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      router.push('/admin/marchands');
    }
  }

  return (
    <div className="shell-surface min-h-screen lg:flex">
      <MarchandSidebar
        nav={NAV_MARCHAND_MENU}
        autre={NAV_MARCHAND_AUTRE}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {adminAccessible && (
          <div className="flex items-center justify-center gap-2 bg-black px-4 py-1.5 text-center text-xs font-semibold text-white">
            <ShieldAlert className="h-3.5 w-3.5" />
            Vous consultez cet espace marchand depuis l&apos;administration.
            <button onClick={quitterEspaceMarchand} className="underline underline-offset-2 hover:opacity-80">
              Retour à l&apos;administration
            </button>
          </div>
        )}
        <AppHeader
          title={boutique}
          profileHref="/marchand/profil"
          collapsed={collapsed}
          onToggleMobile={() => setMobileOpen(true)}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          search={<CommandMenu />}
        />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
