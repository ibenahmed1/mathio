import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import type { StatutRamassage } from '@/app/generated/prisma/enums';

async function findScopedRamassage(id: string, session: Awaited<ReturnType<typeof requireUser>>) {
  const ramassage = await prisma.ramassage.findUnique({
    where: { id },
    include: { commandes: true, marchand: { select: { nomBoutique: true, utilisateurId: true } } },
  });
  if (!ramassage) throw new ApiError(404, 'Ramassage introuvable');

  if (session.role === 'marchand') {
    const marchand = await resolveMarchandForUser(session.sub);
    if (!marchand || ramassage.marchandId !== marchand.id) {
      throw new ApiError(403, 'Accès refusé à ce ramassage');
    }
  }
  return ramassage;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'marchand']);
    const { id } = await params;
    const ramassage = await findScopedRamassage(id, session);
    return NextResponse.json(ramassage);
  } catch (error) {
    return jsonError(error);
  }
}

const STATUTS_VALIDES: StatutRamassage[] = ['en_attente', 'confirmee', 'effectuee', 'annulee'];

// Admin : assignation d'un ramasseur et/ou changement de statut de la tournée.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();

    const ramassage = await prisma.ramassage.findUnique({ where: { id } });
    if (!ramassage) throw new ApiError(404, 'Ramassage introuvable');

    const data: { ramasseurId?: string | null; statut?: StatutRamassage } = {};

    if (body.ramasseurId !== undefined) {
      if (body.ramasseurId !== null) {
        const ramasseur = await prisma.utilisateur.findUnique({ where: { id: body.ramasseurId } });
        if (!ramasseur || ramasseur.role !== 'ramasseur') {
          throw new ApiError(400, 'ramasseurId doit référencer un utilisateur de rôle ramasseur');
        }
      }
      data.ramasseurId = body.ramasseurId;
    }

    if (body.statut !== undefined) {
      if (!STATUTS_VALIDES.includes(body.statut)) {
        throw new ApiError(400, `Statut invalide. Valeurs possibles : ${STATUTS_VALIDES.join(', ')}`);
      }
      data.statut = body.statut;
    }

    const updated = await prisma.ramassage.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
