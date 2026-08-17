import { redirect } from 'next/navigation';
import { getPageSession } from '@/lib/auth';
import { MarchandShell } from './MarchandShell';

// Le proxy (proxy.ts) protège déjà /marchand/:path*, mais on revérifie ici
// indépendamment : défense en profondeur, cohérent avec app/admin/layout.tsx
// et nécessaire pour les Server Actions qui ne passent pas par le proxy.
export default async function MarchandLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('marchand');
  if (!session || session.role !== 'marchand') {
    redirect('/login');
  }

  // Un cookie admin valide dans le même navigateur signale probablement un
  // admin qui a ouvert cet espace via "Accéder à l'espace" (voir
  // /api/marchands/[id]/impersonation) — on affiche un raccourci de retour.
  // Ce n'est qu'un confort d'UI : le cookie pd_session_admin n'est jamais
  // modifié par l'impersonation, donc ce lien ramène toujours vers une vraie
  // session admin déjà valide.
  const adminSession = await getPageSession('admin');

  return <MarchandShell adminAccessible={Boolean(adminSession)}>{children}</MarchandShell>;
}
