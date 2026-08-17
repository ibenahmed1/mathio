import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import type { TypeTransaction } from '@/app/generated/prisma/enums';

const ROLES_COMPTABILITE = ['admin', 'responsable'] as const;

const TYPE_INVERSE: Record<TypeTransaction, TypeTransaction> = {
  revenu: 'depense',
  depense: 'revenu',
};

// § Immuabilité des données : une écriture validée n'est jamais supprimée ni
// modifiée. L'annuler revient à créer une transaction de compensation
// (Avoir/Correction), de sens inverse et de même montant/catégorie, et à
// marquer l'originale `estAnnulee` — l'historique d'audit reste intact.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_COMPTABILITE]);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const motif = typeof body.motif === 'string' && body.motif.trim() ? body.motif.trim() : null;

    const original = await prisma.transaction.findUnique({ where: { id } });
    if (!original) {
      throw new ApiError(404, 'Transaction introuvable');
    }
    if (original.estAnnulee) {
      throw new ApiError(400, 'Cette transaction a déjà été annulée');
    }

    const [, annulation] = await prisma.$transaction([
      prisma.transaction.update({ where: { id: original.id }, data: { estAnnulee: true } }),
      prisma.transaction.create({
        data: {
          montant: original.montant,
          type: TYPE_INVERSE[original.type],
          categorie: original.categorie,
          dateEffet: new Date(),
          description: motif ? `Annulation de la transaction ${original.id} — ${motif}` : `Annulation de la transaction ${original.id}`,
          auteurId: session.sub,
          transactionOrigineId: original.id,
        },
        include: { auteur: { select: { nomComplet: true, role: true } } },
      }),
    ]);

    return NextResponse.json(annulation, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
