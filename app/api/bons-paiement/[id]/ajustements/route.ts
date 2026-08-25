import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';
import { recalculerTotaux } from '@/lib/bon-paiement';
import type { TypeAjustementPaiement } from '@/app/generated/prisma/enums';

const ROLES_PAIEMENT = ['admin', 'responsable'] as const;

const TYPES: TypeAjustementPaiement[] = ['prime', 'penalite'];

// Ajoute une prime ou une pénalité à un bon en BROUILLON (§ /admin/
// bon-paiement). C'est la SEULE façon de faire bouger le net d'un bon : les
// commissions, elles, sont figées à la clôture de chaque tournée et ne se
// réécrivent jamais.
//
// Le montant est toujours saisi POSITIF ; c'est `type` qui porte le signe
// (cf. effetAjustement). Accepter un montant négatif de type prime rendrait la
// fiche de paie du livreur illisible.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_PAIEMENT]);
    const { id } = await params;
    const body = await request.json();

    const type = body.type as TypeAjustementPaiement;
    if (!TYPES.includes(type)) throw new ApiError(400, 'Type invalide (prime ou penalite)');

    const libelle = typeof body.libelle === 'string' ? body.libelle.trim() : '';
    if (!libelle) throw new ApiError(400, 'Le libellé est obligatoire');

    const montant = Number(body.montant);
    if (!Number.isFinite(montant) || montant <= 0) {
      throw new ApiError(400, 'Le montant doit être un nombre strictement positif');
    }

    const bon = await prisma.bonPaiement.findUnique({ where: { id }, select: { statut: true } });
    if (!bon) throw new ApiError(404, 'Bon de paiement introuvable');
    if (bon.statut !== 'brouillon') {
      throw new ApiError(
        409,
        `Un bon ${bon.statut} ne se modifie plus. Seul un brouillon accepte des ajustements.`
      );
    }

    const majour = await prisma.$transaction(async (tx) => {
      await tx.ajustementBonPaiement.create({
        data: {
          bonPaiementId: id,
          type,
          libelle,
          montant: Number(montant.toFixed(2)),
          creeParId: session.sub,
        },
      });
      return recalculerTotaux(tx, id);
    });

    return NextResponse.json(majour, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
