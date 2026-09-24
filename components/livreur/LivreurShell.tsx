'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { SidebarContext } from '@/components/admin/SidebarContext';
import { SidebarToggleButtons } from '@/components/admin/SidebarToggleButtons';
import { NAV_LIVREUR } from './nav';
import type { Role } from '@/app/generated/prisma/enums';

// Coquille de l'espace livreur. Elle ne réimplémente plus une barre à elle :
// elle monte EXACTEMENT celle du back-office (AdminSidebar) avec la navigation
// du livreur. Les deux espaces internes partagent ainsi le même gabarit, le
// même pied de profil (avatar, nom, rôle, menu Profil/Déconnexion) et le même
// comportement de repli — une divergence de style entre eux ne peut plus
// s'installer par simple oubli, puisqu'il n'y a plus qu'un seul composant.
//
// Elle est montée UNE FOIS par le layout (§ app/livreur/layout.tsx) et non
// plus par chaque page : sans cela, le nom du livreur — lu en base côté
// serveur — n'avait aucun chemin jusqu'à la barre.

// Écrans qui posent EUX-MÊMES leur fond d'un bord à l'autre et refusent donc
// la gouttière de la coquille, qui laisserait un liseré de .shell-surface tout
// autour :
//   — l'Accueil (§ DashboardLivreur), qui reprend la surface #F0F0ED du
//     tableau de bord du back-office ;
//   — la documentation API, qui reprend la page blanche du document déployé
//     chez nos partenaires.
// Comparaison EXACTE : un startsWith('/livreur') emporterait tout l'espace.
const PLEINE_LARGEUR = ['/livreur', '/livreur/documentation-api'];

function estPleineLargeur(pathname: string | null) {
  return !!pathname && PLEINE_LARGEUR.includes(pathname);
}

export function LivreurShell({
  nomComplet,
  role,
  children,
}: {
  nomComplet: string;
  // Rôle RÉEL de la session, et non `'livreur'` en dur : l'espace est aussi
  // atteignable par un compte dont `livreur` n'est qu'un rôle supplémentaire
  // (§ roleMatches, lib/auth.ts). Le pied de barre doit dire qui l'on est.
  role: Role;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const pleineLargeur = estPleineLargeur(pathname);

  return (
    <SidebarContext.Provider
      value={{ collapsed, toggleCollapse: () => setCollapsed((v) => !v), openMobile: () => setMobileOpen(true) }}
    >
      <div className="shell-surface mtContent min-h-screen lg:flex">
        <AdminSidebar
          nav={NAV_LIVREUR}
          adminName={nomComplet}
          role={role}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          profilHref="/livreur/profil"
        />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* Le repli desktop vit dans la barre elle-même : ne reste ici que
              l'ouverture en MOBILE, où la barre est hors-écran et son propre
              bouton donc inatteignable. `print:hidden` : l'impression ne
              masque plus les <header>, celui de la coquille doit s'effacer de
              lui-même. */}
          <div className="px-4 pt-4 lg:hidden print:hidden">
            <SidebarToggleButtons />
          </div>
          <main className={pleineLargeur ? 'min-w-0 flex-1' : 'min-w-0 flex-1 p-4 sm:p-6'}>{children}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
