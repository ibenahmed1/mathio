import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { INVITATION_TOKEN_TTL_MS, generateResetToken, spaceOrigin } from '@/lib/auth';
import { sendInvitationEquipeMarchandEmail } from '@/lib/mailer';
import {
  SELECT_MEMBRE,
  contexteEquipe,
  exigerPriseSurMembre,
  journaliser,
  membreDeLaBoutique,
  serialiserMembre,
} from '@/lib/equipe-marchand';

// Renvoi d'une invitation encore en attente (ou expirée) : un NOUVEAU jeton
// remplace l'ancien — le premier lien cesse donc de fonctionner, ce qui est
// voulu quand on renvoie parce que l'email s'est perdu ou a été transféré.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const ctx = await contexteEquipe(session);
    const { id } = await params;
    const membre = await membreDeLaBoutique(ctx, id);
    exigerPriseSurMembre(ctx, { utilisateurId: membre.utilisateurId, role: membre.role });

    if (membre.modeAjout !== 'invitation' || membre.invitationAccepteeLe) {
      throw new ApiError(409, 'Ce membre a déjà activé son accès');
    }
    if (!membre.utilisateur.email) throw new ApiError(409, 'Ce membre n’a pas d’email');

    const invitation = generateResetToken(INVITATION_TOKEN_TTL_MS);
    await prisma.utilisateur.update({
      where: { id: membre.utilisateurId },
      data: { resetTokenHash: invitation.tokenHash, resetTokenExpire: invitation.expiresAt },
    });

    const lienActivation = `${spaceOrigin('marchand')}/reinitialiser-mot-de-passe?token=${invitation.token}&invitation=1`;
    const invitant = await prisma.utilisateur.findUnique({
      where: { id: ctx.utilisateurId },
      select: { nomComplet: true },
    });

    let emailEnvoye = false;
    try {
      emailEnvoye = await sendInvitationEquipeMarchandEmail({
        to: membre.utilisateur.email,
        nomComplet: membre.utilisateur.nomComplet,
        nomBoutique: ctx.marchand.nomBoutique,
        invitant: invitant?.nomComplet ?? ctx.marchand.nomBoutique,
        nomRole: membre.role.nom,
        activationUrl: lienActivation,
      });
    } catch (erreurEnvoi) {
      console.error('[equipe-marchand] renvoi de l’invitation échoué', erreurEnvoi);
    }

    await journaliser(ctx, 'invitation_renvoyee', membre.utilisateur.nomComplet, membre.utilisateur.email);

    const misAJour = await prisma.marchandMembre.findUnique({ where: { id }, select: SELECT_MEMBRE });
    return NextResponse.json({
      membre: misAJour ? serialiserMembre(misAJour) : null,
      emailEnvoye,
      lienActivation: emailEnvoye ? undefined : lienActivation,
    });
  } catch (error) {
    return jsonError(error);
  }
}
