import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { ROLES_KANBAN_UNIQUEMENT } from '@/lib/auth';
import { ROLES_BACKOFFICE_TACHES } from '@/lib/taches-scope';
import { COULEURS_ETIQUETTE } from '@/lib/statuts';

// Renommer / recolorer une étiquette (§ /admin/tasks). Le `code` n'est jamais
// modifié : c'est la clé stockée sur les tâches, la changer les orphelinerait.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser(ROLES_BACKOFFICE_TACHES);
    if (ROLES_KANBAN_UNIQUEMENT.includes(session.role)) {
      throw new ApiError(403, 'Accès refusé pour ce rôle');
    }
    const { id } = await params;
    const body = await request.json();

    const existante = await prisma.etiquetteTache.findUnique({ where: { id } });
    if (!existante) throw new ApiError(404, 'Étiquette introuvable');

    const data: { nom?: string; couleur?: string } = {};
    if (typeof body.nom === 'string') {
      const nom = body.nom.trim();
      if (!nom) throw new ApiError(400, 'nom ne peut pas être vide');
      data.nom = nom;
    }
    if (typeof body.couleur === 'string') {
      if (!COULEURS_ETIQUETTE.includes(body.couleur as (typeof COULEURS_ETIQUETTE)[number])) {
        throw new ApiError(400, `couleur invalide. Valeurs possibles : ${COULEURS_ETIQUETTE.join(', ')}`);
      }
      data.couleur = body.couleur;
    }

    const etiquette = await prisma.etiquetteTache.update({ where: { id }, data });
    return NextResponse.json(etiquette);
  } catch (error) {
    return jsonError(error);
  }
}

// Suppression réservée à l'admin : elle retire l'étiquette de TOUTES les
// tâches qui la portent, dans la même transaction — sans ce ménage, leurs
// tableaux `etiquettes` garderaient un code fantôme, sans libellé ni couleur.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;

    const existante = await prisma.etiquetteTache.findUnique({ where: { id } });
    if (!existante) throw new ApiError(404, 'Étiquette introuvable');

    const retirees = await prisma.$transaction(async (tx) => {
      const porteuses = await tx.tache.findMany({
        where: { etiquettes: { has: existante.code } },
        select: { id: true, etiquettes: true },
      });
      for (const t of porteuses) {
        await tx.tache.update({
          where: { id: t.id },
          data: { etiquettes: t.etiquettes.filter((c) => c !== existante.code) },
        });
      }
      await tx.etiquetteTache.delete({ where: { id } });
      return porteuses.length;
    });

    return NextResponse.json({ ok: true, tachesMisesAJour: retirees });
  } catch (error) {
    return jsonError(error);
  }
}
