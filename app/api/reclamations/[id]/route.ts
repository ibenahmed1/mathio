import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { resolveMarchandForUser } from '@/lib/marchand-scope';
import { INCLUDE_RECLAMATION, ajouterReponse, exposerReclamation } from '@/lib/reclamations';
import type { StatutReclamation } from '@/app/generated/prisma/enums';

const STATUTS_VALIDES: StatutReclamation[] = ['ouverte', 'en_cours', 'resolue', 'rejetee'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['marchand', 'admin', 'moderateur', 'superviseur']);
    const { id } = await params;

    const reclamation = await prisma.reclamation.findUnique({ where: { id }, include: INCLUDE_RECLAMATION });
    if (!reclamation) throw new ApiError(404, 'Réclamation introuvable');

    if (session.role === 'marchand') {
      const marchand = await resolveMarchandForUser(session.sub);
      if (!marchand || reclamation.marchandId !== marchand.id) {
        throw new ApiError(403, 'Accès refusé à cette réclamation');
      }
    }

    return NextResponse.json(exposerReclamation(reclamation, session.role === 'marchand'));
  } catch (error) {
    return jsonError(error);
  }
}

// Changement de statut par le back-office (admin, moderateur : reprend le
// périmètre de l'ancien SAV). Les réponses s'ajoutent au fil
// (POST /api/reclamations/[id]/reponses) ; une `reponse` encore envoyée ici
// par un ancien écran y est ajoutée elle aussi, jamais écrasée.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(['admin', 'moderateur', 'superviseur']);
    const { id } = await params;
    const body = await request.json();

    const reclamation = await prisma.reclamation.findUnique({ where: { id }, select: { id: true } });
    if (!reclamation) throw new ApiError(404, 'Réclamation introuvable');

    const aReponse = typeof body.reponse === 'string' && body.reponse.trim();
    if (body.statut === undefined && !aReponse) throw new ApiError(400, 'Aucun champ modifiable fourni');

    // La réponse d'abord : elle doit pouvoir accompagner la fermeture.
    if (aReponse) await ajouterReponse(id, session.sub, body.reponse);
    if (body.statut !== undefined) {
      if (!STATUTS_VALIDES.includes(body.statut)) {
        throw new ApiError(400, `Statut invalide. Valeurs possibles : ${STATUTS_VALIDES.join(', ')}`);
      }
      await prisma.reclamation.update({ where: { id }, data: { statut: body.statut } });
    }

    const maj = await prisma.reclamation.findUniqueOrThrow({ where: { id }, include: INCLUDE_RECLAMATION });
    return NextResponse.json(exposerReclamation(maj, false));
  } catch (error) {
    return jsonError(error);
  }
}
