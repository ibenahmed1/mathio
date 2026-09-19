import { redirect } from 'next/navigation';
import { getPageSession, roleMatches, spaceOrigin } from '@/lib/auth';
import { resolveMarchandAvecEtat } from '@/lib/marchand-scope';
import { CHAMPS_A_FINALISER, type EtatActivationMarchand } from '@/lib/marchand-activation';
import { ActivationMarchandProvider } from '@/components/marchand/activation-context';
import { MarchandShell } from './MarchandShell';

// Aucun Marchand rattaché à cette session : anomalie (le rôle existe, le
// dossier non). On le traite comme un dossier entièrement vide plutôt que
// comme un compte opérationnel — c'est la lecture la plus fidèle, et les
// routes verrouillées répondront de toute façon 403.
const ETAT_SANS_DOSSIER: EtatActivationMarchand = {
  profilComplet: false,
  champsManquants: [...CHAMPS_A_FINALISER],
  blocage: 'profil_incomplet',
  operationnel: false,
};

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
  // L'URL du back-office n'est calculée QUE pour une session empruntée. Passée
  // inconditionnellement, elle finissait sérialisée dans la charge utile de
  // CHAQUE page marchand (MarchandShell est un composant client) : n'importe
  // quel marchand y lisait le domaine du back-office dans ses outils de
  // développement. Cela contredisait le reste du dispositif — POST
  // /api/auth/login refuse justement de nommer ce domaine depuis un hôte
  // public, et les trois espaces ont des racines sans parent commun pour qu'il
  // ne se devine pas.
  //
  // Le seul usage de cette URL est le bouton « Retour à l'administration » du
  // bandeau d'impersonation, qui n'existe pas hors de ce cas.

  // § Inscription progressive : l'état d'activation est résolu ICI, une fois
  // par rendu de l'espace, puis distribué par contexte aux écrans qui se
  // verrouillent (VerrouProfil) et à la barre latérale qui les signale. Le
  // calculer par page ferait clignoter chaque écran déverrouillé le temps de
  // la requête ; le calculer ici le rend vrai dès le premier octet.
  const resolu = await resolveMarchandAvecEtat(session.sub);

  return (
    <ActivationMarchandProvider etat={resolu?.etat ?? ETAT_SANS_DOSSIER}>
      <MarchandShell
        impersonation={session.impersonated}
        retourBackOffice={session.impersonated ? `${spaceOrigin('admin')}/admin/marchands` : undefined}
      >
        {children}
      </MarchandShell>
    </ActivationMarchandProvider>
  );
}
