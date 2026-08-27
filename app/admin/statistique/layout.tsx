import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getPageSession, roleMatches } from '@/lib/auth';
import { EnteteStatistique } from '@/components/admin/statistiques/EnteteStatistique';
import type { Role } from '@/app/generated/prisma/enums';

export const metadata = { title: 'Statistiques — Mathio Delivery' };

// § RBAC statistiques : ces pages affichent le COD encaissé et la performance
// NOMINATIVE des livreurs. Même périmètre que la comptabilité, élargi au
// superviseur dont c'est le métier de piloter l'exploitation (cf.
// STATISTIQUES dans components/admin/nav.ts).
//
// Vérifié ici en plus du filtrage de nav, et dans le LAYOUT plutôt que dans
// chacune des six pages : le proxy ne garde que l'appartenance à l'espace
// admin au sens large, et masquer un lien n'a jamais empêché personne de
// taper l'URL. Une seule garde à maintenir, impossible d'oublier une page en
// ajoutant un septième onglet.
//
// `roleMatches` et non `includes(session.role)` : un rôle supplémentaire
// accordé à un utilisateur (Utilisateur.rolesSupplementaires) doit ouvrir les
// mêmes portes que le rôle principal, comme partout ailleurs dans l'app.
const ROLES_STATISTIQUES: Role[] = ['admin', 'responsable', 'superviseur'];

export default async function StatistiqueLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('admin');
  if (!session || !roleMatches(session, ROLES_STATISTIQUES)) {
    redirect('/admin');
  }

  return (
    <div className="flex flex-col gap-5">
      {/* L'en-tête lit la période dans l'URL (useSearchParams) : Next exige
          qu'un tel composant soit sous une frontière Suspense. Fallback vide
          plutôt qu'un squelette — il se résout dans le même rendu. */}
      <Suspense fallback={null}>
        <EnteteStatistique />
      </Suspense>
      {children}
    </div>
  );
}
