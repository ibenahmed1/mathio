import { redirect } from 'next/navigation';
import Script from 'next/script';
import { getPageSession, roleMatches, ROLES_PLANIFICATION } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PlannerShell } from '@/components/planner/PlannerShell';

// § Web app Planner (/planner) : espace applicatif à part entière depuis la
// séparation par domaines — son propre sous-domaine du domaine métier, son
// propre cookie, son propre claim `aud`. Le proxy (proxy.ts) protège déjà
// /planner/:path* et refuse ces pages sur tout autre hôte ; ce layout
// revérifie indépendamment — défense en profondeur, cohérente avec
// app/admin/layout.tsx et app/livreur/layout.tsx.
//
// L'admin y a accès lui aussi (il travaille sur tous les hubs et doit pouvoir
// dépanner depuis l'écran terrain), mais par transfert de session depuis le
// back-office (POST /api/session-handoff/planner) et non par mot de passe :
// ses identifiants ne transitent jamais par le domaine métier. Le module
// reste par ailleurs disponible dans le back-office sous
// /admin/bon-distribution.
export default async function PlannerLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('planner');
  if (!session || !roleMatches(session, ROLES_PLANIFICATION)) {
    redirect('/login');
  }

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: session.sub },
    select: { nomComplet: true, hub: { select: { nom: true } } },
  });

  return (
    <>
      {/* Ionicons (web component) : uniquement pour <ion-icon name="location-outline">
          des cartes "Zone" du wizard Bon de Distribution (BonDistributionCreerUI.jsx),
          partagé avec l'espace admin — chargé ici aussi puisque le wizard est
          servi dans les deux espaces. */}
      <Script type="module" src="https://unpkg.com/ionicons@7.2.2/dist/ionicons/ionicons.esm.js" strategy="afterInteractive" />
      <Script noModule src="https://unpkg.com/ionicons@7.2.2/dist/ionicons/ionicons.js" strategy="afterInteractive" />
      <PlannerShell plannerName={utilisateur?.nomComplet ?? 'Planificateur'} hubNom={utilisateur?.hub?.nom ?? null}>
        {children}
      </PlannerShell>
    </>
  );
}
