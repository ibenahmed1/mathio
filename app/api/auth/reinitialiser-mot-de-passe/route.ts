import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { jsonError } from '@/lib/api-utils';
import { hashResetToken, hashSecret, getPasswordPolicyError } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = typeof body.token === 'string' ? body.token : '';
    const secret = typeof body.secret === 'string' ? body.secret : '';

    if (!token || !secret) {
      return NextResponse.json({ error: 'Lien invalide' }, { status: 400 });
    }
    const passwordError = getPasswordPolicyError(secret);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const tokenHash = hashResetToken(token);
    const utilisateur = await prisma.utilisateur.findUnique({ where: { resetTokenHash: tokenHash } });

    if (!utilisateur || !utilisateur.resetTokenExpire || utilisateur.resetTokenExpire < new Date()) {
      return NextResponse.json({ error: 'Ce lien est invalide ou a expiré' }, { status: 400 });
    }

    const motDePasseHash = await hashSecret(secret);
    await prisma.utilisateur.update({
      where: { id: utilisateur.id },
      data: { motDePasseHash, resetTokenHash: null, resetTokenExpire: null },
    });

    return NextResponse.json({ message: 'Mot de passe mis à jour, vous pouvez vous connecter.' });
  } catch (error) {
    return jsonError(error);
  }
}
