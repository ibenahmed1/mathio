import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { getPasswordPolicyError, hashSecret } from '@/lib/auth';
import { contexteEquipe, exigerPriseSurMembre, journaliser, membreDeLaBoutique } from '@/lib/equipe-marchand';

// Réinitialisation du mot de passe d'un membre par un responsable de
// l'équipe — pendant, pour la boutique, de
// POST /api/utilisateurs/[id]/reinitialiser-mot-de-passe côté admin : le
// nouveau mot de passe est saisi et confirmé ici, puis transmis hors de
// l'application à la personne concernée. Jamais stocké en clair.
//
// Tout jeton encore ouvert (invitation, lien « mot de passe oublié ») est
// invalidé : le mot de passe qu'on vient de fixer doit être le seul moyen
// d'entrer. Pour un membre invité qui n'avait pas encore activé son accès,
// cela vaut activation.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const { id } = await params;
    const membre = await membreDeLaBoutique(ctx, id);
    exigerPriseSurMembre(ctx, { utilisateurId: membre.utilisateurId, role: membre.role });

    const body = await request.json();
    const motDePasse = typeof body.motDePasse === 'string' ? body.motDePasse : '';
    const confirmation = typeof body.confirmationMotDePasse === 'string' ? body.confirmationMotDePasse : '';
    const erreur = getPasswordPolicyError(motDePasse);
    if (erreur) throw new ApiError(400, erreur);
    if (motDePasse !== confirmation) throw new ApiError(400, 'Les mots de passe ne correspondent pas');

    const motDePasseHash = await hashSecret(motDePasse);
    await prisma.$transaction([
      prisma.utilisateur.update({
        where: { id: membre.utilisateurId },
        data: { motDePasseHash, resetTokenHash: null, resetTokenExpire: null },
      }),
      prisma.marchandMembre.updateMany({
        where: { id, modeAjout: 'invitation', invitationAccepteeLe: null },
        data: { invitationAccepteeLe: new Date() },
      }),
    ]);

    await journaliser(ctx, 'mot_de_passe_reinitialise', membre.utilisateur.nomComplet);
    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
