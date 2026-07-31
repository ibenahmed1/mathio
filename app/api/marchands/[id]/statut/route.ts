import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { StatutMarchand } from '@/app/generated/prisma/enums';

const STATUTS_VALIDES: StatutMarchand[] = ['en_attente_validation', 'actif', 'suspendu'];

// RF-22 : approbation/refus/suspension d'un compte marchand par l'admin.
// Synchronise Utilisateur.actif : un marchand ne peut se connecter que si
// son statut est "actif" (RG-12 — pas de compte "invité").
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(['admin']);
    const { id } = await params;
    const body = await request.json();
    const statut = body.statut as StatutMarchand | undefined;

    if (!statut || !STATUTS_VALIDES.includes(statut)) {
      throw new ApiError(400, `Statut invalide. Valeurs possibles : ${STATUTS_VALIDES.join(', ')}`);
    }

    const marchand = await prisma.marchand.findUnique({ where: { id } });
    if (!marchand) {
      throw new ApiError(404, 'Marchand introuvable');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.marchand.update({ where: { id }, data: { statut } });
      await tx.utilisateur.update({
        where: { id: marchand.utilisateurId },
        data: { actif: statut === 'actif' },
      });
      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return jsonError(error);
  }
}
