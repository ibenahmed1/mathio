import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { hashSecret, getPasswordPolicyError } from '@/lib/auth';
import { journaliserCompte } from '@/lib/journal-equipe-admin';
import { estFonctionEquipe } from '@/lib/fonctions-equipe';

// RF-22 : réinitialisation manuelle par l'admin — pour tout type de compte
// (équipe terrain, back-office, marchand), l'admin saisit lui-même le nouveau
// mot de passe et le confirme, plutôt que de faire générer un secret
// temporaire aléatoire. Communiqué par l'admin hors-app à la personne
// concernée ; jamais stocké en clair.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const motDePasse = typeof body.motDePasse === 'string' ? body.motDePasse : '';
    const confirmationMotDePasse =
      typeof body.confirmationMotDePasse === 'string' ? body.confirmationMotDePasse : '';

    if (!motDePasse || !confirmationMotDePasse) {
      throw new ApiError(400, 'motDePasse et confirmationMotDePasse sont requis');
    }
    const passwordError = getPasswordPolicyError(motDePasse);
    if (passwordError) {
      throw new ApiError(400, passwordError);
    }
    if (motDePasse !== confirmationMotDePasse) {
      throw new ApiError(400, 'Les mots de passe ne correspondent pas');
    }

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id } });
    if (!utilisateur) {
      throw new ApiError(404, 'Utilisateur introuvable');
    }

    const motDePasseHash = await hashSecret(motDePasse);

    await prisma.utilisateur.update({
      where: { id },
      data: { motDePasseHash, resetTokenHash: null, resetTokenExpire: null },
    });

    // Journal de l'équipe : les comptes marchands réinitialisés ici n'en font pas partie.
    if (estFonctionEquipe(utilisateur.role)) {
      await journaliserCompte({ request, adminId: session.sub, action: 'mot_de_passe_reinitialise', cibleId: id });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
