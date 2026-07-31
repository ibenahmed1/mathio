import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { generateTemporarySecret, hashSecret } from '@/lib/auth';

// RF-22 : réinitialisation manuelle par l'admin (recours quand l'utilisateur
// n'a pas d'email ou ne peut pas utiliser le lien envoyé par mail). Le mot de
// passe temporaire est renvoyé en clair une seule fois, à communiquer par
// l'admin hors-app (téléphone, en personne, etc.) — jamais stocké en clair.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id } });
    if (!utilisateur) {
      throw new ApiError(404, 'Utilisateur introuvable');
    }

    const secretTemporaire = generateTemporarySecret();
    const motDePasseHash = await hashSecret(secretTemporaire);

    await prisma.utilisateur.update({
      where: { id },
      data: { motDePasseHash, resetTokenHash: null, resetTokenExpire: null },
    });

    return NextResponse.json({ secretTemporaire });
  } catch (error) {
    return jsonError(error);
  }
}
