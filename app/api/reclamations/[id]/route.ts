import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import type { StatutReclamation } from '@/app/generated/prisma/enums';

const STATUTS_VALIDES: StatutReclamation[] = ['ouverte', 'en_cours', 'resolue', 'rejetee'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand', 'admin', 'sav']);
    const { id } = await params;

    const reclamation = await prisma.reclamation.findUnique({
      where: { id },
      include: {
        marchand: { select: { nomBoutique: true } },
        commande: { select: { id: true, codeSuivi: true } },
        utilisateur: { select: { nomComplet: true } },
      },
    });
    if (!reclamation) throw new ApiError(404, 'Réclamation introuvable');

    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand || reclamation.marchandId !== marchand.id) {
        throw new ApiError(403, 'Accès refusé à cette réclamation');
      }
    }

    return NextResponse.json(reclamation);
  } catch (error) {
    return jsonError(error);
  }
}

// Réponse / changement de statut par le back-office (admin, SAV).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin', 'sav']);
    const { id } = await params;
    const body = await request.json();

    const reclamation = await prisma.reclamation.findUnique({ where: { id } });
    if (!reclamation) throw new ApiError(404, 'Réclamation introuvable');

    const data: { statut?: StatutReclamation; reponse?: string; dateReponse?: Date } = {};

    if (body.statut !== undefined) {
      if (!STATUTS_VALIDES.includes(body.statut)) {
        throw new ApiError(400, `Statut invalide. Valeurs possibles : ${STATUTS_VALIDES.join(', ')}`);
      }
      data.statut = body.statut;
    }
    if (typeof body.reponse === 'string' && body.reponse.trim()) {
      data.reponse = body.reponse.trim();
      data.dateReponse = new Date();
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'Aucun champ modifiable fourni');
    }

    const updated = await prisma.reclamation.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
