import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError } from '@/lib/api-utils';
import { generateResetToken } from '@/lib/auth';
import { sendPasswordResetEmail } from '@/lib/mailer';

// Message générique dans tous les cas (RG-12) : ne jamais révéler si l'email
// existe en base, sans quoi cet endpoint deviendrait un oracle d'énumération
// de comptes.
const GENERIC_MESSAGE = "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé.";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email) {
      return NextResponse.json({ error: 'Le champ "email" est requis' }, { status: 400 });
    }

    const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });

    if (utilisateur) {
      const { token, tokenHash, expiresAt } = generateResetToken();
      await prisma.utilisateur.update({
        where: { id: utilisateur.id },
        data: { resetTokenHash: tokenHash, resetTokenExpire: expiresAt },
      });

      const origin = request.nextUrl.origin;
      const resetUrl = `${origin}/reinitialiser-mot-de-passe?token=${token}`;
      await sendPasswordResetEmail(email, resetUrl);
    }

    return NextResponse.json({ message: GENERIC_MESSAGE });
  } catch (error) {
    return jsonError(error);
  }
}
