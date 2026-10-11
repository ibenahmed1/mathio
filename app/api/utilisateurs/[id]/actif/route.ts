import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { journaliserCompte } from '@/lib/journal-equipe-admin';
import { estFonctionEquipe } from '@/lib/fonctions-equipe';

// RF-22 : activation/désactivation d'un compte équipe par l'admin.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    if (typeof body.actif !== 'boolean') {
      throw new ApiError(400, 'Le champ actif (booléen) est requis');
    }

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id } });
    if (!utilisateur) {
      throw new ApiError(404, 'Utilisateur introuvable');
    }

    const updated = await prisma.utilisateur.update({
      where: { id },
      data: { actif: body.actif },
      select: { id: true, nomComplet: true, telephone: true, role: true, actif: true },
    });

    // Journal de l'équipe : seulement un vrai changement, et seulement pour un
    // compte de l'équipe (cette route sert aussi à d'autres comptes).
    if (utilisateur.actif !== body.actif && estFonctionEquipe(utilisateur.role)) {
      await journaliserCompte({
        request,
        adminId: session.sub,
        action: body.actif ? 'compte_active' : 'compte_desactive',
        cibleId: id,
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
