'use client';

import { useState } from 'react';
import { Menu, ShieldAlert } from 'lucide-react';
import { apiPost } from '@/lib/api-client';
import { MarchandSidebar } from '@/components/marchand/MarchandSidebar';
import { NAV_MARCHAND_MENU, NAV_MARCHAND_AUTRE } from '@/components/marchand/nav';

export function MarchandShell({
  children,
  impersonation,
  retourBackOffice,
}: {
  children: React.ReactNode;
  // La session en cours a été ouverte par un admin via "Accéder à l'espace"
  // (claim `imp` du JWT, cf. /api/session-handoff/consume) — affiche le
  // bandeau et le raccourci de retour.
  impersonation?: boolean;
  // URL ABSOLUE vers le back-office : il vit sur son propre domaine racine, un
  // chemin relatif resterait sur le domaine marchand.
  retourBackOffice: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Termine réellement la session marchand empruntée (pas seulement une
  // navigation) : sans ça, le cookie de session resterait valide jusqu'à 24 h
  // dans ce navigateur après le retour au back-office — un vrai risque sur un
  // poste partagé. /api/auth/logout ne peut de toute façon effacer que les
  // cookies de l'hôte marchand, la session admin vivant sur un autre domaine.
  //
  // `window.location` et non `router.push` : la destination est sur un autre
  // domaine racine, le routeur Next ne sait pas y naviguer.
  async function quitterEspaceMarchand() {
    try {
      await apiPost('/api/auth/logout');
    } finally {
      window.location.href = retourBackOffice;
    }
  }

  return (
    <div className="marchand-typo marchand-surface min-h-screen lg:flex">
      <MarchandSidebar
        nav={NAV_MARCHAND_MENU}
        autre={NAV_MARCHAND_AUTRE}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {impersonation && (
          <div className="flex items-center justify-center gap-2 bg-black px-4 py-1.5 text-center text-xs font-semibold text-white">
            <ShieldAlert className="h-3.5 w-3.5" />
            Vous consultez cet espace marchand depuis l&apos;administration.
            <button onClick={quitterEspaceMarchand} className="underline underline-offset-2 hover:opacity-80">
              Retour à l&apos;administration
            </button>
          </div>
        )}
        {/* La sidebar reste dépliée en permanence en desktop. Ne subsiste que
            l'ouverture en mobile : la sidebar est alors hors-écran, donc son
            propre bouton de fermeture est inatteignable. */}
        <div className="px-4 pt-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="shrink-0 rounded-lg border border-[color:var(--mk-line)] bg-[color:var(--mk-card)] p-2 text-[color:var(--mk-ink-2)] shadow-[var(--mk-shadow)] transition-colors hover:bg-[color:var(--mk-line-soft)]"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
