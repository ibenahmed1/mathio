import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

// Révoque l'accès d'un membre d'équipe : désactive son compte et retire le
// lien à la boutique. On ne supprime pas l'Utilisateur (conserve l'historique
// des actions qu'il a effectuées — commentaires, historique de statut…).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand']);
    const { id } = await params;

    const marchand = await prisma.marchand.findUnique({ where: { utilisateurId: session.sub } });
    if (!marchand) throw new ApiError(403, 'Seul le titulaire du compte peut gérer les membres de son équipe');

    const membre = await prisma.marchandMembre.findUnique({ where: { id } });
    if (!membre || membre.marchandId !== marchand.id) {
      throw new ApiError(404, 'Membre introuvable');
    }

    await prisma.$transaction([
      prisma.marchandMembre.delete({ where: { id } }),
      prisma.utilisateur.update({ where: { id: membre.utilisateurId }, data: { actif: false } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
