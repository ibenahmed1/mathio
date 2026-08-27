import { redirect } from 'next/navigation';
import { getPageSession, roleMatches, spaceOrigin } from '@/lib/auth';
import { MarchandShell } from './MarchandShell';

// Le proxy (proxy.ts) protège déjà /marchand/:path* et refuse ces pages sur
// tout autre hôte, mais on revérifie ici indépendamment : défense en
// profondeur, cohérent avec app/admin/layout.tsx et nécessaire pour les
// Server Actions qui ne passent pas par le proxy.
export default async function MarchandLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession('marchand');
  if (!session || !roleMatches(session, ['marchand'])) {
    redirect('/login');
  }

  // Session ouverte par un admin via "Accéder à l'espace" — l'information ne
  // vient plus de la détection d'un cookie admin dans le même navigateur
  // (impossible depuis que les deux espaces sont sur des domaines distincts),
  // mais du claim `imp` scellé dans le JWT au moment du transfert (voir
  // /api/session-handoff/consume). C'est à la fois plus fiable et plus
  // honnête : le bandeau reflète la nature de LA session en cours, pas la
  // présence fortuite d'une autre session à côté.
  return (
    <MarchandShell
      impersonation={session.impersonated}
      retourBackOffice={`${spaceOrigin('admin')}/admin/marchands`}
    >
      {children}
    </MarchandShell>
  );
}
