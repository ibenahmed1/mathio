import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, jsonError, requireUser } from '@/lib/api-utils';

const ROLES_FACTURATION = ['admin', 'responsable'] as const;

// BROUILLON → EMISE : le responsable arrête la facture. Après ce passage, plus
// aucune modification n'est acceptée (cf. PATCH /api/factures/[id]) : c'est
// précisément ce qu'« émise » veut dire, et sans ce verrou l'émission ne
// serait qu'une étiquette.
//
// C'est aussi l'instant où le document devient visible dans l'espace marchand
// (cf. STATUTS_VISIBLES_MARCHAND) : jusque-là, aucun chiffre ne lui avait été
// annoncé.
//
// Aucune écriture comptable ici : émettre n'est pas payer. L'argent ne sort
// qu'au passage `payee`. Même séparation que valider/payer côté livreur.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser([...ROLES_FACTURATION]);
    const { id } = await params;

    const facture = await prisma.facture.findUnique({
      where: { id },
      select: { id: true, statut: true, _count: { select: { lignes: true } } },
    });
    if (!facture) throw new ApiError(404, 'Facture introuvable');
    if (facture.statut !== 'brouillon') {
      throw new ApiError(
        409,
        `Seule une facture en brouillon peut être émise (statut actuel : ${facture.statut})`
      );
    }
    // Une facture sans ligne n'a pas d'assiette : elle serait un document
    // opposable au marchand qui ne repose sur aucun colis.
    if (facture._count.lignes === 0) {
      throw new ApiError(409, 'Cette facture ne porte aucun colis — ajoutez-en avant de l’émettre.');
    }

    const emise = await prisma.facture.update({
      where: { id },
      data: { statut: 'emise', dateValidation: new Date(), valideParId: session.sub },
      include: { marchand: { select: { nomBoutique: true } } },
    });

    return NextResponse.json(emise);
  } catch (error) {
    return jsonError(error);
  }
}
