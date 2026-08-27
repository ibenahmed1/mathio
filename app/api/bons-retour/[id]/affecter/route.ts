import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const ROLES_COMPOSITION = ['admin', 'planner'] as const;

// Temps 2 du circuit : le Planner confie le bon à un ramasseur, qui part
// rendre les colis au marchand. Le bon passe `nouveau` → `en_cours` et
// devient visible à la fois dans l'application du ramasseur et dans l'espace
// du marchand — jusque-là, les colis étaient encore au quai et le marchand
// n'avait aucune raison d'en être averti.
//
// Réaffectation autorisée tant que le bon est `en_cours` (le ramasseur prévu
// est absent, le véhicule change) ; interdite une fois le bon signé.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser([...ROLES_COMPOSITION]);
    const { id } = await params;
    const body = await request.json();

    const ramasseurId = typeof body.ramasseurId === 'string' ? body.ramasseurId.trim() : '';
    if (!ramasseurId) throw new ApiError(400, 'ramasseurId est requis');

    const bon = await prisma.bonRetour.findUnique({ where: { id }, select: { id: true, statut: true } });
    if (!bon) throw new ApiError(404, 'Bon de retour introuvable');
    if (bon.statut === 'remis') {
      throw new ApiError(409, 'Ce bon est déjà remis et signé : il ne peut plus être réaffecté');
    }

    const ramasseur = await prisma.utilisateur.findUnique({
      where: { id: ramasseurId },
      select: { id: true, role: true, actif: true, nomComplet: true },
    });
    if (!ramasseur) throw new ApiError(404, 'Ramasseur introuvable');
    if (ramasseur.role !== 'ramasseur') {
      throw new ApiError(400, 'Un bon de retour ne peut être confié qu\'à un compte ramasseur');
    }
    if (!ramasseur.actif) {
      throw new ApiError(400, `Le compte de ${ramasseur.nomComplet} est désactivé`);
    }

    const affecte = await prisma.bonRetour.update({
      where: { id },
      data: { ramasseurId, statut: 'en_cours', dateAffectation: new Date() },
      include: { ramasseur: { select: { id: true, nomComplet: true, telephone: true } } },
    });

    return NextResponse.json(affecte);
  } catch (error) {
    return jsonError(error);
  }
}
